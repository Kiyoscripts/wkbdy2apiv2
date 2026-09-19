import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig, type AppConfig } from './config.js';
import { createLogger, type Logger } from './observability/logger.js';
import { createMetrics } from './observability/metrics.js';
import { toTelemetryRecord } from './observability/telemetry.js';
import { createRateLimiter } from './security/rate-limit.js';
import { buildApp } from './app.js';
import { buildCatalog, parseProductConfig } from './workbuddy/model-catalog.js';
import { WorkBuddyClient } from './workbuddy/client.js';
import { CredentialPool } from './workbuddy/credential-pool.js';
import { CredentialStore } from './workbuddy/credential-store.js';
import { ApiKeyRegistry } from './security/api-keys.js';
import { createStorage, type Storage } from './storage/index.js';

/**
 * Encrypted account store, resolving the key in priority order.
 *
 * 1. **WKB2API_ACCOUNT_STORE_KEY_B64** — the key arrives as configuration. This
 *    is the shape for hosts with no persistent disk (Render): the key lives in
 *    the environment, the encrypted state lives in the database, and nothing
 *    has to be mounted. It is stable across restarts, so accounts survive.
 * 2. **WKB2API_ACCOUNT_STORE_KEY_FILE** — a mounted key file.
 * 3. **Generated in-process**, only when WKB2API_ALLOW_EPHEMERAL_STORE is on.
 *    Accounts added in this mode are unreadable after a restart, so the caller
 *    is told rather than left to discover an empty pool later.
 */
async function openCredentialStore(
  config: AppConfig,
  log: Logger,
): Promise<{ store: CredentialStore; notice?: string }> {
  const storePath = resolve(config.accountStorePath);

  if (config.accountStoreKeyB64) {
    return { store: CredentialStore.fromKeyValue(storePath, config.accountStoreKeyB64) };
  }

  if (config.accountStoreKeyFile) {
    try {
      const store = await CredentialStore.fromKeyFile(storePath, resolve(config.accountStoreKeyFile));
      return { store };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!config.allowEphemeralStore) {
        throw new Error(
          `Cannot read the account-store key file (${config.accountStoreKeyFile}): ${detail}. ` +
            'Set WKB2API_ACCOUNT_STORE_KEY_B64 with a base64 32-byte key, or ' +
            'WKB2API_ALLOW_EPHEMERAL_STORE=true to run with a throwaway key instead.',
        );
      }
      return ephemeral(storePath, log, detail);
    }
  }

  // No key configured at all. On a host with a persistent disk this is a
  // likely mistake, so the message names both ways to supply one.
  if (!config.allowEphemeralStore) {
    throw new Error(
      'No account-store encryption key configured. Set WKB2API_ACCOUNT_STORE_KEY_B64 to a base64 ' +
        '32-byte key (preferred on hosts without a persistent disk), or set ' +
        'WKB2API_ACCOUNT_STORE_KEY_FILE to a mounted key file, or set ' +
        'WKB2API_ALLOW_EPHEMERAL_STORE=true to run with a throwaway key that will not survive a restart.',
    );
  }
  return ephemeral(storePath, log, 'no key configured');
}

/**
 * Fall back to an in-process key.
 *
 * Accounts added in this mode are undecryptable after the next restart, so the
 * caller is told explicitly rather than being left to find an empty pool later.
 */
function ephemeral(
  storePath: string,
  log: Logger,
  reason: string,
): { store: CredentialStore; notice: string } {
  const notice =
    `Using an ephemeral in-process encryption key (${reason}). ` +
    'Accounts added now will NOT survive a restart. Set WKB2API_ACCOUNT_STORE_KEY_B64 to persist them.';
  log.warn(notice);
  return { store: CredentialStore.withGeneratedKey(storePath), notice };
}

