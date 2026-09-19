import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TelemetrySink } from '../observability/telemetry.js';
import type { Logger } from '../observability/logger.js';
import { CredentialStore, type CredentialStoreSnapshot } from '../workbuddy/credential-store.js';
import type { ApiKeyRecord } from '../security/api-keys.js';
import type { AccountStateStore, ApiKeyStore, TelemetryStore } from './types.js';
import { PostgresAccountStore, PostgresApiKeyStore, PostgresTelemetryStore, openPostgres } from './postgres.js';

/**
 * Chooses and wires the persistence backends.
 *
 * The gateway supports two storage modes and the distinction matters enough to
 * be explicit at startup rather than inferred:
 *
 *  - **file** — encrypted blob plus JSONL on local disk. Correct for a
 *    developer machine or a container with a real volume; loses everything on
 *    an ephemeral filesystem.
 *  - **postgres** — both in a database. Required for hosts that recycle the
 *    filesystem (Render, Heroku, most serverless container platforms) and the
 *    only mode where usage queries survive a deploy.
 *
 * Selection is by `WKB2API_STORAGE_BACKEND`. When it is `postgres` but no
 * connection string is configured the gateway refuses to boot: silently falling
 * back to a file backend on an ephemeral host is exactly the failure this
 * feature exists to prevent, and it would look like it worked until the first
 * restart.
 */

export type StorageBackend = 'file' | 'postgres';

export type StorageOptions = {
  backend: StorageBackend;
  /** Postgres connection string. Required when backend is 'postgres'. */
  databaseUrl?: string;
  /** Require TLS for the database connection. Defaults to true for remote hosts. */
  databaseSsl?: boolean;
  /** Max database connections. */
  databasePoolSize?: number;
  /** File-backend account store. Always constructed so the key can be reused. */
  credentialStore: CredentialStore;  /** File-backend telemetry path. Empty string disables persistence. */
  telemetryPath: string;
  telemetryMaxBytes?: number;
  /** File-backend API-key registry path. */
  apiKeysPath: string;
  logger?: Logger;
};

export type Storage = {
  backend: StorageBackend;
  accounts: AccountStateStore;
  telemetry: TelemetryStore;
  /** API-key registry, hashes only. */
  apiKeys: ApiKeyStore;
  /** Total token accounting that outlives a restart (Postgres only). */
  usage: UsageReporter;
  /** Release database resources. No-op for the file backend. */
  close: () => Promise<void>;
  describe: () => string;
};

/**
 * Rolling-window usage queries.
 *
 * The file backend cannot answer these across restarts, so it reports
 * `available: false` instead of returning zeros that would read as "no usage".
 */
export type UsageReporter = {
  available: boolean;
  window: (sinceMs: number) => Promise<Awaited<ReturnType<TelemetryStore['aggregate']>>>;
};

const FILE_ACCOUNTS: (store: CredentialStore) => AccountStateStore = (store) => ({
  kind: 'file',
  durable: true,
  describe: () => 'file (encrypted blob)',
  load: () => store.load(),
  save: (snapshot) => store.save(snapshot),
});

/**
 * API-key registry on disk.
 *
 * Plain JSON, not the encrypted envelope: the file holds hashes and counters,
 * never a usable key. It is written atomically through a temp file and rename
 * so a crash mid-write cannot truncate the registry and lock out every client
 * except the bootstrap key.
 */
class FileApiKeyStore implements ApiKeyStore {
  readonly kind = 'file' as const;

  constructor(private readonly path: string) {}

  describe(): string {
    return `file (${this.path})`;
  }

