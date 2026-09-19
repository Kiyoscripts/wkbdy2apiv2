import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isApiKeyValid } from '../security/downstream-auth.js';
import { openAiError } from '../openai/errors.js';
import type { ExposedModel } from '../workbuddy/model-catalog.js';
import type { MetricsCollector } from '../observability/metrics.js';
import type { CredentialProvider } from '../workbuddy/auth.js';
import { UpstreamHttpError } from '../workbuddy/client.js';
import { stripBearer } from '../workbuddy/auth.js';
import type { CredentialPool } from '../workbuddy/credential-pool.js';
import { LocalImportError, readLocalWorkBuddyAccounts } from '../workbuddy/local-account-import.js';
import { createTelemetrySink, type TelemetrySink } from '../observability/telemetry.js';
import type { TelemetryStore, UsageReporter } from '../storage/types.js';
import type { ApiKeyRegistry } from '../security/api-keys.js';
import { adminPanelHtml } from './admin-html.js';
import type { OAuthBroker } from '../workbuddy/oauth-broker.js';
import { oauthRoutes } from './oauth.js';

interface AdminOpts {
  apiKey: string;
  models: ExposedModel[];
  metrics: MetricsCollector;
  /** Multi-account pool managed by the panel. */
  pool: CredentialPool;
  oauth: OAuthBroker;
  /** Local WorkBuddy credential file used by the account import endpoint. */
  credentialsPath: string;
  upstreamUrl: string;
  upstreamUa: string;
  startedAt: number;
  version: string;
  /** Verifies a candidate credential against the upstream before adding. */
  verifyCredential: (cred: { accessToken: string; userId: string }) => Promise<void>;
  /** Post-restart operator notice, surfaced in the panel header. */
  startupNotice?: string;
  /** Durable telemetry JSONL path, exposed read-only at /admin/api/telemetry. */
  telemetryPath?: string;
  /**
   * Durable telemetry backend.
   *
   * Takes precedence over `telemetryPath`: when the gateway persists telemetry
   * in a database, reading a JSONL file would show an empty history and look
   * like telemetry was broken.
   */
  telemetry?: TelemetryStore;
  /** Rolling-window usage queries (database backend only). */
  usageReporter?: UsageReporter;
  /** Active storage backend, reported on /ready and in the panel. */
  storage?: { backend: string; describe: string; persistentAccounts: boolean; persistentTelemetry: boolean };
  /** API-key registry backing the /admin/api/keys endpoints. */
  apiKeys: ApiKeyRegistry;
  /** Persist the registry after a mutation. Omitted in tests. */
  persistKeys?: () => Promise<void>;
}

/**
 * Admin panel routes. Same bearer auth as the API (the panel stores the key
 * in localStorage after one entry) — no separate auth system to drift.
 *
 *   GET  /admin                    → single-page panel
 *   GET  /admin/api/overview        → stats + catalog + credential/pool status
 *   GET  /admin/api/requests        → recent request log
 *   POST /admin/api/accounts        → verify & add an account to the pool
 *   POST /admin/api/accounts/remove → remove an account by label
 *   GET  /admin/api/strategy        → current scheduling strategy
 *   POST /admin/api/strategy        → set strategy: round-robin | random
 */
