import { z } from 'zod';

const envSchema = z.object({
  /** Loopback bind address. Only override for controlled testing. */
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(7891),
  /** Local API key required from all downstream callers. No default: refuse to run without it. */
  WKB2API_API_KEY: z.string().min(16, 'WKB2API_API_KEY must be at least 16 chars'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  /** Upstream override (defaults to the verified WorkBuddy endpoint). */
  WKB2API_UPSTREAM_URL: z.string().url().default('https://www.workbuddy.ai/v2/chat/completions'),
  /** Upstream User-Agent. Upstream enforces single-segment 'name/version'. */
  WKB2API_UPSTREAM_UA: z.string().default('WorkBuddy/2.137.1'),
  /** Timeouts (ms). */
  WKB2API_FIRST_BYTE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  WKB2API_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  /** Encrypted OAuth account store and its independent 32-byte key file. */
  WKB2API_ACCOUNT_STORE_PATH: z.string().default('data/accounts.enc'),
  /**
   * Mounted key file, OR the base64 key value below, OR neither.
   *
   * Deliberately optional at the schema level. Requiring it here would make it
   * impossible to deploy with only `WKB2API_ACCOUNT_STORE_KEY_B64` set — the
   * shape used on hosts with no persistent disk — and would also turn a clear
   * "you configured no key" message into a schema error. `openCredentialStore`
   * enforces that *some* key is available, with a message explaining the options.
   */
  WKB2API_ACCOUNT_STORE_KEY_FILE: z.string().optional(),
  /** Local WorkBuddy credential file used only by the admin import endpoint. */
  WKB2API_CREDENTIALS_PATH: z.string().optional(),
  /** JSONL path for raw tool-call frame tracing. Empty string disables it. */
  WKB2API_TOOL_TRACE_PATH: z.string().default('data/tool-calls.jsonl'),
  /**
   * Durable JSONL request telemetry. Empty string disables persistence and
   * falls back to the in-memory ring buffer only.
   */
  WKB2API_TELEMETRY_PATH: z.string().default('data/requests.jsonl'),
  /** Telemetry rotation threshold in bytes. Default 32 MiB. */
  WKB2API_TELEMETRY_MAX_BYTES: z.coerce.number().int().positive().default(32 * 1024 * 1024),
  /** Per-key request limit per rolling minute. 0 disables. */
  WKB2API_RATE_LIMIT_RPM: z.coerce.number().int().min(0).default(0),
  /** Per-key token quota per rolling day. 0 disables. */
  WKB2API_TOKEN_QUOTA_PER_DAY: z.coerce.number().int().min(0).default(0),
  /** Allow generating an ephemeral account-store key when the key file is absent. */
  WKB2API_ALLOW_EPHEMERAL_STORE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Persistence backend.
   *
   * `file` keeps the encrypted account blob and the JSONL telemetry on local
   * disk. `postgres` moves both into a database, which is required on hosts
   * that recycle the filesystem between deploys (Render and similar) — there,
   * the file backend loses the account pool on every restart.
   */
  WKB2API_STORAGE_BACKEND: z.enum(['file', 'postgres']).default('file'),
  /** Postgres connection string. Required when the backend is `postgres`. */
  WKB2API_DATABASE_URL: z.string().optional(),
  /** Force TLS on the database connection. Defaults to on for non-local hosts. */
  WKB2API_DATABASE_SSL: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /** Max database connections shared by account state and telemetry. */
  WKB2API_DATABASE_POOL_SIZE: z.coerce.number().int().positive().max(50).default(5),
  /** File-backend path for the API-key registry (hashes only). */
  WKB2API_API_KEYS_PATH: z.string().default('data/api-keys.json'),
  /**
   * Account-store encryption key as a base64 string, for hosts with no
   * persistent disk to mount a key file from.
   *
   * Takes precedence over WKB2API_ACCOUNT_STORE_KEY_FILE. Combined with
   * WKB2API_STORAGE_BACKEND=postgres this is the deployment shape for Render:
   * key from configuration, encrypted state in a database, no mounted secret.
   */
  WKB2API_ACCOUNT_STORE_KEY_B64: z.string().optional(),
  /**
   * Bootstrap key, appended to the hashed registry instead of being the only
   * credential. Native support: the registry file/table is generated next to
   * the encrypted account store, so a fresh deployment has an admin key by
   * default without editing env vars.
   *
   * Stored as a SHA-256 hash like every other key. The default is a fixed,
   * well-known value so a first boot is never locked out; it is printed
   * verbatim at startup and flagged as needing rotation.
   */
  WKB2API_BOOTSTRAP_ADMIN_KEY: z.string().min(16).default('wkb_admin_default_change_me'),
  /** Public origin used for Origin checks; empty accepts any same-origin request. */
  WKB2API_PUBLIC_ORIGIN: z.string().default(''),
  WKB2API_MODEL_ALIASES: z.string().default('{}').transform((raw, ctx) => {
    try {
      const aliases = z.record(z.string().min(1)).parse(JSON.parse(raw));
      return aliases;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be a JSON object mapping aliases to gateway model IDs' });
      return z.NEVER;
    }
  }),
});

export type AppConfig = {
  host: string;
  port: number;
  apiKey: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug';
  upstreamUrl: string;
  upstreamUa: string;
  firstByteTimeoutMs: number;
  idleTimeoutMs: number;
  accountStorePath: string;
  accountStoreKeyFile?: string;
  credentialsPath: string;
  modelAliases: Record<string, string>;
  toolTracePath: string;
  telemetryPath: string;
  telemetryMaxBytes: number;
  rateLimitRpm: number;
  tokenQuotaPerDay: number;
  allowEphemeralStore: boolean;
  publicOrigin: string;
  storageBackend: 'file' | 'postgres';
  databaseUrl?: string;
  databaseSsl?: boolean;
  databasePoolSize: number;
  apiKeysPath: string;
  bootstrapAdminKey: string;
  accountStoreKeyB64?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return {
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    apiKey: parsed.data.WKB2API_API_KEY,
    logLevel: parsed.data.LOG_LEVEL,
    upstreamUrl: parsed.data.WKB2API_UPSTREAM_URL,
    upstreamUa: parsed.data.WKB2API_UPSTREAM_UA,
    firstByteTimeoutMs: parsed.data.WKB2API_FIRST_BYTE_TIMEOUT_MS,
    idleTimeoutMs: parsed.data.WKB2API_IDLE_TIMEOUT_MS,
    accountStorePath: parsed.data.WKB2API_ACCOUNT_STORE_PATH,
    ...(parsed.data.WKB2API_ACCOUNT_STORE_KEY_FILE
      ? { accountStoreKeyFile: parsed.data.WKB2API_ACCOUNT_STORE_KEY_FILE }
      : {}),
    credentialsPath: parsed.data.WKB2API_CREDENTIALS_PATH ?? 'workbuddy-desktop-ai.info',
    modelAliases: parsed.data.WKB2API_MODEL_ALIASES,
    toolTracePath: parsed.data.WKB2API_TOOL_TRACE_PATH,
    telemetryPath: parsed.data.WKB2API_TELEMETRY_PATH,
    telemetryMaxBytes: parsed.data.WKB2API_TELEMETRY_MAX_BYTES,
    rateLimitRpm: parsed.data.WKB2API_RATE_LIMIT_RPM,
    tokenQuotaPerDay: parsed.data.WKB2API_TOKEN_QUOTA_PER_DAY,
    allowEphemeralStore: parsed.data.WKB2API_ALLOW_EPHEMERAL_STORE,
    publicOrigin: parsed.data.WKB2API_PUBLIC_ORIGIN,
    storageBackend: parsed.data.WKB2API_STORAGE_BACKEND,
    ...(parsed.data.WKB2API_DATABASE_URL ? { databaseUrl: parsed.data.WKB2API_DATABASE_URL } : {}),
    ...(parsed.data.WKB2API_DATABASE_SSL !== undefined ? { databaseSsl: parsed.data.WKB2API_DATABASE_SSL } : {}),
    databasePoolSize: parsed.data.WKB2API_DATABASE_POOL_SIZE,
    apiKeysPath: parsed.data.WKB2API_API_KEYS_PATH,
    bootstrapAdminKey: parsed.data.WKB2API_BOOTSTRAP_ADMIN_KEY,
    ...(parsed.data.WKB2API_ACCOUNT_STORE_KEY_B64
      ? { accountStoreKeyB64: parsed.data.WKB2API_ACCOUNT_STORE_KEY_B64 }
      : {}),
  };
}
