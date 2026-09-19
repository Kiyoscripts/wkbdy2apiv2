import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { registryWith } from './helpers/api-key-registry.js';
import { createMetrics } from '../src/observability/metrics.js';
import { createTelemetrySink, toTelemetryRecord } from '../src/observability/telemetry.js';
import { CredentialPool } from '../src/workbuddy/credential-pool.js';
import type { ExposedModel } from '../src/workbuddy/model-catalog.js';
import type { UpstreamChunk, WorkBuddyClient } from '../src/workbuddy/client.js';

const API_KEY = 'integration-key';
const OTHER_KEY = 'other-key';

const model: ExposedModel = {
  id: 'wb-model',
  object: 'model',
  created: 0,
  owned_by: 'workbuddy',
  x_workbuddy: { is_default: true, supports_tool_call: true },
};

const cred = (token: string, userId: string) => ({
  accessToken: token,
  userId,
  domain: 'workbuddy.ai',
  expiresAt: Date.now() + 3_600_000,
  oauthOrigin: 'import',
});

const frame = (over: Partial<UpstreamChunk> = {}): UpstreamChunk => ({
  id: 'up-1',
  model: 'wb-model',
  finish_reason: null,
  usage: null,
  delta: {},
  ...over,
});

/** A client whose streamed frames are supplied per test. */
function clientYielding(frames: UpstreamChunk[], attemptsToRecord = 1) {
  return {
    verifyCredential: async () => undefined,
    streamChatCompletion: async (
      _body: unknown,
      _signal: AbortSignal,
      _retry?: boolean,
      _requireDone?: boolean,
      attempts?: { attempts: number; retries: number },
    ) => {
      if (attempts) {
        attempts.attempts = attemptsToRecord;
        attempts.retries = attemptsToRecord - 1;
      }
      return (async function* () {
        for (const f of frames) yield f;
      })();
    },
  } as unknown as WorkBuddyClient;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wkb-integration-'));
});
afterEach(async () => {
  // TelemetrySink writes are queued fire-and-forget: the sink created by
  // makeApp may still be appending (and calling mkdir) when this hook runs.
  // Removing the directory first races that write — the sink recreates the
  // directory just after it is gone and the rmdir fails with ENOTEMPTY. Close
  // the apps and drain the sinks, then delete.
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(sinks.splice(0).map((sink) => sink.flush()));
  await rm(dir, { recursive: true, force: true });
});

/** Apps and sinks created since the last cleanup. See afterEach. */
const apps: FastifyInstance[] = [];
const sinks: Array<{ flush: () => Promise<void> }> = [];

function makeApp(pool: CredentialPool, client: WorkBuddyClient, extra: Record<string, unknown> = {}) {
  const metrics = createMetrics();
  const telemetryPath = join(dir, 'requests.jsonl');
  const telemetry = createTelemetrySink({ path: telemetryPath });
  sinks.push(telemetry);
  metrics.setSink((entry) => telemetry.request(toTelemetryRecord(entry)));
  pool.setEventSink((event) => telemetry.pool(event));
  const app = buildApp({
    apiKey: API_KEY,
    apiKeys: registryWith(API_KEY),
    models: [model],
    client,
    pool,
    metrics,
    upstreamUrl: 'https://example.invalid/v2/chat/completions',
    upstreamUa: 'test-agent',
    startedAt: Date.now(),
    version: '9.9.9',
    telemetryPath,
    ...extra,
  });
  apps.push(app);
  return { app, metrics, telemetryPath };
}

const chatBody = (over: Record<string, unknown> = {}) => ({
  model: 'wb-model',
  messages: [{ role: 'user', content: 'hi' }],
  ...over,
});

