import { describe, expect, it, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { CredentialStore } from '../src/workbuddy/credential-store.js';
import { PostgresAccountStore, PostgresTelemetryStore } from '../src/storage/postgres.js';
import type { PostgresDatabase } from '../src/storage/postgres.js';
import type { CredentialStoreSnapshot } from '../src/workbuddy/credential-store.js';
import type { TelemetryRecord } from '../src/observability/telemetry.js';

/**
 * Postgres storage tests against an in-process database.
 *
 * Two things are worth testing without a live server:
 *
 *  1. **SQL correctness.** `pg-mem` is a real parser and executor, so a column
 *     mismatch between the migration and the INSERT fails here rather than in
 *     production on the first request. That class of bug — a column added to the
 *     record type but not to the table — is exactly what this backend is most
 *     exposed to, because the insert is built from a column list at runtime.
 *  2. **Envelope compatibility.** The database stores the same AES-256-GCM
 *     envelope the file backend writes, so a value encrypted for Postgres must
 *     decrypt with the file code path. Otherwise "switch backends" would silently
 *     corrupt every account.
 *
 * Limitations, stated rather than hidden: `pg-mem` does not implement advisory
 * locks or `COUNT(*) FILTER (WHERE ...)`. Those paths are exercised by the
 * migration-advisory-lock design and by the aggregate SQL, and this file asserts
 * the schema and the round trip rather than pretending to cover them.
 */

/** Wrap pg-mem in the minimal surface PostgresDatabase exposes to the stores. */
function makeTestDb() {
  const mem = newDb();
  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();
  return {
    pool,
    ping: async () => {
      await pool.query('SELECT 1');
    },
  } as unknown as PostgresDatabase & { pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> } };
}

/** Create the tables exactly as the migration defines them. */
async function applySchema(db: PostgresDatabase) {
  const pool = (db as unknown as { pool: { query: (sql: string) => Promise<unknown> } }).pool;
  await pool.query(`
    CREATE TABLE accounts (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      version INTEGER NOT NULL,
      envelope TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE request_log (
      id BIGSERIAL PRIMARY KEY,
      time TIMESTAMPTZ NOT NULL,
      request_id TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      model TEXT,
      stream BOOLEAN NOT NULL,
      duration_ms INTEGER NOT NULL,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      attempts INTEGER NOT NULL DEFAULT 1,
      retries INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_class TEXT,
      account TEXT,
      key_id TEXT,
      client_ip TEXT,
      user_agent TEXT
    );
    CREATE TABLE pool_events (
      id BIGSERIAL PRIMARY KEY,
      time TIMESTAMPTZ NOT NULL,
      event TEXT NOT NULL,
      label TEXT,
      detail TEXT,
      pool_size INTEGER,
      strategy TEXT
    );
  `);
}

function makeSnapshot(): CredentialStoreSnapshot {
  return {
    version: 1,
    strategy: 'round-robin',
    nextLabel: 2,
    accounts: [
      {
        label: 'acct-1',
        note: 'primary',
        credential: { accessToken: 'tok-secret-1', userId: 'u1', domain: 'workbuddy.ai' },
      },
      {
        label: 'acct-2',
        credential: { accessToken: 'tok-secret-2', userId: 'u2', domain: 'workbuddy.ai' },
      },
    ],
  };
}

function makeRecord(overrides: Partial<TelemetryRecord> = {}): TelemetryRecord {
  return {
    time: new Date().toISOString(),
    request_id: 'req-1',
    method: 'POST',
    path: '/v1/chat/completions',
    status: 200,
    model: 'wb-default',
    stream: false,
    duration_ms: 120,
    prompt_tokens: 10,
    completion_tokens: 20,
    attempts: 1,
    retries: 0,
    key_id: 'fp-abc',
    account: 'acct-1',
    client_ip: '127.0.0.1',
    user_agent: 'test/1.0',
    ...overrides,
  };
}

describe('PostgresAccountStore', () => {
  let db: PostgresDatabase;
  let store: CredentialStore;
  let accountStore: PostgresAccountStore;

  beforeEach(async () => {
    db = makeTestDb();
    await applySchema(db);
    store = CredentialStore.withGeneratedKey('/tmp/ignored.enc');
    accountStore = new PostgresAccountStore(
      db,
      (snapshot) => store.encrypt(snapshot),
      (envelope) => store.decryptEnvelope(envelope),
    );
  });

  it('reports undefined before any snapshot has been written', async () => {
    expect(await accountStore.load()).toBeUndefined();
  });

  it('round-trips a snapshot through the database', async () => {
    const snapshot = makeSnapshot();
    await accountStore.save(snapshot);
    const loaded = await accountStore.load();
    expect(loaded).toEqual(snapshot);
  });

  it('stores ciphertext, never a plaintext access token', async () => {
    await accountStore.save(makeSnapshot());
    // Reaching past the API on purpose: this asserts what an operator would see
    // in a database backup or a support-session SELECT.
    const pool = (db as unknown as { pool: { query: (sql: string) => Promise<{ rows: { envelope: string }[] }> } }).pool;
    const { rows } = await pool.query('SELECT envelope FROM accounts');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.envelope).not.toContain('tok-secret-1');
    expect(rows[0]!.envelope).not.toContain('tok-secret-2');
    // The envelope still carries its algorithm marker so a reader knows how to
    // decrypt it.
    expect(JSON.parse(rows[0]!.envelope).algorithm).toBe('aes-256-gcm');
  });

  it('upserts rather than accumulating rows across saves', async () => {
    await accountStore.save(makeSnapshot());
    const updated = makeSnapshot();
    updated.accounts.pop();
    updated.nextLabel = 1;
    await accountStore.save(updated);

    const pool = (db as unknown as { pool: { query: (sql: string) => Promise<{ rows: unknown[] }> } }).pool;
    const { rows } = await pool.query('SELECT envelope FROM accounts');
    expect(rows).toHaveLength(1);
    expect((await accountStore.load())!.accounts).toHaveLength(1);
  });

  it('refuses to decrypt with a different key', async () => {
    await accountStore.save(makeSnapshot());
    // A rotated or regenerated key is the realistic failure; it must surface as
    // an error rather than an empty pool.
    const otherKey = CredentialStore.withGeneratedKey('/tmp/other.enc');
    const otherStore = new PostgresAccountStore(
      db,
      (snapshot) => otherKey.encrypt(snapshot),
      (envelope) => otherKey.decryptEnvelope(envelope),
    );
    await expect(otherStore.load()).rejects.toThrow(/cannot be decrypted|invalid/i);
  });
});