  async load(): Promise<ApiKeyRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    try {
      const parsed = JSON.parse(raw) as { version?: number; keys?: ApiKeyRecord[] };
      return Array.isArray(parsed.keys) ? parsed.keys : [];
    } catch {
      // A corrupt registry must not prevent boot: the bootstrap env key still
      // works, and the panel can rebuild the list from scratch.
      return [];
    }
  }

  async save(records: ApiKeyRecord[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    // 0o600: the file is not secret, but it names clients and their usage and
    // there is no reason for it to be world-readable.
    await writeFile(temporary, JSON.stringify({ version: 1, keys: records }, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}

export async function createStorage(opts: StorageOptions): Promise<Storage> {
  if (opts.backend === 'file') return createFileStorage(opts);
  return createPostgresStorage(opts);
}

function createFileStorage(opts: StorageOptions): Storage {
  const telemetry = new TelemetrySink({
    path: opts.telemetryPath,
    ...(opts.telemetryMaxBytes !== undefined ? { maxBytes: opts.telemetryMaxBytes } : {}),
    onError: (error) => {
      opts.logger?.error('telemetry persistence disabled', {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return {
    backend: 'file',
    accounts: FILE_ACCOUNTS(opts.credentialStore),
    telemetry: wrapSink(telemetry),
    apiKeys: new FileApiKeyStore(opts.apiKeysPath),
    usage: {
      available: false,
      // Returning null rather than a zeroed aggregate: the caller must be able
      // to distinguish "no recorded usage" from "usage is not queryable here".
      window: async () => null,
    },
    // Drain queued telemetry appends before the process exits, so a graceful
    // shutdown does not lose the last requests. Mirrors the Postgres backend,
    // whose close() also flushes its buffer.
    close: () => telemetry.flush(),
    describe: () => `file (accounts + ${telemetry.enabled ? opts.telemetryPath : 'telemetry disabled'})`,
  };
}

async function createPostgresStorage(opts: StorageOptions): Promise<Storage> {
  const url = opts.databaseUrl?.trim();
  if (!url) {
    throw new Error(
      'WKB2API_STORAGE_BACKEND=postgres requires WKB2API_DATABASE_URL. ' +
        'Refusing to start: falling back to a local file on an ephemeral host would lose ' +
        'the account pool on the next restart.',
    );
  }
  // A malformed URL produces a confusing driver error much later; catching it
  // here names the variable that is wrong.
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(
      'WKB2API_DATABASE_URL must start with postgres:// or postgresql:// ' +
        '(some hosts provide a bare hostname or a URL with another scheme).',
    );
  }

  const db = await openPostgres({
    connectionString: url,
    ssl: opts.databaseSsl ?? isRemoteHost(url),
    maxConnections: opts.databasePoolSize ?? 5,
    ...(opts.logger ? { logger: opts.logger } : {}),
  });

  const accounts = new PostgresAccountStore(
    db,
    (snapshot: CredentialStoreSnapshot) => opts.credentialStore.encrypt(snapshot),
    (envelope: string) => opts.credentialStore.decryptEnvelope(envelope),
  );
  const telemetry = new PostgresTelemetryStore(db, {
    ...(opts.logger ? { logger: opts.logger } : {}),
  });

  return {
    backend: 'postgres',
    accounts,
    telemetry,
    apiKeys: new PostgresApiKeyStore(db),
    usage: {
      available: true,
      window: (sinceMs: number) => telemetry.aggregate(sinceMs),
    },
    close: async () => {
      await telemetry.flush();
      await db.close();
    },
    describe: () => `postgres (accounts + request_log)`,
  };
}

/**
 * Managed database hosts require TLS; a sidecar on a private network usually
 * does not present a certificate. Defaulting by host keeps the common case
 * working without an operator having to know which they have.
 */
function isRemoteHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.internal'));
  } catch {
    return true;
  }
}

/**
 * Adapt the JSONL sink to the TelemetryStore interface.
 *
 * The sink is synchronous by design (it owns its own write queue), so this only
 * has to supply the async read path and report that aggregation is unavailable.
 */
function wrapSink(sink: TelemetrySink): TelemetryStore {
  return {
    kind: 'file',
    enabled: sink.enabled,
    describe: () => (sink.enabled ? 'file (JSONL)' : 'disabled'),
    request: (record) => sink.request(record),
    pool: (record) => sink.pool(record),
    read: (limit) => sink.read(limit),
    aggregate: async () => null,
    // Forward to the sink: `TelemetrySink` queues appends fire-and-forget, so
    // this is the only way a caller can wait for them. Leaving it as a no-op
    // made the file backend silently lossy — `storage.close()` resolved while
    // appends were still queued and the process exited, dropping the last
    // requests of every run. The Postgres backend always drained; only this one
    // pretended to.
    flush: () => sink.flush(),
  };
}
