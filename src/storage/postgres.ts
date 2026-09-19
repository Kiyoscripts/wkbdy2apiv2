import { Pool } from 'pg';
import type { Logger } from '../observability/logger.js';
import type { TelemetryEvent, TelemetryRecord, PoolEventRecord } from '../observability/telemetry.js';
import type { CredentialStoreSnapshot } from '../workbuddy/credential-store.js';
import type { ApiKeyRecord } from '../security/api-keys.js';
import type { AccountStateStore, ApiKeyStore, TelemetryAggregate, TelemetryStore } from './types.js';

/**
 * Postgres-backed persistence for account state and request telemetry.
 *
 * Why a database here at all: the previous design put the encrypted account
 * blob and the telemetry history on the container filesystem. On Render (and
 * any ephemeral-disk host) that means every deploy or restart discards the
 * account pool and the entire request history — precisely when an operator
 * wants to look at what happened. A managed Postgres is the smallest change
 * that makes both survive.
 *
 * Deliberate choices:
 *
 *  - **No ORM.** The schema is two tables and four queries. `pg` with an
 *    explicit migration keeps the dependency surface small and the SQL visible,
 *    which matters more than convenience at this size.
 *  - **Credentials stay application-encrypted.** The `accounts` row holds the
 *    same AES-256-GCM envelope the file backend writes. Database backups,
 *    replica snapshots, and `SELECT *` in a support session all see ciphertext.
 *    The key lives only in the environment.
 *  - **Telemetry writes are batched.** Every request produces a row; a chatty
 *    gateway would otherwise pay a round trip per request. Rows are buffered
 *    and flushed on an interval or when the buffer fills, and a lost batch is
 *    explicitly tolerated because telemetry must never fail a request.
 */

/**
 * Column list for request_log.
 *
 * Declared once and reused by the migration, the insert, and the row mapper, so
 * a new field cannot be added to the record type and silently dropped from the
 * write. (An earlier draft of this file did exactly that: the insert listed
 * `user_agent` while the table did not define it, which fails only at runtime
 * on the first write.)
 */
const REQUEST_COLUMNS = [
  'time',
  'request_id',
  'method',
  'path',
  'status',
  'model',
  'stream',
  'duration_ms',
  'prompt_tokens',
  'completion_tokens',
  'attempts',
  'retries',
  'error_code',
  'error_class',
  'account',
  'key_id',
  'client_ip',
  'user_agent',
] as const;

const REQUEST_COLUMN_TYPES: Record<(typeof REQUEST_COLUMNS)[number], string> = {
  time: 'TIMESTAMPTZ NOT NULL',
  request_id: 'TEXT NOT NULL',
  method: 'TEXT NOT NULL',
  path: 'TEXT NOT NULL',
  status: 'INTEGER NOT NULL',
  model: 'TEXT',
  stream: 'BOOLEAN NOT NULL',
  duration_ms: 'INTEGER NOT NULL',
  prompt_tokens: 'INTEGER',
  completion_tokens: 'INTEGER',
  attempts: 'INTEGER NOT NULL DEFAULT 1',
  retries: 'INTEGER NOT NULL DEFAULT 0',
  error_code: 'TEXT',
  error_class: 'TEXT',
  account: 'TEXT',
  key_id: 'TEXT',
  client_ip: 'TEXT',
  user_agent: 'TEXT',
};

const POOL_COLUMNS = ['time', 'event', 'label', 'detail', 'pool_size', 'strategy'] as const;

const POOL_COLUMN_TYPES: Record<(typeof POOL_COLUMNS)[number], string> = {
  time: 'TIMESTAMPTZ NOT NULL',
  event: 'TEXT NOT NULL',
  label: 'TEXT',
  detail: 'TEXT',
  pool_size: 'INTEGER',
  strategy: 'TEXT',
};

