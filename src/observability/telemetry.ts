import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { redact } from '../security/redact.js';
import { z } from 'zod';
import type { RequestLogEntry, MetricsSnapshot } from './metrics.js';

/**
 * Durable, append-only request telemetry.
 *
 * The in-memory MetricsCollector is a 200-entry ring buffer that resets on
 * restart; during the "empty tool arguments" investigation the evidence had
 * already been overwritten by the time anyone looked, and a restart erased the
 * rest. This sink keeps the full history on disk as JSONL so an incident can
 * be reconstructed after the fact.
 *
 * Records are written one line per request, redacted with the same policy as
 * the logger, and truncated to a bounded file so a long-running gateway cannot
 * fill its volume.
 */

export const RELIABILITY_DISABLED = '';

export type TelemetryRecord = {
  time: string;
  request_id: string;
  method: string;
  path: string;
  status: number;
  model?: string;
  stream: boolean;
  duration_ms: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  attempts: number;
  retries: number;
  error_code?: string;
  error_class?: string;
  account?: string;
  /** Fingerprint of the downstream key (never the key itself). */
  key_id?: string;
  client_ip?: string;
  user_agent?: string;
};

/**
 * Events the sink accepts. Request-level records are written by the metrics
 * collector; account-pool events are written directly by the credential pool so
 * a restart or quarantine is visible in the same timeline as the requests that
 * caused it.
 */
export type TelemetryEvent =
  | { kind: 'request'; record: TelemetryRecord }
  | { kind: 'pool'; record: PoolEventRecord };

export type PoolEventRecord = {
  time: string;
  event: 'added' | 'removed' | 'quarantined' | 'reauth_required' | 'restored' | 'strategy_changed';
  label?: string;
  detail?: string;
  pool_size?: number;
  strategy?: string;
};

const poolEventSchema = z.object({
  time: z.string(),
  event: z.enum(['added', 'removed', 'quarantined', 'reauth_required', 'restored', 'strategy_changed']),
  label: z.string().optional(),
  detail: z.string().optional(),
  pool_size: z.number().optional(),
  strategy: z.string().optional(),
});

const requestSchema = z.object({
  time: z.string(),
  request_id: z.string(),
  method: z.string(),
  path: z.string(),
  status: z.number(),
  model: z.string().optional(),
  stream: z.boolean(),
  duration_ms: z.number(),
  prompt_tokens: z.number().optional(),
  completion_tokens: z.number().optional(),
  attempts: z.number(),
  retries: z.number(),
  error_code: z.string().optional(),
  error_class: z.string().optional(),
  account: z.string().optional(),
  key_id: z.string().optional(),
  client_ip: z.string().optional(),
  user_agent: z.string().optional(),
});

const lineSchema = z.union([
  z.object({ kind: z.literal('request'), record: requestSchema }),
  z.object({ kind: z.literal('pool'), record: poolEventSchema }),
]);

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

export type TelemetrySinkOptions = {
  /** Empty string disables persistence entirely. */
  path: string;
  /** Rotate once the file exceeds this size. Default 32 MiB. */
  maxBytes?: number;
  onError?: (error: unknown) => void;
};

export class TelemetrySink {
  private queue: Promise<void> = Promise.resolve();
  private failed = false;
  private readonly maxBytes: number;