/** Human-readable summary of conditions an operator should know after boot. */
function buildStartupNotice(input: {
  notice?: string;
  restored: boolean;
  poolSize: number;
  storage: Storage;
}): string | undefined {
  const parts: string[] = [];
  if (input.notice) parts.push(input.notice);
  if (!input.restored && input.poolSize === 0) {
    parts.push(
      input.storage.backend === 'postgres'
        ? 'No accounts were found in the database; the pool is empty and /v1 calls will fail until one is added.'
        : 'No accounts were restored from the encrypted store; the pool is empty and /v1 calls will fail until one is added.',
    );
  }
  if (!input.storage.telemetry.enabled) {
    parts.push('Request telemetry persistence is disabled; only the in-memory window is available.');
  }
  if (input.storage.accounts.kind === 'file' && isEphemeralHost()) {
    parts.push(
      'Storage backend is "file" on a host with an ephemeral filesystem: the account pool will be lost on the next deploy. Set WKB2API_STORAGE_BACKEND=postgres with WKB2API_DATABASE_URL to persist it.',
    );
  }
  // The env-key shape is the intended one on an ephemeral host, so only warn
  // when the key itself is also unstable.
  if (CredentialStore.lastKeySource === 'generated' && isEphemeralHost()) {
    parts.push(
      'The account-store encryption key was generated in-process on a host with an ephemeral filesystem: every stored account becomes undecryptable after a restart. Set WKB2API_ACCOUNT_STORE_KEY_B64.',
    );
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Best-effort detection of hosts that discard the filesystem between deploys.
 *
 * Render sets RENDER=true; most container platforms expose a similar flag. This
 * only drives a warning — it never changes behaviour — so a false positive
 * costs one log line rather than a wrong decision.
 */
function isEphemeralHost(): boolean {
  const env = process.env;
  return Boolean(env.RENDER || env.RENDER_SERVICE_ID || env.DYNO || env.FLY_APP_NAME || env.K_SERVICE);
}

async function loadModels(configPath: string) {
  const raw = JSON.parse(await readFile(configPath, 'utf8'));
  const config = parseProductConfig(raw);
  return buildCatalog(config);
}

/**
 * Load the local .env file so config keys work without manual export. Uses
 * Node's native loader (no dependency). A missing .env is fine — the process
 * env / explicit variables still apply with precedence over .env values.
 */
function loadLocalEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // .env absent or unreadable — rely on the process environment instead.
  }
}