const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: '001_init',
    sql: `
      CREATE TABLE IF NOT EXISTS accounts (
        id            SMALLINT PRIMARY KEY DEFAULT 1,
        version       INTEGER NOT NULL,
        envelope      TEXT NOT NULL,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT accounts_single_row CHECK (id = 1)
      );

      CREATE TABLE IF NOT EXISTS request_log (
        id                BIGSERIAL PRIMARY KEY,
        ${REQUEST_COLUMNS.map((c) => `${c.padEnd(17)} ${REQUEST_COLUMN_TYPES[c]}`).join(',\n        ')}
      );

      CREATE INDEX IF NOT EXISTS request_log_time_idx ON request_log (time DESC);
      CREATE INDEX IF NOT EXISTS request_log_key_time_idx ON request_log (key_id, time DESC);
      CREATE INDEX IF NOT EXISTS request_log_model_time_idx ON request_log (model, time DESC);
      CREATE INDEX IF NOT EXISTS request_log_account_time_idx ON request_log (account, time DESC);

      CREATE TABLE IF NOT EXISTS pool_events (
        id         BIGSERIAL PRIMARY KEY,
        ${POOL_COLUMNS.map((c) => `${c.padEnd(10)} ${POOL_COLUMN_TYPES[c]}`).join(',\n        ')}
      );

      CREATE INDEX IF NOT EXISTS pool_events_time_idx ON pool_events (time DESC);
    `,
  },
  {
    // Added separately rather than by editing 001_init.
    //
    // Migrations are recorded by id in schema_migrations, so a database that
    // already applied 001_init will never re-run it. Appending to that same
    // migration would create the table on fresh databases and silently skip it
    // on every existing one — which is precisely the deployment being upgraded.
    id: '002_api_keys',
    sql: `
      -- API-key registry. Hashes only: the plaintext key is shown once at
      -- creation and never stored, so this table is not sensitive in the way
      -- the accounts envelope is.
      CREATE TABLE IF NOT EXISTS api_keys (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        prefix        TEXT NOT NULL,
        hash          TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL,
        last_used_at  TIMESTAMPTZ,
        request_count INTEGER NOT NULL DEFAULT 0,
        is_admin      BOOLEAN NOT NULL DEFAULT false,
        note          TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (hash);
    `,
  },
];

export type PostgresOptions = {
  connectionString: string;
  /** Require TLS. Off for a sidecar on a private network, on for managed hosts. */
  ssl?: boolean;
  /** Max pooled connections. Telemetry and account state share the pool. */
  maxConnections?: number;
  logger?: Logger;
  /** Buffered telemetry rows before an immediate flush. */
  telemetryBatchSize?: number;
  /** Interval between telemetry flushes. */
  telemetryFlushMs?: number;
};

/** Thin wrapper owning the pool and the migration step. */
export class PostgresDatabase {
  readonly pool: Pool;
  private migrated = false;

