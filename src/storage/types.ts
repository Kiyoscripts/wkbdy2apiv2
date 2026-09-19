/**
 * Storage abstractions.
 *
 * Two kinds of state need persistence and they have different requirements:
 *
 *  - **Credentials** (accounts.enc): small, highly sensitive, written rarely,
 *    read once at boot. Encryption at rest is done by the application, so the
 *    blob stays opaque even if it lands in a database backup.
 *  - **Telemetry** (request history): append-heavy, written on every request,
 *    read for incident forensics and usage reporting. Not secret, but the
 *    per-key fingerprints and account labels in it are sensitive enough that
 *    it should not be world-readable.
 *
 * Both are expressed as narrow interfaces so the JSONL/file implementations and
 * the Postgres implementation are interchangeable, and so tests can use an
 * in-memory double without touching either.
 */

import type { TelemetryEvent, TelemetryRecord, PoolEventRecord } from '../observability/telemetry.js';
import type { CredentialStoreSnapshot } from '../workbuddy/credential-store.js';
import type { ApiKeyRecord } from '../security/api-keys.js';

/** Durable account-state persistence. */
export interface AccountStateStore {
  readonly kind: 'file' | 'postgres';
  /** Returns undefined when no snapshot has been persisted yet. */
  load(): Promise<CredentialStoreSnapshot | undefined>;
  save(snapshot: CredentialStoreSnapshot): Promise<void>;
  /** Whether recovered state survives a process restart with this backend. */
  readonly durable: boolean;
  /** Human-readable description for startup logs and /ready. */
  describe(): string;
}

/**
 * Durable API-key registry.
 *
 * Unlike the account store this holds no secret: only hashes, names, and usage
 * counters, so it is stored as ordinary rows rather than an encrypted envelope.
 * It is still behind an interface because the gateway must persist it whichever
 * backend is active — a key that disappears on redeploy is worse than one that
 * never existed, since the client is left holding a credential that now fails.
 */
export interface ApiKeyStore {
  readonly kind: 'file' | 'postgres';
  load(): Promise<ApiKeyRecord[]>;
  save(records: ApiKeyRecord[]): Promise<void>;
  describe(): string;
}

/**
 * Durable request telemetry.
 *
 * `read` is newest-last to match the JSONL file ordering, so switching backends
 * does not change what an operator sees in the admin panel.
 */
export interface TelemetryStore {
  readonly kind: 'file' | 'postgres';
  /** Record one completed request. Never throws; telemetry must not break a request. */
  request(record: TelemetryRecord): void;
  /** Record one credential-pool lifecycle event. */
  pool(record: Omit<PoolEventRecord, 'time'>): void;
  /** Read back recent events, newest last. */
  read(limit?: number): Promise<TelemetryEvent[]>;
  /**
   * Aggregate usage over a window.
   *
   * Only the Postgres backend can answer this efficiently; the JSONL backend
   * returns null so callers fall back to the in-memory counters rather than
   * pretending to have data they cannot compute.
   */
  aggregate(sinceMs: number): Promise<TelemetryAggregate | null>;
  /** Wait for queued writes to settle. Used by tests and graceful shutdown. */
  flush(): Promise<void>;
  readonly enabled: boolean;
  describe(): string;
}

export type TelemetryAggregate = {
  since: string;
  requests: number;
  errors: number;
  prompt_tokens: number;
  completion_tokens: number;
  /** Per-model request and token totals over the window. */
  per_model: Array<{ model: string; requests: number; tokens: number }>;
  /** Per-key usage over the window, keyed by fingerprint. */
  per_key: Array<{ key_id: string; requests: number; tokens: number }>;
  /** Per-account usage over the window, keyed by pool label. */
  per_account: Array<{ account: string; requests: number; tokens: number }>;
  /** Error code histogram over the window. */
  error_codes: Array<{ code: string; count: number }>;
};

/**
 * Rolling-window usage queries.
 *
 * The file backend cannot answer these across restarts, so it reports
 * `available: false` and returns null instead of zeros that would read as
 * "no usage recorded".
 */
export type UsageReporter = {
  readonly available: boolean;
  window: (sinceMs: number) => Promise<TelemetryAggregate | null>;
};
