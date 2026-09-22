import Fastify, { type FastifyInstance } from 'fastify';
import { extractApiKey, isApiKeyValid, keyFingerprint, maskedKeyPrefix } from './security/downstream-auth.js';
import type { ApiKeyRegistry } from './security/api-keys.js';
import { createRateLimiter, type RateLimitConfig } from './security/rate-limit.js';
import { applyRateLimit } from './routes/request-context.js';
import { openAiError, type ApiErrorCode } from './openai/errors.js';
import { modelsRoutes } from './routes/models.js';
import { chatCompletionsRoutes } from './routes/chat-completions.js';
import { messagesRoutes } from './routes/messages.js';
import { responsesRoutes } from './routes/responses.js';
import { anthropicError } from './anthropic/errors.js';
import { adminRoutes } from './routes/admin.js';
import type { ExposedModel } from './workbuddy/model-catalog.js';
import type { WorkBuddyClient } from './workbuddy/client.js';
import type { CredentialPool } from './workbuddy/credential-pool.js';
import type { MetricsCollector } from './observability/metrics.js';
import { OAuthBroker, type OAuthBrokerOptions } from './workbuddy/oauth-broker.js';
import { createToolCallTracer } from './observability/tool-trace.js';
import type { TelemetryStore, UsageReporter } from './storage/types.js';

export type BuildAppOptions = {
  apiKey: string;
  /**
   * Downstream API-key registry.
   *
   * Replaces the previous single-key comparison. The env key
   * (`WKB2API_API_KEY`) is held inside the registry as an always-valid admin
   * credential, so it still works and can never be revoked through the panel.
   */
  apiKeys: ApiKeyRegistry;
  /** Called after a key authenticates, so the registry can be persisted. */
  onKeyUsed?: (keyId: string) => void;
  /** Persist the API-key registry after a panel mutation. */
  persistKeys?: () => Promise<void>;
  models: ExposedModel[];
  client: WorkBuddyClient;
  pool: CredentialPool;
  credentialsPath?: string;
  metrics: MetricsCollector;
  upstreamUrl: string;
  upstreamUa: string;
  startedAt: number;
  version: string;
  modelAliases?: Record<string, string>;
  toolTracePath?: string;
  /** Per-key rate limits and quotas. Omit to disable limiting. */
  rateLimits?: RateLimitConfig;
  /** Charges per-key token quotas after each completed response. */
  onUsage?: (usage: {
    keyId?: string;
    account?: string;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  }) => void;
  /** Post-restart notice for operators, surfaced on /ready and in startup logs. */
  startupNotice?: string;
  /** Durable telemetry JSONL path, exposed read-only to the admin panel. */
  telemetryPath?: string;
  /**
   * Durable telemetry backend, exposed to the admin panel.
   *
   * Preferred over `telemetryPath`: when the gateway stores telemetry in a
   * database the panel must read from that database, not from a JSONL file
   * that no longer holds the history. `telemetryPath` is kept for the file
   * backend and for tests that construct just a path.
   */
  telemetry?: TelemetryStore;
  /** Rolling-window usage queries. Only the database backend can answer them. */
  usageReporter?: UsageReporter;
  /** Storage description surfaced on /ready so the active backend is visible. */
  storage?: { backend: string; describe: string; persistentAccounts: boolean; persistentTelemetry: boolean };
  /** Override the reporting sink for accepted-but-dropped request fields. */
  onDroppedFields?: (fields: string[], requestId: string) => void;
  oauthOptions?: Omit<OAuthBrokerOptions, 'onComplete' | 'userAgent'>;
};