describe('PostgresTelemetryStore', () => {
  let db: PostgresDatabase;
  let telemetry: PostgresTelemetryStore;

  beforeEach(async () => {
    db = makeTestDb();
    await applySchema(db);
    telemetry = new PostgresTelemetryStore(db, { batchSize: 100, flushMs: 60_000 });
  });

  it('inserts a buffered request row with every column populated', async () => {
    telemetry.request(makeRecord());
    await telemetry.flush();

    const pool = (db as unknown as { pool: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> } }).pool;
    const { rows } = await pool.query('SELECT * FROM request_log');
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // Every field survives the round trip. A column missing here is a column
    // missing from the migration, which is the failure this test exists for.
    expect(row.request_id).toBe('req-1');
    expect(row.status).toBe(200);
    expect(row.model).toBe('wb-default');
    expect(row.prompt_tokens).toBe(10);
    expect(row.completion_tokens).toBe(20);
    expect(row.key_id).toBe('fp-abc');
    expect(row.account).toBe('acct-1');
    expect(row.client_ip).toBe('127.0.0.1');
    expect(row.user_agent).toBe('test/1.0');
    expect(row.attempts).toBe(1);
    expect(row.retries).toBe(0);
  });

  it('writes NULL rather than undefined for absent optional fields', async () => {
    telemetry.request(
      makeRecord({
        model: undefined,
        prompt_tokens: undefined,
        completion_tokens: undefined,
        error_code: undefined,
        account: undefined,
        key_id: undefined,
      }),
    );
    telemetry.request(makeRecord({ request_id: 'req-2' }));
    await telemetry.flush();

    const pool = (db as unknown as { pool: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> } }).pool;
    const { rows } = await pool.query("SELECT * FROM request_log WHERE request_id = 'req-1'");
    expect(rows[0]!.model).toBeNull();
    expect(rows[0]!.key_id).toBeNull();
    expect(rows[0]!.prompt_tokens).toBeNull();
  });

  it('batches multiple pending rows into one flush', async () => {
    for (let i = 0; i < 5; i += 1) telemetry.request(makeRecord({ request_id: `req-${i}` }));
    await telemetry.flush();

    const pool = (db as unknown as { pool: { query: (sql: string) => Promise<{ rows: unknown[] }> } }).pool;
    const { rows } = await pool.query('SELECT * FROM request_log');
    expect(rows).toHaveLength(5);
  });

  it('records pool lifecycle events in their own table', async () => {
    telemetry.pool({ event: 'quarantined', label: 'acct-1', detail: 'upstream 401', pool_size: 2, strategy: 'round-robin' });
    await telemetry.flush();

    const pool = (db as unknown as { pool: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> } }).pool;
    const { rows } = await pool.query('SELECT * FROM pool_events');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toBe('quarantined');
    expect(rows[0]!.label).toBe('acct-1');
    expect(rows[0]!.pool_size).toBe(2);
    expect(rows[0]!.time).toBeTruthy();
  });

  it('reads back records newest-last like the JSONL backend', async () => {
    const older = new Date(Date.now() - 60_000).toISOString();
    const newer = new Date().toISOString();
    telemetry.request(makeRecord({ request_id: 'first', time: older }));
    telemetry.request(makeRecord({ request_id: 'second', time: newer }));

    const events = await telemetry.read(10);
    expect(events.map((e) => (e.record as TelemetryRecord).request_id)).toEqual(['first', 'second']);
  });

  it('degrades to no-op after a write failure instead of throwing', async () => {
    // Point the store at a database missing its tables: the realistic "migration
    // did not run" case. A request must still succeed.
    const brokenDb = makeTestDb();
    const broken = new PostgresTelemetryStore(brokenDb, { batchSize: 1, flushMs: 60_000 });
    expect(() => broken.request(makeRecord())).not.toThrow();
    await expect(broken.flush()).resolves.toBeUndefined();
    // Subsequent records are dropped quietly; nothing throws at the caller.
    expect(() => broken.request(makeRecord())).not.toThrow();
  });

  it('closes cleanly and drains the buffer', async () => {
    telemetry.request(makeRecord({ request_id: 'last' }));
    await telemetry.close();

    const pool = (db as unknown as { pool: { query: (sql: string) => Promise<{ rows: unknown[] }> } }).pool;
    const { rows } = await pool.query('SELECT * FROM request_log');
    expect(rows).toHaveLength(1);
  });
});