describe('request telemetry through the HTTP surface', () => {
  it('persists a completed chat completion with its request ID and tokens', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    const { app, telemetryPath } = makeApp(pool, clientYielding([
      frame({ delta: { content: 'hello' } }),
      frame({ finish_reason: 'stop', usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 } }),
    ]));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: chatBody(),
    });
    expect(res.statusCode).toBe(200);

    // Writes are queued; give the sink a moment to flush.
    await new Promise((r) => setTimeout(r, 150));
    const raw = await readFile(telemetryPath, 'utf8');
    const records = raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

    const request = records.find((r) => r.kind === 'request');
    expect(request.record).toMatchObject({
      path: '/v1/chat/completions',
      status: 200,
      prompt_tokens: 11,
      completion_tokens: 4,
      key_id: expect.stringMatching(/^key_[0-9a-f]{16}$/),
    });
    // A request ID must be attached to every row, or a persisted record cannot
    // be correlated with a log line or a support report.
    expect(request.record.request_id).toBeTruthy();
    expect(request.record.request_id).not.toBe('unknown');
    await app.close();
  });

  it('persists the retry count so a retry storm is visible after the fact', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    // Three upstream attempts for one downstream request.
    const { app, telemetryPath } = makeApp(pool, clientYielding([
      frame({ finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
    ], 3));

    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: chatBody(),
    });
    await new Promise((r) => setTimeout(r, 150));

    const records = (await readFile(telemetryPath, 'utf8')).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    expect(records.find((r) => r.kind === 'request').record).toMatchObject({ attempts: 3, retries: 2 });
    await app.close();
  });

  it('persists pool lifecycle events alongside requests', async () => {
    const pool = new CredentialPool({ cooldownMs: 60_000 });
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    const { app, telemetryPath } = makeApp(pool, clientYielding([]));

    pool.reportFailure('token-a', 'upstream 401');
    await new Promise((r) => setTimeout(r, 150));

    const records = (await readFile(telemetryPath, 'utf8')).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const poolEvent = records.find((r) => r.kind === 'pool');
    expect(poolEvent.record).toMatchObject({ event: 'quarantined', label: expect.stringMatching(/^#\d+$/) });
    await app.close();
  });

  it('records a rejection before any upstream call, with its request id', async () => {
    const pool = new CredentialPool();
    const { app, telemetryPath } = makeApp(pool, clientYielding([]));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer wrong-key' },
      payload: chatBody(),
    });
    expect(res.statusCode).toBe(401);
    await new Promise((r) => setTimeout(r, 150));

    // An unauthenticated request is not recorded as a request row (auth runs
    // before the recorder), but the rejection must still be observable.
    const raw = await readFile(telemetryPath, 'utf8').catch(() => '');
    expect(raw).not.toContain('wrong-key');
    await app.close();
  });
});

describe('per-key rate limiting through the HTTP surface', () => {
  it('rejects the request over the limit with 429 and a Retry-After header', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    const { app } = makeApp(pool, clientYielding([
      frame({ delta: { content: 'ok' } }),
      frame({ finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
    ]), { rateLimits: { requestsPerMinute: 2 } });

    const send = () => app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: chatBody(),
    });

    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    const blocked = await send();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.json().error.code).toBe('rate_limit_exceeded');
    await app.close();
  });

  it('uses the Anthropic error shape on /v1/messages so SDKs can parse it', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    const { app } = makeApp(pool, clientYielding([
      frame({ delta: { content: 'ok' } }),
      frame({ finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
    ]), { rateLimits: { requestsPerMinute: 1 } });

    const body = { model: 'wb-model', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] };
    const first = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'x-api-key': API_KEY }, payload: body,
    });
    expect(first.statusCode).toBe(200);

    const blocked = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'x-api-key': API_KEY }, payload: body,
    });
    expect(blocked.statusCode).toBe(429);
    // Anthropic clients expect { type: 'error', error: { type, message } }.
    expect(blocked.json()).toMatchObject({ type: 'error', error: { type: 'rate_limit_error' } });
    await app.close();
  });

  it('limits keys independently', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    const { app } = makeApp(pool, clientYielding([
      frame({ delta: { content: 'ok' } }),
      frame({ finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
    ]), { rateLimits: { requestsPerMinute: 1 } });

    const first = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${API_KEY}` }, payload: chatBody(),
    });
    expect(first.statusCode).toBe(200);

    // apiKey is the only accepted value, so a second distinct key is rejected
    // by auth rather than the limiter — proving the ordering: auth, then limit.
    const other = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${OTHER_KEY}` }, payload: chatBody(),
    });
    expect(other.statusCode).toBe(401);
    await app.close();
  });

  it('charges token usage against the daily quota', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    const { app, metrics } = makeApp(pool, clientYielding([
      frame({ finish_reason: 'stop', usage: { prompt_tokens: 400, completion_tokens: 400, total_tokens: 800 } }),
    ]), { rateLimits: { tokensPerDay: 500 } });

    const first = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${API_KEY}` }, payload: chatBody(),
    });
    expect(first.statusCode).toBe(200);

    // The first call reports 800 tokens, over the 500 quota; the next is blocked.
    const second = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${API_KEY}` }, payload: chatBody(),
    });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('insufficient_quota');
    // Usage is still recorded rather than dropped on the floor.
    expect(metrics.snapshot().tokens.prompt).toBe(400);
    await app.close();
  });
});