  constructor(private readonly opts: PostgresOptions) {
    this.pool = new Pool({
      connectionString: opts.connectionString,
      max: opts.maxConnections ?? 5,
      ...(opts.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
      // A gateway that blocks forever on a wedged database is worse than one
      // that fails fast and surfaces the error.
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    // An idle client error is emitted on the pool, not on a query; without a
    // listener Node treats it as an unhandled error and kills the process.
    this.pool.on('error', (error) => {
      this.opts.logger?.error('postgres idle client error', { error: error.message });
    });
  }

  /** Apply pending migrations. Safe to call repeatedly and from every replica. */
  async migrate(): Promise<void> {
    if (this.migrated) return;
    const client = await this.pool.connect();
    try {
      // Serialize concurrent boots (e.g. several replicas starting at once).
      await client.query('SELECT pg_advisory_lock($1)', [0x77_6b_62_31]);
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            id         TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
        `);
        const { rows } = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
        const applied = new Set(rows.map((row) => row.id));
        for (const migration of MIGRATIONS) {
          if (applied.has(migration.id)) continue;
          await client.query('BEGIN');
          try {
            await client.query(migration.sql);
            await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
            await client.query('COMMIT');
            this.opts.logger?.info('applied migration', { migration: migration.id });
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [0x77_6b_62_31]);
      }
    } finally {
      client.release();
    }
    this.migrated = true;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Round-trip check used by /ready so a dead database is visible. */
  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}

/**
 * Account state in Postgres.
 *
 * The row stores the same AES-256-GCM envelope as the file backend, one row
 * enforced by a CHECK constraint. Encryption stays in the application so the
 * database never holds a usable token.
 */
export class PostgresAccountStore implements AccountStateStore {
  readonly kind = 'postgres' as const;
  readonly durable = true;

  constructor(
    private readonly db: PostgresDatabase,
    /** Opaque ciphertext produced by the credential store's encrypt step. */
    private readonly encrypt: (snapshot: CredentialStoreSnapshot) => string,
    private readonly decrypt: (envelope: string) => CredentialStoreSnapshot,
  ) {}

  describe(): string {
    return 'postgres (accounts)';
  }

  async load(): Promise<CredentialStoreSnapshot | undefined> {
    const { rows } = await this.db.pool.query<{ envelope: string }>(
      'SELECT envelope FROM accounts WHERE id = 1',
    );
    const envelope = rows[0]?.envelope;
    if (!envelope) return undefined;
    // A decryption failure must not be swallowed: it usually means the
    // encryption key changed, and starting with a silently empty pool hides
    // that from the operator.
    return this.decrypt(envelope);
  }

  async save(snapshot: CredentialStoreSnapshot): Promise<void> {
    const envelope = this.encrypt(snapshot);
    await this.db.pool.query(
      `INSERT INTO accounts (id, version, envelope, updated_at)
       VALUES (1, $1, $2, now())
       ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, envelope = EXCLUDED.envelope, updated_at = now()`,
      [snapshot.version, envelope],
    );
  }
}

/**
 * API-key registry in Postgres.
 *
 * A full replace inside one transaction: the registry is small (operator-issued
 * keys) and key changes are rare, so rewriting the table is simpler and safer
 * than reconciling row by row, and it cannot leave a half-applied key set behind
 * if the process dies mid-write.
 */
export class PostgresApiKeyStore implements ApiKeyStore {
  readonly kind = 'postgres' as const;

  constructor(private readonly db: PostgresDatabase) {}

  describe(): string {
    return 'postgres (api_keys)';
  }

  async load(): Promise<ApiKeyRecord[]> {
    const { rows } = await this.db.pool.query(
      'SELECT id, name, prefix, hash, created_at, last_used_at, request_count, is_admin, note FROM api_keys ORDER BY created_at',
    );
    return rows.map(rowToApiKey);
  }

  async save(records: ApiKeyRecord[]): Promise<void> {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM api_keys');
      if (records.length > 0) {
        const columns = 9;
        const values: unknown[] = [];
        const placeholders = records.map((record, i) => {
          const base = i * columns;
          values.push(
            record.id,
            record.name,
            record.prefix,
            record.hash,
            record.created_at,
            record.last_used_at ?? null,
            record.request_count,
            record.admin,
            record.note ?? null,
          );
          return `(${Array.from({ length: columns }, (_, j) => `$${base + j + 1}`).join(',')})`;
        });
        await client.query(
          `INSERT INTO api_keys (id, name, prefix, hash, created_at, last_used_at, request_count, is_admin, note)
           VALUES ${placeholders.join(',')}`,
          values,
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

/** Map an api_keys row onto the registry record shape. */
function rowToApiKey(row: Record<string, unknown>): ApiKeyRecord {
  const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));
  return {
    id: String(row.id),
    name: String(row.name),
    prefix: String(row.prefix),
    hash: String(row.hash),
    created_at: iso(row.created_at),
    ...(row.last_used_at != null ? { last_used_at: iso(row.last_used_at) } : {}),
    request_count: Number(row.request_count),
    admin: Boolean(row.is_admin),
    ...(row.note != null ? { note: String(row.note) } : {}),
  };
}

/** Telemetry in Postgres, with batched inserts. */export class PostgresTelemetryStore implements TelemetryStore {
  readonly kind = 'postgres' as const;
  readonly enabled = true;

  private requestBuffer: TelemetryRecord[] = [];
  private poolBuffer: PoolEventRecord[] = [];
  private timer?: NodeJS.Timeout;
  /** Set after a write failure so we stop hammering a broken database. */
  private degraded = false;

  constructor(
    private readonly db: PostgresDatabase,
    private readonly opts: { batchSize?: number; flushMs?: number; logger?: Logger },
  ) {
    const interval = setInterval(() => void this.flush(), opts.flushMs ?? 2_000);
    interval.unref?.();
    this.timer = interval;
  }

  describe(): string {
    return `postgres (request_log, pool_events)${this.degraded ? ' [DEGRADED: writes failing]' : ''}`;
  }

  request(record: TelemetryRecord): void {
    if (this.degraded) return;
    this.requestBuffer.push(record);
    if (this.requestBuffer.length >= (this.opts.batchSize ?? 50)) void this.flush();
  }

  pool(record: Omit<PoolEventRecord, 'time'>): void {
    if (this.degraded) return;
    this.poolBuffer.push({ ...record, time: new Date().toISOString() });
    if (this.poolBuffer.length >= (this.opts.batchSize ?? 50)) void this.flush();
  }

  /** Flush both buffers. Never throws. */
  async flush(): Promise<void> {
    if (this.degraded) return;
    const requests = this.requestBuffer.splice(0);
    const pools = this.poolBuffer.splice(0);
    if (requests.length === 0 && pools.length === 0) return;

    try {
      if (requests.length > 0) await this.insertRows('request_log', REQUEST_COLUMNS, requests.map(toRow));
      if (pools.length > 0) await this.insertRows('pool_events', POOL_COLUMNS, pools.map(toRow));
    } catch (error) {
      this.degraded = true;
      if (this.timer) clearInterval(this.timer);
      // One clear error, then stay quiet: a broken database should not produce
      // a log line per request for the lifetime of the process.
      this.opts.logger?.error('telemetry persistence disabled after a write failure', {
        error: error instanceof Error ? error.message : String(error),
        dropped_requests: requests.length,
      });
    }
  }

  /**
   * Multi-row INSERT built from the shared column list.
   *
   * One statement rather than one per record: a busy gateway flushing 50 rows
   * should cost one round trip, not fifty.
   */
  private async insertRows(table: string, columns: readonly string[], rows: unknown[][]): Promise<void> {
    const values: unknown[] = [];
    const placeholders = rows.map((row, i) => {
      const base = i * columns.length;
      values.push(...row);
      return `(${Array.from({ length: columns.length }, (_, j) => `$${base + j + 1}`).join(',')})`;
    });
    await this.db.pool.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders.join(',')}`,
      values,
    );
  }

  /** Read recent events, newest last, mirroring the JSONL ordering. */
  async read(limit = 200): Promise<TelemetryEvent[]> {
    await this.flush();
    const [requests, pools] = await Promise.all([
      this.db.pool.query(`SELECT * FROM request_log ORDER BY id DESC LIMIT $1`, [limit]),
      this.db.pool.query(`SELECT * FROM pool_events ORDER BY id DESC LIMIT $1`, [limit]),
    ]);

    const merged: TelemetryEvent[] = [
      ...requests.rows.map((row) => ({ kind: 'request' as const, record: rowToRecord(row) })),
      ...pools.rows.map((row) => ({ kind: 'pool' as const, record: rowToPoolEvent(row) })),
    ];
    merged.sort((a, b) => a.record.time.localeCompare(b.record.time));
    return merged.slice(-limit);
  }

  /**
   * Usage over a window, computed in the database.
   *
   * This is the capability the JSONL backend could not provide: the in-memory
   * counters reset on restart, so "how many tokens did key X use this week"
   * had no answer that survived a deploy.
   */
  async aggregate(sinceMs: number): Promise<TelemetryAggregate> {
    await this.flush();
    const since = new Date(Date.now() - sinceMs).toISOString();
    const tokens = 'SUM(COALESCE(prompt_tokens,0) + COALESCE(completion_tokens,0))';

    const [totals, perModel, perKey, perAccount, errorCodes] = await Promise.all([
      this.db.pool.query<{ requests: string; errors: string; prompt_tokens: string | null; completion_tokens: string | null }>(
        `SELECT COUNT(*) AS requests,
                COUNT(*) FILTER (WHERE status >= 400) AS errors,
                SUM(prompt_tokens) AS prompt_tokens,
                SUM(completion_tokens) AS completion_tokens
         FROM request_log WHERE time >= $1`,
        [since],
      ),
      this.db.pool.query<{ model: string; requests: string; tokens: string | null }>(
        `SELECT model, COUNT(*) AS requests, ${tokens} AS tokens
         FROM request_log WHERE time >= $1 AND model IS NOT NULL
         GROUP BY model ORDER BY requests DESC`,
        [since],
      ),
      this.db.pool.query<{ key_id: string; requests: string; tokens: string | null }>(
        `SELECT key_id, COUNT(*) AS requests, ${tokens} AS tokens
         FROM request_log WHERE time >= $1 AND key_id IS NOT NULL
         GROUP BY key_id ORDER BY tokens DESC`,
        [since],
      ),
      this.db.pool.query<{ account: string; requests: string; tokens: string | null }>(
        `SELECT account, COUNT(*) AS requests, ${tokens} AS tokens
         FROM request_log WHERE time >= $1 AND account IS NOT NULL
         GROUP BY account ORDER BY tokens DESC`,
        [since],
      ),
      this.db.pool.query<{ code: string; count: string }>(
        `SELECT error_code AS code, COUNT(*) AS count
         FROM request_log WHERE time >= $1 AND error_code IS NOT NULL
         GROUP BY error_code ORDER BY count DESC`,
        [since],
      ),
    ]);

    return {
      since,
      requests: Number(totals.rows[0]?.requests ?? 0),
      errors: Number(totals.rows[0]?.errors ?? 0),
      prompt_tokens: Number(totals.rows[0]?.prompt_tokens ?? 0),
      completion_tokens: Number(totals.rows[0]?.completion_tokens ?? 0),
      per_model: perModel.rows.map((r) => ({ model: r.model, requests: Number(r.requests), tokens: Number(r.tokens ?? 0) })),
      per_key: perKey.rows.map((r) => ({ key_id: r.key_id, requests: Number(r.requests), tokens: Number(r.tokens ?? 0) })),
      per_account: perAccount.rows.map((r) => ({ account: r.account, requests: Number(r.requests), tokens: Number(r.tokens ?? 0) })),
      error_codes: errorCodes.rows.map((r) => ({ code: r.code, count: Number(r.count) })),
    };
  }

  /** Round-trip check used by /ready. */
  async ping(): Promise<void> {
    await this.db.ping();
  }

  /** Stop the flush timer and drain. Used on graceful shutdown. */
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}

/** Project a TelemetryRecord onto the request_log column order. */
function toRow(row: TelemetryRecord | PoolEventRecord): unknown[] {
  if ('request_id' in row) {
    return REQUEST_COLUMNS.map((column) => {
      const value = (row as Record<string, unknown>)[column];
      return value === undefined ? null : value;
    });
  }
  return POOL_COLUMNS.map((column) => {
    const value = (row as Record<string, unknown>)[column];
    return value === undefined ? null : value;
  });
}

/** Map a request_log row onto the shared telemetry shape. */
function rowToRecord(row: Record<string, unknown>): TelemetryRecord {
  const time = row.time instanceof Date ? row.time.toISOString() : String(row.time);
  return {
    time,
    request_id: String(row.request_id),
    method: String(row.method),
    path: String(row.path),
    status: Number(row.status),
    ...(row.model != null ? { model: String(row.model) } : {}),
    stream: Boolean(row.stream),
    duration_ms: Number(row.duration_ms),
    ...(row.prompt_tokens != null ? { prompt_tokens: Number(row.prompt_tokens) } : {}),
    ...(row.completion_tokens != null ? { completion_tokens: Number(row.completion_tokens) } : {}),
    attempts: Number(row.attempts),
    retries: Number(row.retries),
    ...(row.error_code != null ? { error_code: String(row.error_code) } : {}),
    ...(row.error_class != null ? { error_class: String(row.error_class) } : {}),
    ...(row.account != null ? { account: String(row.account) } : {}),
    ...(row.key_id != null ? { key_id: String(row.key_id) } : {}),
    ...(row.client_ip != null ? { client_ip: String(row.client_ip) } : {}),
    ...(row.user_agent != null ? { user_agent: String(row.user_agent) } : {}),
  };
}

function rowToPoolEvent(row: Record<string, unknown>): PoolEventRecord {
  const time = row.time instanceof Date ? row.time.toISOString() : String(row.time);
  return {
    time,
    event: String(row.event) as PoolEventRecord['event'],
    ...(row.label != null ? { label: String(row.label) } : {}),
    ...(row.detail != null ? { detail: String(row.detail) } : {}),
    ...(row.pool_size != null ? { pool_size: Number(row.pool_size) } : {}),
    ...(row.strategy != null ? { strategy: String(row.strategy) } : {}),
  };
}

/** Open a connection and apply migrations, failing fast on a bad URL. */
export async function openPostgres(opts: PostgresOptions): Promise<PostgresDatabase> {
  const db = new PostgresDatabase(opts);
  try {
    await db.migrate();
  } catch (error) {
    await db.close().catch(() => {});
    throw error;
  }
  return db;
}