  constructor(private readonly opts: TelemetrySinkOptions) {
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  get enabled(): boolean {
    return this.opts.path !== RELIABILITY_DISABLED;
  }

  /** Record one completed request. Never throws; telemetry must not break a request. */
  request(record: TelemetryRecord): void {
    this.enqueue({ kind: 'request', record });
  }

  /** Record one credential-pool lifecycle event. */
  pool(record: Omit<PoolEventRecord, 'time'>): void {
    this.enqueue({ kind: 'pool', record: { ...record, time: new Date().toISOString() } });
  }

  /**
   * Resolve once every record accepted so far has been written.
   *
   * Writes are queued fire-and-forget so a slow disk can never delay a
   * response, which means the promise returned by `request()`/`pool()` says
   * nothing about durability. Any caller that needs the file to be complete —
   * a shutdown path, or a test asserting on the persisted contents — has to
   * await this instead of guessing.
   *
   * Never rejects: `enqueue` already converts a failed write into the disabled
   * state, and surfacing that here would turn a telemetry problem into a
   * caller-visible failure.
   */
  async flush(): Promise<void> {
    // Re-read `queue` until it stops changing. A single await is not enough:
    // records enqueued while we were waiting are chained onto the queue we
    // just observed, so one pass could return before they were written.
    let seen: Promise<void>;
    do {
      seen = this.queue;
      await seen.catch(() => undefined);
    } while (seen !== this.queue);
  }

  /**
   * Read back persisted records, newest last. Used by the admin telemetry
   * endpoint and by tests; a malformed line is skipped rather than failing the
   * whole read, because a torn final line is expected after a hard kill.
   */
  async read(limit = 200): Promise<TelemetryEvent[]> {
    if (!this.enabled) return [];
    let raw: string;
    try {
      raw = await readFile(this.opts.path, 'utf8');
    } catch {
      return [];
    }
    const lines = raw.split('\n').filter((line) => line.trim() !== '');
    const out: TelemetryEvent[] = [];
    for (const line of lines.slice(Math.max(0, lines.length - limit))) {
      try {
        const parsed = lineSchema.safeParse(JSON.parse(line));
        if (parsed.success) out.push(parsed.data as TelemetryEvent);
      } catch {
        // Skip torn or corrupt lines; keep the rest of the history readable.
      }
    }
    return out;
  }

  private enqueue(event: TelemetryEvent): void {
    if (!this.enabled || this.failed) return;
    // Redaction runs before serialization so no credential can reach disk even
    // if a future caller forgets to strip it.
    const safe = redact(event) as TelemetryEvent;
    const line = JSON.stringify(safe) + '\n';
    this.queue = this.queue
      .then(async () => {
        // Checked here as well as in enqueue(): records queued before a failure
        // are still sitting in the chain, and each would otherwise retry the
        // same doomed write and report the failure again.
        if (this.failed) return;
        await this.rotateIfNeeded();
        await mkdir(dirname(this.opts.path), { recursive: true });
        await appendFile(this.opts.path, line, { encoding: 'utf8', mode: 0o600 });
      })
      .catch((error) => {
        // Disable on first failure: a broken disk should not spam stderr on
        // every request for the lifetime of the process.
        this.failed = true;
        this.opts.onError?.(error);
      });
  }

  private async rotateIfNeeded(): Promise<void> {
    const rotated = `${this.opts.path}.1`;
    try {
      const raw = await readFile(this.opts.path, 'utf8');
      if (raw.length <= this.maxBytes) return;
      await rename(this.opts.path, rotated);
    } catch {
      // Missing file, or rotation raced another writer: either way the append
      // below recreates the active file.
      void writeFile;
    }
  }
}

export function createTelemetrySink(opts: TelemetrySinkOptions): TelemetrySink {
  return new TelemetrySink(opts);
}

/** Project a metrics entry onto a telemetry record, filling required fields. */
export function toTelemetryRecord(
  entry: RequestLogEntry & { request_id?: string },
  extra: { attempts?: number; retries?: number; error_class?: string; account?: string } = {},
): TelemetryRecord {
  return {
    time: new Date(entry.time).toISOString(),
    request_id: entry.request_id ?? 'unknown',
    method: entry.method,
    path: entry.path,
    status: entry.status,
    ...(entry.model !== undefined ? { model: entry.model } : {}),
    stream: entry.stream,
    duration_ms: entry.duration_ms,
    ...(entry.prompt_tokens !== undefined ? { prompt_tokens: entry.prompt_tokens } : {}),
    ...(entry.completion_tokens !== undefined ? { completion_tokens: entry.completion_tokens } : {}),
    attempts: entry.attempts,
    retries: entry.retries,
    ...(entry.error_code !== undefined ? { error_code: entry.error_code } : {}),
    ...(entry.error_class !== undefined ? { error_class: entry.error_class } : {}),
    ...(entry.account !== undefined ? { account: entry.account } : {}),
    ...(entry.key_id !== undefined ? { key_id: entry.key_id } : {}),
    ...(extra.attempts !== undefined ? { attempts: extra.attempts } : {}),
    ...(extra.retries !== undefined ? { retries: extra.retries } : {}),
    ...(extra.error_class !== undefined ? { error_class: extra.error_class } : {}),
    ...(extra.account !== undefined ? { account: extra.account } : {}),
  };
}

export type { RequestLogEntry, MetricsSnapshot };