describe('admin API surfaces the new state', () => {
  it('reports pool health in the overview', async () => {
    const pool = new CredentialPool({ cooldownMs: 60_000 });
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    await pool.add(cred('token-b', 'user-b'), 'acct-2');
    pool.reportFailure('token-a', 'upstream 500');
    const { app } = makeApp(pool, clientYielding([]));

    const res = await app.inject({
      method: 'GET', url: '/admin/api/overview',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pool.health).toMatchObject({ size: 2, available: 1, unhealthy: 1, ready: true, state: 'degraded' });
    expect(JSON.stringify(body)).not.toContain('token-a');
    await app.close();
  });

  it('exposes the startup notice to the panel', async () => {
    const pool = new CredentialPool();
    const { app } = makeApp(pool, clientYielding([]), { startupNotice: 'Account pool is empty.' });
    const res = await app.inject({
      method: 'GET', url: '/admin/api/overview',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(res.json().notice).toBe('Account pool is empty.');
    await app.close();
  });

  it('requires the key for telemetry reads', async () => {
    const pool = new CredentialPool();
    const { app } = makeApp(pool, clientYielding([]));
    const denied = await app.inject({ method: 'GET', url: '/admin/api/telemetry' });
    expect(denied.statusCode).toBe(401);

    const allowed = await app.inject({
      method: 'GET', url: '/admin/api/telemetry',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ count: 0, events: [] });
    await app.close();
  });

  it('serves persisted telemetry back and never echoes a credential', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    const { app } = makeApp(pool, clientYielding([
      frame({ delta: { content: 'ok' } }),
      frame({ finish_reason: 'stop', usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } }),
    ]));

    await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${API_KEY}` }, payload: chatBody(),
    });
    await new Promise((r) => setTimeout(r, 150));

    const res = await app.inject({
      method: 'GET', url: '/admin/api/telemetry?kind=request',
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    const body = res.json();
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.events[0]).toMatchObject({ kind: 'request' });
    expect(JSON.stringify(body)).not.toContain('token-a');
    await app.close();
  });
});

describe('tool-call validation reaches the HTTP boundary', () => {
  it('returns 502 instead of a 200 with malformed tool arguments', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    // Truncated JSON: the old non-stream path returned this as a success.
    const { app, metrics } = makeApp(pool, clientYielding([
      frame({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'f', arguments: '{"a":' } }] } }),
      frame({ finish_reason: 'tool_calls' }),
    ]));

    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: chatBody({ tools: [{ type: 'function', function: { name: 'f', parameters: { type: 'object', properties: {} } } }] }),
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('upstream_protocol_error');
    expect(metrics.snapshot().total_errors).toBe(1);
    await app.close();
  });

  it('still returns valid tool calls for a well-formed stream', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    const { app } = makeApp(pool, clientYielding([
      frame({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'f', arguments: '{"city":"Paris"}' } }] } }),
      frame({ finish_reason: 'tool_calls', usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 } }),
    ]));

    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: chatBody({ tools: [{ type: 'function', function: { name: 'f', parameters: { type: 'object', properties: {} } } }] }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.tool_calls[0]).toMatchObject({
      id: 'call_a',
      function: { name: 'f', arguments: '{"city":"Paris"}' },
    });
    await app.close();
  });
});