export function adminRoutes(app: FastifyInstance, opts: AdminOpts): void {
  // Panel HTML itself is served without the key so the browser can load the
  // page; every data call behind /admin/api requires it.
  app.get('/admin', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('cache-control', 'no-store');
    return adminPanelHtml();
  });

  /**
   * Panel auth.
   *
   * Any registered key may read the panel, but only keys flagged `admin` may
   * change it. That split matters because the /v1 keys handed to clients are
   * the same kind of credential: without it, distributing a key for API access
   * would also hand out the ability to add accounts and issue more keys.
   *
   * The bootstrap env key is always admin, so there is no way to lock yourself
   * out of the panel that manages keys.
   */
  function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
    const header = req.headers.authorization;
    const provided = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const verified = opts.apiKeys.verify(provided);
    if (!verified.ok) {
      void reply.code(401).send(openAiError(401, 'invalid_api_key', 'Invalid or missing API key.').body);
      return false;
    }
    if (!verified.admin) {
      void reply
        .code(403)
        .send(openAiError(403, 'permission_denied', 'This key is not authorized to manage the gateway.').body);
      return false;
    }
    return true;
  }

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith('/admin/api/')) return;
    requireAdmin(req, reply);
  });

  void app.register(oauthRoutes, { prefix: '/admin/api/oauth', broker: opts.oauth });

  app.get('/admin/api/overview', async () => {
    const stats = opts.metrics.snapshot();
    // Credential probe: never surface values — only presence and expiry shape.
    let credential: { source: string; ok: boolean; detail: string };
    try {
      const cred = await opts.pool.getCredential();
      credential = {
        source: opts.pool.describe(),
        ok: true,
        detail: describeToken(cred.accessToken),
      };
    } catch (err) {
      const msg = err instanceof Error ? (err.message.split('\n')[0] ?? 'unknown error') : 'unknown error';
      credential = {
        source: opts.pool.describe(),
        ok: false,
        detail: msg.slice(0, 200),
      };
    }
    return {
      version: opts.version,
      started_at: opts.startedAt,
      stats,
      models: opts.models,
      credential,
      pool: {
        size: opts.pool.size,
        strategy: opts.pool.strategyName,
        accounts: opts.pool.list(),
        // Per-account availability, including cooldown state and last error.
        // Before this the panel showed only "ok / not ok", so a pool that was
        // degraded (some accounts cooling down) looked identical to a healthy
        // one until enough accounts had failed to exhaust it entirely.
        health: opts.pool.health(),
      },
      ...(opts.startupNotice ? { notice: opts.startupNotice } : {}),
      upstream: { url: opts.upstreamUrl, user_agent: opts.upstreamUa },
    };
  });

  app.get('/admin/api/requests', async () => {
    return { recent: opts.metrics.snapshot().recent };
  });

  /**
   * Read back the durable request history.
   *
   * The in-memory window is 200 entries and resets on restart, which is exactly
   * when an operator needs the evidence most. This endpoint serves whichever
   * backend is active — database rows or JSONL lines — newest last.
   */
  app.get('/admin/api/telemetry', async (req, reply) => {
    const query = req.query as { limit?: string; kind?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 200) || 200, 1), 5000);
    const source: TelemetryStore | TelemetrySink | undefined =
      opts.telemetry ?? (opts.telemetryPath ? createTelemetrySink({ path: opts.telemetryPath }) : undefined);
    if (!source || !source.enabled) {
      return reply.code(503).send(openAiError(503, 'internal_error', 'Request telemetry persistence is disabled.').body);
    }
    const events = await source.read(limit);
    const filtered = query.kind === 'request' || query.kind === 'pool'
      ? events.filter((event) => event.kind === query.kind)
      : events;
    // The JSONL sink has no `kind` field; report it as the file backend so the
    // panel can label the source either way.
    const backend = 'kind' in source ? source.kind : 'file';
    return { backend, path: opts.telemetryPath, count: filtered.length, events: filtered };
  });

  /**
   * Usage over a rolling window, computed in the database.
   *
   * The in-memory counters reset on restart, so "how many tokens did key X use
   * this week" had no survivable answer before. On the file backend there is
   * still no answer, and the endpoint says so rather than reporting zeros.
   */
  app.get('/admin/api/usage', async (req, reply) => {
    const query = req.query as { window?: string };
    const reporter = opts.usageReporter;
    if (!reporter || !reporter.available) {
      return reply.code(503).send(
        openAiError(
          503,
          'internal_error',
          'Usage aggregation requires the postgres storage backend (WKB2API_STORAGE_BACKEND=postgres).',
        ).body,
      );
    }
    const hours = Math.min(Math.max(Number(query.window ?? 24) || 24, 1), 24 * 30);
    const aggregate = await reporter.window(hours * 3_600_000);
    return aggregate ?? { since: new Date(Date.now() - hours * 3_600_000).toISOString(), requests: 0 };
  });

  const accountSchema = z.object({
    token: z.string().min(20, 'token too short to be real'),
    user_id: z.string().min(1).optional(),
    note: z.string().max(64).optional(),
    domain: z.string().optional(),
  });

  // Add an account: verify against the upstream first, then pool it.
  app.post('/admin/api/accounts', async (req, reply) => {
    const parsed = accountSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const err = openAiError(400, 'invalid_request', first ? `${first.path.join('.')}: ${first.message}` : 'Invalid account body.');
      return reply.code(err.statusCode).send(err.body);
    }
    const { token, user_id, note } = parsed.data;
    const domain = parsed.data.domain ?? 'www.workbuddy.ai';
    // user_id is optional: derive it from the JWT `sub` claim when absent
    // (verified: account.uid === JWT sub). This makes adding an account a
    // single paste. The value is surface-proofed below — never echoed back.
    let effectiveUserId = user_id;
    if (!effectiveUserId) {
      try {
        effectiveUserId = jwtSub(stripBearer(token));
      } catch {
        /* not a parseable JWT — let credential verification report it */
      }
    }
    if (!effectiveUserId) {
      const e = openAiError(400, 'invalid_request', 'user_id is required (token is not a JWT with a sub claim).');
      return reply.code(e.statusCode).send(e.body);
    }
    try {
      await opts.verifyCredential({ accessToken: stripBearer(token), userId: effectiveUserId });
    } catch (err) {
      const detail =
        err instanceof UpstreamHttpError
          ? `upstream rejected the token (HTTP ${err.status}${err.upstreamMessage ? `: ${err.upstreamMessage.slice(0, 120)}` : ''})`
          : 'could not reach the upstream to verify this token';
      const e = openAiError(401, 'upstream_authentication_error', detail);
      return reply.code(e.statusCode).send(e.body);
    }
    const account = await opts.pool.add({ accessToken: token, userId: effectiveUserId, domain }, note);
    return reply.code(200).send({ ok: true, label: account.label, pool_size: opts.pool.size });
  });

  app.post('/admin/api/accounts/import-local', async (_req, reply) => {
    try {
      const result = await readLocalWorkBuddyAccounts(opts.credentialsPath);
      const before = opts.pool.size;
      for (const { credential, note } of result.credentials) {
        await opts.pool.add(credential, note);
      }
      return reply.code(200).send({
        ok: true,
        imported: opts.pool.size - before,
        accepted: result.credentials.length,
        issues: result.issues,
        pool_size: opts.pool.size,
      });
    } catch (err) {
      if (err instanceof LocalImportError) {
        const status = err.code === 'file_not_found' ? 404 : 400;
        const error = openAiError(status, 'invalid_request', err.message);
        return reply.code(error.statusCode).send(error.body);
      }
      const error = openAiError(500, 'internal_error', 'Could not import local WorkBuddy accounts.');
      return reply.code(error.statusCode).send(error.body);
    }
  });

  app.post('/admin/api/accounts/remove', async (req, reply) => {
    const parsed = z.object({ label: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      const err = openAiError(400, 'invalid_request', 'label is required.');
      return reply.code(err.statusCode).send(err.body);
    }
    const removed = await opts.pool.remove(parsed.data.label);
    return reply.code(removed ? 200 : 404).send({ ok: removed, pool_size: opts.pool.size });
  });

  /**
   * API-key management.
   *
   *   GET    /admin/api/keys        → list (hashes and prefixes only)
   *   POST   /admin/api/keys        → create; the plaintext is returned ONCE
   *   DELETE /admin/api/keys/:id    → revoke, effective on the next request
   *   PATCH  /admin/api/keys/:id    → rename / grant or revoke admin
   *
   * Only hashes are stored, so a lost key cannot be recovered — it has to be
   * revoked and reissued. The list response says so explicitly rather than
   * leaving an operator to wonder why no "reveal" button exists.
   */
  app.get('/admin/api/keys', async () => ({
    keys: opts.apiKeys.list().map((record) => ({ ...record, hash: undefined, hashed: true })),
    count: opts.apiKeys.size(),
    bootstrap_key: {
      id: 'env',
      name: 'bootstrap key (WKB2API_API_KEY)',
      admin: true,
      revocable: false,
      note: 'Always valid and always admin. Cannot be deleted through the panel.',
    },
  }));

  const createKeySchema = z.object({
    name: z.string().min(1).max(64),
    admin: z.boolean().optional(),
    note: z.string().max(200).optional(),
  });

  app.post('/admin/api/keys', async (req, reply) => {
    const parsed = createKeySchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const err = openAiError(
        400,
        'invalid_request',
        first ? `${first.path.join('.')}: ${first.message}` : 'Invalid key definition.',
      );
      return reply.code(err.statusCode).send(err.body);
    }
    const issued = opts.apiKeys.create(parsed.data);
    await opts.persistKeys?.();
    // The only moment the plaintext exists outside the client's config. Return
    // it once and never again.
    return reply.code(201).send({
      ok: true,
      id: issued.record.id,
      name: issued.record.name,
      key: issued.key,
      prefix: issued.record.prefix,
      admin: issued.record.admin,
      warning: 'Store this now. It is not recoverable — the gateway keeps only a hash.',
    });
  });

  app.delete('/admin/api/keys/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = opts.apiKeys.get(id);
    if (!record) {
      const err = openAiError(404, 'not_found', 'No such API key.');
      return reply.code(err.statusCode).send(err.body);
    }
    opts.apiKeys.remove(id);
    await opts.persistKeys?.();
    return reply.code(200).send({ ok: true, id, revoked: true, name: record.name });
  });

  const patchKeySchema = z.object({
    name: z.string().min(1).max(64).optional(),
    admin: z.boolean().optional(),
    note: z.string().max(200).optional(),
  });

  app.patch('/admin/api/keys/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = patchKeySchema.safeParse(req.body);
    if (!parsed.success) {
      const err = openAiError(400, 'invalid_request', 'Invalid key update.');
      return reply.code(err.statusCode).send(err.body);
    }
    const updated = opts.apiKeys.update(id, parsed.data);
    if (!updated) {
      const err = openAiError(404, 'not_found', 'No such API key.');
      return reply.code(err.statusCode).send(err.body);
    }
    await opts.persistKeys?.();
    return reply.code(200).send({ ok: true, key: { ...updated, hash: undefined, hashed: true } });
  });

  const strategySchema = z.object({ strategy: z.enum(['round-robin', 'random']) });
  app.get('/admin/api/strategy', async () => ({ strategy: opts.pool.strategyName, pool_size: opts.pool.size }));
  app.post('/admin/api/strategy', async (req, reply) => {
    const parsed = strategySchema.safeParse(req.body);
    if (!parsed.success) {
      const err = openAiError(400, 'invalid_request', "strategy must be 'round-robin' or 'random'.");
      return reply.code(err.statusCode).send(err.body);
    }
    await opts.pool.setStrategy(parsed.data.strategy);
    return reply.code(200).send({ ok: true, strategy: opts.pool.strategyName });
  });
}

/** Extract the `sub` claim from a JWT token — the userId used for X-User-Id. */
function jwtSub(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || !token.startsWith('eyJ')) return undefined;
  const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'));
  return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : undefined;
}

/** Safe token description: scheme + shape + expiry only. No value material. */
function describeToken(token: string): string {
  const parts = token.split('.');
  if (parts.length === 3 && token.startsWith('eyJ')) {
    let exp: string | null = null;
    try {
      const payloadPart = parts[1] ?? '';
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
      if (typeof payload.exp === 'number') {
        const d = new Date(payload.exp * 1000);
        const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
        exp = days > 0 ? `valid ~${days} more days` : `expired ${-days} days ago`;
      }
    } catch {
      /* opaque JWT payload — fine */
    }
    return `JWT (RS256), ${token.length} chars${exp ? `, ${exp}` : ''}`;
  }
  return `opaque token, ${token.length} chars`;
}