export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 8 * 1024 * 1024,
  });

  const rateLimiter = createRateLimiter(opts.rateLimits ?? {});

  /**
   * Charge token usage against the per-key quota.
   *
   * The limiter is created here, so it must be charged here too. Previously the
   * token accounting was left entirely to the caller's `onUsage`, which meant
   * the limiter that enforces the quota never learned about any usage and a
   * `tokensPerDay` limit could never trigger. The caller's callback still runs,
   * so external accounting keeps working.
   */
  const chargeUsage: BuildAppOptions['onUsage'] = (usage) => {
    if (usage.keyId && usage.usage?.total_tokens) {
      rateLimiter.recordTokens(usage.keyId, usage.usage.total_tokens);
    }
    opts.onUsage?.(usage);
  };

  // Downstream auth guard for every /v1 route.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/v1/')) return;
    const path = req.url.split('?')[0]!;
    const isMessages = path === '/v1/messages' || path.startsWith('/v1/messages/');
    // OpenAI-compatible harnesses are inconsistent across normal and tool
    // continuation turns. Accept Bearer, x-api-key, and api-key everywhere.
    const auth = extractApiKey(req.headers);
    const verified = auth.conflicting ? { ok: false as const } : opts.apiKeys.verify(auth.value);
    if (!verified.ok) {
      const reason = auth.conflicting ? 'conflicting_headers' : auth.value ? 'invalid_value' : 'missing';
      // Header names and request ID are safe; never log the secret values. A
      // masked fragment of the rejected key is recorded because a rejected key
      // is by definition absent from the registry, so it has no name to report;
      // maskedKeyPrefix guarantees the fragment can never be the whole key.
      const rejectedPrefix = maskedKeyPrefix(auth.value);
      console.warn(JSON.stringify({
        time: new Date().toISOString(),
        msg: 'downstream API key rejected',
        request_id: req.id,
        path,
        reason,
        ...(rejectedPrefix ? { presented_key_prefix: rejectedPrefix } : {}),
        credential_headers: auth.sources,
      }));
      // Rejections are recorded so the panel can show them. Without this the
      // one failure an operator most needs to see — a client whose key stopped
      // working — is the only one that never appears in the request log, the
      // error rate, or the error-code histogram, and the panel reports a
      // healthy gateway while every call from that client fails.
      opts.metrics.record({
        request_id: String(req.id),
        method: req.method,
        path,
        status: 401,
        stream: false,
        duration_ms: 0,
        error_code: 'invalid_api_key',
        error_class: 'auth_error',
        ...(auth.value ? { key_id: keyFingerprint(auth.value) } : {}),
        ...(rejectedPrefix ? { key_prefix: rejectedPrefix } : {}),
        attempts: 1,
        retries: 0,
      });
      reply.header('x-request-id', req.id);
      if (isMessages) return reply.code(401).send(anthropicError(401, 'Invalid or missing gateway API key.', req.id));
      const error = openAiError(401, 'invalid_api_key', 'Invalid or missing API key.');
      return reply.code(401).send({ ...error.body, request_id: req.id });
    }

    // Count the use so the panel can show which keys are actually live. The
    // registry decides when to persist; in-memory counters are enough on the
    // hot path.
    opts.apiKeys.touch(verified.id);
    opts.onKeyUsed?.(verified.id);

    // Authenticated: enforce the per-key limiter before any upstream work.
    const limit = applyRateLimit(rateLimiter, keyFingerprint(auth.value), isMessages, req.id);
    if (limit) {
      opts.metrics.record({
        request_id: String(req.id),
        method: req.method,
        path,
        status: 429,
        stream: false,
        duration_ms: 0,
        error_code: limit.code,
        error_class: 'rate_limit',
        key_id: keyFingerprint(auth.value),
        attempts: 1,
        retries: 0,
      });
      reply.header('x-request-id', req.id);
      reply.header('retry-after', String(limit.retryAfterSeconds));
      return reply.code(limit.statusCode).send(limit.body);
    }
  });

  // Never leak stacks or upstream internals to callers.
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode !== undefined && err.statusCode >= 400 ? err.statusCode : 500;
    const path = req.url.split('?')[0]!;
    if (path === '/v1/messages' || path.startsWith('/v1/messages/')) {
      return reply.code(status).send(anthropicError(status, 'Request could not be processed.', req.id));
    }
    const code: ApiErrorCode =
      status === 404 ? 'not_found' : status < 500 ? 'invalid_request' : 'internal_error';
    const message =
      status === 404
        ? `Unknown route: ${req.method} ${req.url}`
        : 'Request could not be processed.';
    reply.code(status).send(openAiError(status, code, message).body);
  });

  /**
   * Liveness: the process is up and serving HTTP. Deliberately does not touch
   * the credential pool — an empty or cooling-down pool is not a reason to
   * restart the process, and conflating the two caused a `/health` that
   * returned 200 while every request failed.
   */
  app.get('/health', async () => ({ status: 'ok' }));

  /**
   * Readiness: can this instance actually serve a request right now?
   *
   *   ready      — at least one account is usable
   *   degraded   — usable, but some accounts are cooling down or need re-login
   *   unavailable— pool exists but no account can serve
   *   empty      — no accounts configured at all
   *
   * Returns 503 unless ready/degraded, so a load balancer or uptime monitor
   * can tell the difference between "process alive" and "gateway usable".
   */
  app.get('/ready', async (_req, reply) => {
    const health = opts.pool.health();
    const body = {
      status: health.ready ? 'ready' : 'unavailable',
      pool: {
        state: health.state,
        size: health.size,
        available: health.available,
        unhealthy: health.unhealthy,
        strategy: health.strategy,
      },
      upstream: { url: opts.upstreamUrl },
      version: opts.version,
      ...(opts.startupNotice ? { notice: opts.startupNotice } : {}),
    };
    reply.code(health.ready ? 200 : 503);
    return body;
  });

  void app.register(modelsRoutes, { prefix: '/v1', models: opts.models });
  void app.register(chatCompletionsRoutes, {
    prefix: '/v1',
    models: opts.models,
    client: opts.client,
    metrics: opts.metrics,
    pool: opts.pool,
    onUsage: chargeUsage,
    tracer: createToolCallTracer(opts.toolTracePath ?? ''),
    onDroppedFields:
      opts.onDroppedFields ??
      ((fields, requestId) => {
        opts.metrics.recordDroppedFields(fields);
        console.info(
          JSON.stringify({
            time: new Date().toISOString(),
            msg: 'accepted and ignored unsupported request fields',
            request_id: requestId,
            dropped_fields: fields,
          }),
        );
      }),
  });
  void app.register(messagesRoutes, { prefix: '/v1', models: opts.models, client: opts.client, metrics: opts.metrics, modelAliases: opts.modelAliases, pool: opts.pool, onUsage: chargeUsage });
  void app.register(responsesRoutes, { prefix: '/v1', models: opts.models, client: opts.client, metrics: opts.metrics, pool: opts.pool, onUsage: chargeUsage });

  const oauth = new OAuthBroker({
    ...opts.oauthOptions,
    userAgent: opts.upstreamUa,
    onComplete: async (credential, note) => (await opts.pool.add(credential, note)).label,
  });
  opts.pool.setRefresher((credential) => oauth.refreshCredential(credential));
  app.addHook('onClose', async () => oauth.close());

  void app.register(adminRoutes, {
    apiKey: opts.apiKey,
    models: opts.models,
    metrics: opts.metrics,
    pool: opts.pool,
    oauth,
    credentialsPath: opts.credentialsPath ?? 'workbuddy-desktop-ai.info',
    upstreamUrl: opts.upstreamUrl,
    upstreamUa: opts.upstreamUa,
    startedAt: opts.startedAt,
    version: opts.version,
    ...(opts.startupNotice !== undefined ? { startupNotice: opts.startupNotice } : {}),
    ...(opts.telemetryPath !== undefined ? { telemetryPath: opts.telemetryPath } : {}),
    ...(opts.telemetry !== undefined ? { telemetry: opts.telemetry } : {}),
    ...(opts.usageReporter !== undefined ? { usageReporter: opts.usageReporter } : {}),
    ...(opts.storage !== undefined ? { storage: opts.storage } : {}),
    apiKeys: opts.apiKeys,
    ...(opts.persistKeys !== undefined ? { persistKeys: opts.persistKeys } : {}),
    verifyCredential: (cred) => opts.client.verifyCredential(cred),
  });

  return app;
}