async function main() {
  loadLocalEnv();
  const config = loadConfig();
  const log = createLogger(config.logLevel);

  const configPath = resolve('wb_v3config.public.json');
  const models = await loadModels(configPath);
  log.info('catalog loaded', { model_count: models.length });

  const { store: credentialStore, notice } = await openCredentialStore(config, log);

  // Storage selection happens before anything else touches state: the account
  // pool and the telemetry history must come from the same place, and a
  // misconfigured Postgres should stop the boot rather than degrade silently.
  const storage = await createStorage({
    backend: config.storageBackend,
    ...(config.databaseUrl ? { databaseUrl: config.databaseUrl } : {}),
    ...(config.databaseSsl !== undefined ? { databaseSsl: config.databaseSsl } : {}),
    databasePoolSize: config.databasePoolSize,
    credentialStore,
    telemetryPath: config.telemetryPath,
    telemetryMaxBytes: config.telemetryMaxBytes,
    apiKeysPath: config.apiKeysPath,
    logger: log,
  });
  log.info('storage backend ready', { backend: storage.backend, detail: storage.describe() });

  /**
   * API-key registry.
   *
   * The env key (`WKB2API_API_KEY`) is passed in as the bootstrap credential, so
   * it is always valid and always admin regardless of what the registry holds.
   * That is the anti-lockout guarantee: deleting every key through the panel
   * cannot strand an operator outside the panel that manages keys.
   *
   * Refusing to boot without it (config already requires >= 16 chars) is what
   * makes that guarantee unconditional.
   */
  const apiKeys = new ApiKeyRegistry(config.apiKey);
  let bootstrapSeeded = false;
  try {
    const stored = await storage.apiKeys.load();
    if (stored.length === 0) {
      // First boot with an empty registry: issue a distinct named admin key so
      // the panel is usable immediately with a credential that is not the same
      // string as the env bootstrap key, and that can be revoked independently.
      const issued = apiKeys.create({
        name: 'default admin',
        admin: true,
        note: 'Created at first boot. Revoke once you have issued your own keys.',
      });
      bootstrapSeeded = true;
      await storage.apiKeys.save(apiKeys.list());
      // The plaintext is shown once, here, because this is the only moment it
      // exists outside the client's config.
      log.warn('no API keys found; created a default admin key', {
        name: issued.record.name,
        key: issued.key,
        note: 'Store this now — only a hash is kept and it cannot be shown again.',
      });
    } else {
      apiKeys.restore(stored);
    }
  } catch (error) {
    log.error('could not load the API-key registry; continuing with the bootstrap key only', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const persistKeys = () => storage.apiKeys.save(apiKeys.list());
  log.info('api keys loaded', { count: apiKeys.size(), seeded: bootstrapSeeded, bootstrap_env_key: true });

  const pool = new CredentialPool({ strategy: 'round-robin' });
  let snapshotRestored = false;
  try {
    const snapshot = await storage.accounts.load();
    if (snapshot) {
      pool.restore(snapshot);
      snapshotRestored = true;
    }
  } catch (error) {
    // An unreadable store usually means the encryption key changed (for
    // example an ephemeral key regenerated on restart). Refusing to boot would
    // be worse than starting empty and saying so loudly.
    log.error('account state could not be loaded; starting with an empty pool', {
      error: error instanceof Error ? error.message : String(error),
      backend: storage.backend,
    });
  }
  log.info('account pool restored', { account_count: pool.size, strategy: pool.strategyName });

  const metrics = createMetrics();
  // Every recorded request also lands in the durable history, whether that is
  // a JSONL file or a database table.
  metrics.setSink((entry) => storage.telemetry.request(toTelemetryRecord(entry)));
  pool.setEventSink((event) => {
    storage.telemetry.pool(event);
    // Persist account changes. The pool previously held the store reference
    // itself; routing through the storage layer means a database-backed
    // deployment gets the same write-through behaviour as the file one.
    void storage.accounts.save(pool.snapshotForStorage()).catch((error) => {
      log.error('could not persist account state', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  const rateLimiter = createRateLimiter({ requestsPerMinute: config.rateLimitRpm, tokensPerDay: config.tokenQuotaPerDay });
  if (rateLimiter.enabled) {
    log.info('per-key limits active', { requests_per_minute: config.rateLimitRpm, tokens_per_day: config.tokenQuotaPerDay });
    // Drop stats for keys that have been idle for over a day.
    const sweeper = setInterval(() => rateLimiter.sweep(), 60 * 60_000);
    sweeper.unref?.();
  }

  const startupNotice = buildStartupNotice({
    notice,
    restored: snapshotRestored,
    poolSize: pool.size,
    storage,
  });
  if (startupNotice) log.warn('startup notice', { notice: startupNotice });

  const client = new WorkBuddyClient({
    upstreamUrl: config.upstreamUrl,
    credentials: pool,
    userAgent: config.upstreamUa,
    firstByteTimeoutMs: config.firstByteTimeoutMs,
    idleTimeoutMs: config.idleTimeoutMs,
  });

  const version = (await readFile(resolve('package.json'), 'utf8').then((p) => JSON.parse(p).version ?? '0.0.0', () => '0.0.0')) as string;

  const app = buildApp({
    apiKey: config.apiKey,
    apiKeys,
    // Persist the usage counters, but not on every request: the counters are
    // diagnostics, and a database round trip per call would be real cost for
    // cosmetic freshness. The panel mutation paths persist immediately.
    onKeyUsed: (() => {
      let last = 0;
      return () => {
        const now = Date.now();
        if (now - last < 30_000) return;
        last = now;
        void persistKeys().catch(() => {});
      };
    })(),
    persistKeys,
    models,
    client,
    pool,
    credentialsPath: config.credentialsPath,
    modelAliases: config.modelAliases,
    toolTracePath: config.toolTracePath,
    metrics,
    rateLimits: { requestsPerMinute: config.rateLimitRpm, tokensPerDay: config.tokenQuotaPerDay },
    onUsage: ({ keyId, usage }) => {
      if (keyId && usage?.total_tokens) rateLimiter.recordTokens(keyId, usage.total_tokens);
    },
    startupNotice,
    upstreamUrl: config.upstreamUrl,
    upstreamUa: config.upstreamUa,
    startedAt: Date.now(),
    version,
    // The panel reads history through the storage layer, so it shows database
    // rows when Postgres is configured and JSONL lines otherwise.
    telemetry: storage.telemetry,
    usageReporter: storage.usage,
    storage: {
      backend: storage.backend,
      describe: storage.describe(),
      persistentAccounts: true,
      persistentTelemetry: storage.telemetry.enabled,
    },
  });

  app.addHook('onRequest', async (req, reply) => {
    const t0 = performance.now();
    reply.raw.on('finish', () => {
      log.info('request', {
        method: req.method,
        url: req.url,
        status: reply.statusCode,
        duration_ms: Math.round(performance.now() - t0),
      });
    });
  });

  try {
    await app.listen({ port: config.port, host: config.host });
    log.info('listening', { host: config.host, port: config.port, admin: `http://${config.host}:${config.port}/admin` });
  } catch (err) {
    log.fatal('failed to listen', { host: config.host, port: config.port, error: String(err) });
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    // Drain buffered telemetry before the database pool closes, or the last
    // batch of requests is lost on every restart.
    await storage.close().catch((error) => {
      log.error('storage shutdown failed', { error: String(error) });
    });
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
