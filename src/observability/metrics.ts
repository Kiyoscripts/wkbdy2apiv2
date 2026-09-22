/**
 * In-memory request metrics for the admin panel. Not a time-series DB:
 * bounded ring buffers + per-model/per-key/per-status counters. Resets on
 * restart — durable history lives in the telemetry sink (observability/telemetry.ts),
 * which receives every record this collector sees.
 */

export type RequestLogEntry = {
  time: number;
  request_id: string;
  method: string;
  path: string;
  status: number;
  model?: string;
  stream: boolean;
  duration_ms: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  error_code?: string;
  /** How many times the upstream was attempted (1 = no retry). */
  attempts: number;
  /** attempts - 1, surfaced directly so dashboards need no arithmetic. */
  retries: number;
  /** Class of the failure, when the request failed. */
  error_class?: string;
  /** Credential label that served the request, when known. */
  account?: string;
  /** Downstream key fingerprint (never the key itself). */
  key_id?: string;
  /**
   * First characters of a rejected key, when one was presented.
   *
   * Recorded only for auth rejections, because that is the one case where the
   * fingerprint cannot be looked up: the key is by definition not in the
   * registry, so there is no name to show. The prefix is the same field the
   * panel already displays for stored keys, which lets an operator match a
   * rejected key against the key list by eye. Absent means no key was sent.
   */
  key_prefix?: string;
};

const MAX_LOG = 200;

/** Rolling cost/usage counter for one dimension (model, key, account). */
export type UsageBucket = { requests: number; prompt_tokens: number; completion_tokens: number; total_tokens: number };

const emptyBucket = (): UsageBucket => ({ requests: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });

function addTo(bucket: UsageBucket, entry: { prompt_tokens?: number; completion_tokens?: number }): void {
  bucket.requests += 1;
  bucket.prompt_tokens += entry.prompt_tokens ?? 0;
  bucket.completion_tokens += entry.completion_tokens ?? 0;
  bucket.total_tokens = bucket.prompt_tokens + bucket.completion_tokens;
}

export type MetricsSnapshot = {
  started_at: number;
  uptime_ms: number;
  total_requests: number;
  total_errors: number;
  error_rate: number;
  tokens: { prompt: number; completion: number };
  total_retries: number;
  retry_rate: number;
  per_model: Array<{ model: string; count: number; tokens: number; errors: number }>;
  per_key: Array<UsageBucket & { key_id: string }>;
  per_account: Array<UsageBucket & { account: string }>;
  /** Counts of accepted-but-dropped fields, keyed by field name. */
  dropped_fields: Array<{ field: string; count: number }>;
  /** Counts of error codes, newest-first by frequency. */
  error_codes: Array<{ code: string; count: number }>;
  recent: RequestLogEntry[];
  p95_ms: number | null;
};

export class MetricsCollector {
  private requests: RequestLogEntry[] = [];
  private totalRequests = 0;
  private totalErrors = 0;
  private totalRetries = 0;
  private totalTokens = { prompt: 0, completion: 0 };
  private startedAt = Date.now();

  /** Per-model counters keyed by model id. */
  private perModel = new Map<string, { count: number; tokens: number; errors: number }>();
  /** Per-key usage, keyed by the fingerprint the route supplies (never a key). */
  private perKey = new Map<string, UsageBucket>();
  /** Per-account usage, keyed by pool label. */
  private perAccount = new Map<string, UsageBucket>();
  /** Accepted-but-dropped field names, for SDK-drift visibility. */
  private droppedFields = new Map<string, number>();
  /** Error code histogram. */
  private errorCodes = new Map<string, number>();

  /** Sink invoked for every recorded entry; wired to the telemetry file. */
  private sink?: (entry: RequestLogEntry) => void;

  setSink(sink: (entry: RequestLogEntry) => void): void {
    this.sink = sink;
  }

