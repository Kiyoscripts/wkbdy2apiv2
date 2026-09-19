import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { CredentialStore } from '../src/workbuddy/credential-store.js';
import { PostgresAccountStore, PostgresApiKeyStore, PostgresTelemetryStore, openPostgres } from '../src/storage/postgres.js';
import type { PostgresDatabase } from '../src/storage/postgres.js';
import type { TelemetryRecord } from '../src/observability/telemetry.js';

/**
 * Storage tests against a real Postgres server.
 *
 * Skipped unless `WKB2API_TEST_DATABASE_URL` is set, so a developer without a
 * database still gets a green `pnpm test`. CI provides one and runs this file
 * explicitly (see the `postgres-storage` job).
 *
 * This file exists because the in-process double used by
 * `postgres-storage.test.ts` cannot cover the parts most likely to break in
 * production:
 *
 *  - `pg_advisory_lock`, which serializes concurrent boots.
 *  - `COUNT(*) FILTER (WHERE ...)`, used by the usage aggregate.
 *  - Genuine `TIMESTAMPTZ` round-tripping, where a naive driver reads back a
 *    Date and a string comparison silently misorders the history.
 */

const url = process.env.WKB2API_TEST_DATABASE_URL;

describe.skipIf(!url)('postgres storage (live server)', () => {
  let db: PostgresDatabase;
  let store: CredentialStore;
  const suffix = `t${Date.now().toString(36)}`;

  beforeAll(async () => {
    db = await openPostgres({ connectionString: url!, ssl: false, logger: undefined });
    store = CredentialStore.withGeneratedKey('/tmp/unused.enc');
  });

  afterAll(async () => {
    if (!db) return;
    // Leave the database as we found it; the CI service is disposable but a
    // developer's instance might not be.
    await db.pool.query('DELETE FROM request_log WHERE request_id LIKE $1', [`${suffix}%`]);
    await db.pool.query('DELETE FROM accounts').catch(() => {});
    await db.close();
  });

  it('applies the migration and is idempotent on a second boot', async () => {
    // A second openPostgres against the same database must not fail on
    // re-running the migrations; that is the redeploy path.
    const second = await openPostgres({ connectionString: url!, ssl: false });
    try {
      const { rows } = await second.pool.query<{ id: string }>('SELECT id FROM schema_migrations');
      expect(rows.map((r) => r.id)).toContain('001_init');
    } finally {
      await second.close();
    }
  });

  it('creates every table the code queries, including on an already-migrated database', async () => {
    // This is the regression test for a real bug: `api_keys` was originally
    // added by editing 001_init, but migrations are recorded by id, so a
    // database that had already applied 001_init never got the table. Fresh
    // databases worked and existing deployments broke — the worst combination.
    // Asserting the table exists after boot is what catches that.
    const { rows } = await db.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tables = rows.map((r) => r.table_name);
    for (const required of ['accounts', 'request_log', 'pool_events', 'api_keys', 'schema_migrations']) {
      expect(tables).toContain(required);
    }
  });

  it('records each migration separately so later ones still run', async () => {
    const { rows } = await db.pool.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id');
    const ids = rows.map((r) => r.id);
    // 002 must be its own row. If it were folded into 001 it would never be
    // applied to an existing database.
    expect(ids).toContain('002_api_keys');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('upgrades a database that is already at 001_init', async () => {
    // Simulates the real deployment being upgraded: a database where 001_init
    // already ran, so 002 has never been applied. Dropping the table and the
    // 002 record reproduces that state exactly.
    const control = await openPostgres({ connectionString: url!, ssl: false });
    try {
      await control.pool.query('DROP TABLE IF EXISTS api_keys');
      await control.pool.query("DELETE FROM schema_migrations WHERE id = '002_api_keys'");

      // A fresh boot must notice 002 is missing and apply it — without
      // re-running 001, which would fail on the existing tables.
      const upgraded = await openPostgres({ connectionString: url!, ssl: false });
      const { rows } = await upgraded.pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'api_keys'`,
      );
      expect(rows).toHaveLength(1);

      // And the registry is now usable, which is the point of the table.
      const registry = new PostgresApiKeyStore(upgraded);
      await registry.save([
        {
          id: 'upgrade-probe',
          name: 'probe',
          prefix: 'wkb_probe',
          hash: 'f'.repeat(64),
          created_at: new Date().toISOString(),
          request_count: 0,
          admin: true,
        },
      ]);
      expect((await registry.load()).some((k) => k.id === 'upgrade-probe')).toBe(true);
      await registry.save([]);
      await upgraded.close();
    } finally {
      await control.close();
    }
  });

  it('serializes concurrent migrations with an advisory lock', async () => {
    // Three boots at once, as several replicas would. Without the lock these
    // race on CREATE TABLE / INSERT INTO schema_migrations.
    const databases = await Promise.all(
      Array.from({ length: 3 }, () => openPostgres({ connectionString: url!, ssl: false })),
    );
    try {
      const { rows } = await databases[0]!.pool.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM schema_migrations WHERE id = $1',
        ['001_init'],
      );
      // Exactly one row: the migrations table was not duplicated.
      expect(Number(rows[0]!.count)).toBe(1);
    } finally {
      await Promise.all(databases.map((d) => d.close()));
    }
  });

  it('round-trips account state through a real connection', async () => {
    const accounts = new PostgresAccountStore(
      db,
      (snapshot) => store.encrypt(snapshot),
      (envelope) => store.decryptEnvelope(envelope),
    );
    const snapshot = {
      version: 1 as const,
      strategy: 'round-robin' as const,
      nextLabel: 3,
      accounts: [
        {
          label: `${suffix}-a`,
          credential: { accessToken: 'live-token', userId: 'u-live', domain: 'workbuddy.ai' },
        },
      ],
    };
    await accounts.save(snapshot);
    const loaded = await accounts.load();
    expect(loaded?.accounts[0]?.credential.accessToken).toBe('live-token');
    expect(loaded?.nextLabel).toBe(3);
  });

  it('aggregates usage per model, key, and account in SQL', async () => {
    const telemetry = new PostgresTelemetryStore(db, { batchSize: 1000, flushMs: 60_000 });
    const now = new Date().toISOString();
    const records: TelemetryRecord[] = [
      { time: now, request_id: `${suffix}-1`, method: 'POST', path: '/v1/chat/completions', status: 200, model: 'alpha', stream: false, duration_ms: 10, prompt_tokens: 100, completion_tokens: 50, attempts: 1, retries: 0, key_id: `${suffix}-k1`, account: `${suffix}-acct` },
      { time: now, request_id: `${suffix}-2`, method: 'POST', path: '/v1/chat/completions', status: 200, model: 'alpha', stream: false, duration_ms: 10, prompt_tokens: 100, completion_tokens: 25, attempts: 1, retries: 0, key_id: `${suffix}-k1`, account: `${suffix}-acct` },
      { time: now, request_id: `${suffix}-3`, method: 'POST', path: '/v1/messages', status: 500, model: 'beta', stream: true, duration_ms: 10, attempts: 2, retries: 1, error_code: 'upstream_error', error_class: 'UpstreamError', key_id: `${suffix}-k2` },
    ];
    for (const record of records) telemetry.request(record);
    await telemetry.flush();

    const aggregate = await telemetry.aggregate(3_600_000);
    const alpha = aggregate.per_model.find((m) => m.model === 'alpha');
    const beta = aggregate.per_model.find((m) => m.model === 'beta');
    // 100+50 and 100+25 for alpha; the failed beta request has no token counts.
    expect(alpha?.tokens).toBe(275);
    expect(beta?.tokens).toBe(0);

    const key1 = aggregate.per_key.find((k) => k.key_id === `${suffix}-k1`);
    expect(key1?.requests).toBe(2);
    expect(key1?.tokens).toBe(275);

    const account = aggregate.per_account.find((a) => a.account === `${suffix}-acct`);
    expect(account?.requests).toBe(2);

    // FILTER (WHERE status >= 400) — the clause pg-mem cannot run.
    expect(aggregate.errors).toBeGreaterThanOrEqual(1);
    expect(aggregate.error_codes.some((e) => e.code === 'upstream_error')).toBe(true);
  });

  it('orders read-back history correctly across TIMESTAMPTZ values', async () => {
    const telemetry = new PostgresTelemetryStore(db, { batchSize: 1000, flushMs: 60_000 });
    const base = Date.now();
    telemetry.request({ time: new Date(base - 120_000).toISOString(), request_id: `${suffix}-old`, method: 'GET', path: '/v1/models', status: 200, stream: false, duration_ms: 1, attempts: 1, retries: 0 });
    telemetry.request({ time: new Date(base).toISOString(), request_id: `${suffix}-new`, method: 'GET', path: '/v1/models', status: 200, stream: false, duration_ms: 1, attempts: 1, retries: 0 });
    await telemetry.flush();

    const events = await telemetry.read(50);
    const ids = events
      .filter((e) => e.kind === 'request' && (e.record as TelemetryRecord).request_id.startsWith(suffix))
      .map((e) => (e.record as TelemetryRecord).request_id);
    expect(ids.indexOf(`${suffix}-old`)).toBeLessThan(ids.indexOf(`${suffix}-new`));
  });

  it('survives a simulated restart: data written by one pool is read by another', async () => {
    // This is the whole point of the backend — a redeploy must not lose state.
    const telemetry = new PostgresTelemetryStore(db, { batchSize: 10, flushMs: 60_000 });
    telemetry.request({ time: new Date().toISOString(), request_id: `${suffix}-persist`, method: 'POST', path: '/v1/chat/completions', status: 200, stream: false, duration_ms: 5, attempts: 1, retries: 0 });
    await telemetry.flush();
    await telemetry.close();

    const fresh = new PostgresTelemetryStore(db, { batchSize: 10, flushMs: 60_000 });
    try {
      const events = await fresh.read(500);
      expect(
        events.some((e) => e.kind === 'request' && (e.record as TelemetryRecord).request_id === `${suffix}-persist`),
      ).toBe(true);
    } finally {
      await fresh.close();
    }
  });

  it('reports readiness through ping', async () => {
    await expect(db.ping()).resolves.toBeUndefined();
  });
});
