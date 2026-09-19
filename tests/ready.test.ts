import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { registryWith } from './helpers/api-key-registry.js';
import { createMetrics } from '../src/observability/metrics.js';
import { CredentialPool } from '../src/workbuddy/credential-pool.js';
import type { WorkBuddyClient } from '../src/workbuddy/client.js';
import type { ExposedModel } from '../src/workbuddy/model-catalog.js';

const API_KEY = 'test-gateway-key';

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

/**
 * A client stub that never reaches the network. Used to observe routing and
 * error mapping; the upstream itself is exercised in the other suites.
 */
function stubClient(overrides: Partial<WorkBuddyClient> = {}): WorkBuddyClient {
  return {
    verifyCredential: async () => undefined,
    ...overrides,
  } as unknown as WorkBuddyClient;
}

function makeApp(pool: CredentialPool, extra: Record<string, unknown> = {}) {
  return buildApp({
    apiKey: API_KEY,
    apiKeys: registryWith(API_KEY),
    models: [model],
    client: stubClient(),
    pool,
    metrics: createMetrics(),
    upstreamUrl: 'https://example.invalid/v2/chat/completions',
    upstreamUa: 'test-agent',
    startedAt: Date.now(),
    version: '9.9.9',
    ...extra,
  });
}

describe('GET /health', () => {
  it('reports liveness regardless of pool state', async () => {
    // Liveness must not depend on the credential pool: an empty pool is not a
    // reason to restart the process, and conflating the two produced a /health
    // that returned 200 while every request failed.
    const app = makeApp(new CredentialPool());
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});

describe('GET /ready', () => {
  it('returns 503 when the pool is empty', async () => {
    const app = makeApp(new CredentialPool());
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: 'unavailable',
      pool: { state: 'empty', size: 0, available: 0 },
    });
    await app.close();
  });

  it('returns 200 when an account is available', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    const app = makeApp(pool);

    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ready',
      pool: { state: 'ready', size: 1, available: 1 },
      version: '9.9.9',
    });
    await app.close();
  });

  it('returns 503 when every account is cooling down', async () => {
    const pool = new CredentialPool({ cooldownMs: 60_000 });
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    pool.reportFailure('token-a', 'upstream 401');
    const app = makeApp(pool);

    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ pool: { state: 'unavailable', unhealthy: 1 } });
    await app.close();
  });

  it('returns 200 while degraded but still serving', async () => {
    const pool = new CredentialPool({ cooldownMs: 60_000 });
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    await pool.add(cred('token-b', 'user-b'), 'acct-2');
    pool.reportFailure('token-a');
    const app = makeApp(pool);

    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready', pool: { state: 'degraded', available: 1 } });
    await app.close();
  });

  it('surfaces a startup notice so a risky boot is visible', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    const app = makeApp(pool, { startupNotice: 'Using an ephemeral in-process key.' });

    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.json()).toMatchObject({ notice: 'Using an ephemeral in-process key.' });
    await app.close();
  });

  it('does not require an API key, so probes work unauthenticated', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    const app = makeApp(pool);
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