  record(entry: Omit<RequestLogEntry, 'time' | 'request_id' | 'attempts' | 'retries'> & Partial<Pick<RequestLogEntry, 'request_id' | 'attempts' | 'retries'>>): void {
    const full: RequestLogEntry = {
      time: Date.now(),
      request_id: entry.request_id ?? 'unknown',
      method: entry.method,
      path: entry.path,
      status: entry.status,
      ...(entry.model !== undefined ? { model: entry.model } : {}),
      stream: entry.stream,
      duration_ms: entry.duration_ms,
      ...(entry.prompt_tokens !== undefined ? { prompt_tokens: entry.prompt_tokens } : {}),
      ...(entry.completion_tokens !== undefined ? { completion_tokens: entry.completion_tokens } : {}),
      ...(entry.error_code !== undefined ? { error_code: entry.error_code } : {}),
      ...(entry.error_class !== undefined ? { error_class: entry.error_class } : {}),
      ...(entry.account !== undefined ? { account: entry.account } : {}),
      ...(entry.key_id !== undefined ? { key_id: entry.key_id } : {}),
      ...(entry.key_prefix !== undefined ? { key_prefix: entry.key_prefix } : {}),
      attempts: entry.attempts ?? 1,
      retries: entry.retries ?? Math.max(0, (entry.attempts ?? 1) - 1),
    };

    this.totalRequests += 1;
    if (full.status >= 400) this.totalErrors += 1;
    this.totalRetries += full.retries;
    if (full.prompt_tokens) this.totalTokens.prompt += full.prompt_tokens;
    if (full.completion_tokens) this.totalTokens.completion += full.completion_tokens;
    if (full.model) {
      const agg = this.perModel.get(full.model) ?? { count: 0, tokens: 0, errors: 0 };
      agg.count += 1;
      agg.tokens += (full.prompt_tokens ?? 0) + (full.completion_tokens ?? 0);
      // Tracked per model so the panel can show where failures concentrate
      // rather than only how much traffic each model carried.
      if (full.status >= 400) agg.errors += 1;
      this.perModel.set(full.model, agg);
    }
    if (full.key_id) {
      const bucket = this.perKey.get(full.key_id) ?? emptyBucket();
      addTo(bucket, full);
      this.perKey.set(full.key_id, bucket);
    }
    if (full.account) {
      const bucket = this.perAccount.get(full.account) ?? emptyBucket();
      addTo(bucket, full);
      this.perAccount.set(full.account, bucket);
    }
    if (full.error_code) {
      this.errorCodes.set(full.error_code, (this.errorCodes.get(full.error_code) ?? 0) + 1);
    }
    this.requests.push(full);
    if (this.requests.length > MAX_LOG) this.requests.shift();
    this.sink?.(full);
  }

  /** Count one accepted-but-dropped request field, by name. */
  recordDroppedFields(fields: string[]): void {
    for (const field of fields) {
      this.droppedFields.set(field, (this.droppedFields.get(field) ?? 0) + 1);
    }
  }

  snapshot(): MetricsSnapshot {
    const durations = this.requests.map((r) => r.duration_ms).sort((a, b) => a - b);
    const p95: number | null =
      durations.length >= 1 ? (durations[Math.max(0, Math.floor(durations.length * 0.95) - 1)] ?? null) : null;
    return {
      started_at: this.startedAt,
      uptime_ms: Date.now() - this.startedAt,
      total_requests: this.totalRequests,
      total_errors: this.totalErrors,
      error_rate: this.totalRequests === 0 ? 0 : this.totalErrors / this.totalRequests,
      tokens: { ...this.totalTokens },
      total_retries: this.totalRetries,
      retry_rate: this.totalRequests === 0 ? 0 : this.totalRetries / this.totalRequests,
      per_model: [...this.perModel.entries()]
        .map(([model, agg]) => ({ model, ...agg }))
        .sort((a, b) => b.count - a.count),
      per_key: [...this.perKey.entries()]
        .map(([key_id, bucket]) => ({ key_id, ...bucket }))
        .sort((a, b) => b.total_tokens - a.total_tokens),
      per_account: [...this.perAccount.entries()]
        .map(([account, bucket]) => ({ account, ...bucket }))
        .sort((a, b) => b.total_tokens - a.total_tokens),
      dropped_fields: [...this.droppedFields.entries()]
        .map(([field, count]) => ({ field, count }))
        .sort((a, b) => b.count - a.count),
      error_codes: [...this.errorCodes.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count),
      recent: [...this.requests].reverse(),
      p95_ms: p95,
    };
  }
}

export function createMetrics(): MetricsCollector {
  return new MetricsCollector();
}
