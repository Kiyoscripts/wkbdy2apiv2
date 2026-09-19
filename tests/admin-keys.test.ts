import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { ApiKeyRegistry } from '../src/security/api-keys.js';
import { createMetrics } from '../src/observability/metrics.js';
import { CredentialPool } from '../src/workbuddy/credential-pool.js';
import type { WorkBuddyClient } from '../src/workbuddy/client.js';
import type { ExposedModel } from '../src/workbuddy/model-catalog.js';

/**
 * Admin API-key endpoints, and the auth rules they enforce.
 *
 * Two behaviours matter beyond plain CRUD:
 *
 *  - **Admin vs non-admin.** A key issued for API access must not be able to
 *    add accounts or mint more keys. Without this split, handing a teammate a
 *    key for /v1 access also hands them the gateway.
 *  - **Revocation is immediate.** A revoked key fails on the very next request,
 *    not on some later restart.
 */

const ADMIN_KEY = 'admin-key-0123456789abcdef';
const CLIENT_KEY = 'client-key-0123456789abcdef';

type Harness = { app: FastifyInstance; registry: ApiKeyRegistry; dir: string; persisted: () => Promise<unknown> };

async function makeHarness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'wkb-keys-'));
  // Mirrors main.ts: the env key is the registry's bootstrap credential, so it
  // stays valid even when every stored record is deleted.
  const registry = new ApiKeyRegistry(ADMIN_KEY);
  registry.createWithValue(CLIENT_KEY, { name: 'client', admin: false });

  const pool = new CredentialPool();
  const client = {
    verifyCredential: async () => {},
  } as unknown as WorkBuddyClient;

  const persistKeys = async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'keys.json'), JSON.stringify({ version: 1, keys: registry.list() }), 'utf8');
  };

  const app = buildApp({
    apiKey: ADMIN_KEY,
    apiKeys: registry,
    persistKeys,
    models: [] as ExposedModel[],
    client,
    pool,
    metrics: createMetrics(),
    upstreamUrl: 'https://mock.invalid/v2/chat/completions',
    upstreamUa: 'test/1',
    startedAt: Date.now(),
    version: 'test',
  });

  return {
    app,
    registry,
    dir,
    persisted: async () => JSON.parse(await readFile(join(dir, 'keys.json'), 'utf8')),
  };
}

function auth(key: string) {
  return { authorization: `Bearer ${key}` };
}

describe('admin API key management', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });

  afterEach(async () => {
    await h.app.close();
    await rm(h.dir, { recursive: true, force: true });
  });

  it('requires authentication to list keys', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/admin/api/keys' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a key that is not in the registry', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/admin/api/keys', headers: auth('forged-key-xxxxxxxxxxxx') });
    expect(res.statusCode).toBe(401);
  });

  it('lists keys without ever returning a hash or plaintext', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/admin/api/keys', headers: auth(ADMIN_KEY) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { keys: Array<Record<string, unknown>>; bootstrap_key: { revocable: boolean } };
    // Only the one stored record; the env key is reported separately as the
    // always-valid bootstrap credential rather than as a revocable row.
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]!.name).toBe('client');
    for (const key of body.keys) {
      expect(key.hash).toBeUndefined();
      expect(JSON.stringify(key)).not.toContain(ADMIN_KEY);
      expect(JSON.stringify(key)).not.toContain(CLIENT_KEY);
    }
    // The env key is advertised as permanent so nobody goes looking for a
    // delete button that does not exist.
    expect(body.bootstrap_key.revocable).toBe(false);
  });

  it('creates a key and returns the plaintext exactly once', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/admin/api/keys',
      headers: { ...auth(ADMIN_KEY), 'content-type': 'application/json' },
      payload: { name: 'ci-runner' },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { key: string; id: string; warning: string };
    expect(body.key).toMatch(/^wkb_/);
    expect(body.warning).toMatch(/not recoverable/i);

    // The new key authenticates immediately.
    const viaNew = await h.app.inject({ method: 'GET', url: '/admin/api/keys', headers: auth(body.key) });
    expect(viaNew.statusCode).toBe(403); // non-admin by default: reads? no — see below
  });

  it('omits the plaintext from every later listing', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/admin/api/keys',
      headers: { ...auth(ADMIN_KEY), 'content-type': 'application/json' },
      payload: { name: 'ci-runner' },
    });
    const { key } = created.json() as { key: string };

    const listed = await h.app.inject({ method: 'GET', url: '/admin/api/keys', headers: auth(ADMIN_KEY) });
    // The secret exists only in the create response. There is no endpoint that
    // returns it again, which is the point.
    expect(listed.body).not.toContain(key);
  });

  it('persists the registry after a create', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/admin/api/keys',
      headers: { ...auth(ADMIN_KEY), 'content-type': 'application/json' },
      payload: { name: 'persisted-key' },
    });
    const saved = (await h.persisted()) as { keys: Array<{ name: string }> };
    expect(saved.keys.some((k) => k.name === 'persisted-key')).toBe(true);
  });

  it('validates the name', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/admin/api/keys',
      headers: { ...auth(ADMIN_KEY), 'content-type': 'application/json' },
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('revokes a key and stops it authenticating on the next request', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/admin/api/keys',
      headers: { ...auth(ADMIN_KEY), 'content-type': 'application/json' },
      payload: { name: 'doomed', admin: true },
    });
    const { id, key } = created.json() as { id: string; key: string };

    // Works before revocation.
    expect((await h.app.inject({ method: 'GET', url: '/admin/api/keys', headers: auth(key) })).statusCode).toBe(200);

    const revoked = await h.app.inject({ method: 'DELETE', url: `/admin/api/keys/${id}`, headers: auth(ADMIN_KEY) });
    expect(revoked.statusCode).toBe(200);

    // And immediately fails after. No cache, no grace period, no restart needed.
    expect((await h.app.inject({ method: 'GET', url: '/admin/api/keys', headers: auth(key) })).statusCode).toBe(401);
  });

  it('returns 404 when revoking an unknown key rather than claiming success', async () => {
    const res = await h.app.inject({ method: 'DELETE', url: '/admin/api/keys/nope', headers: auth(ADMIN_KEY) });
    expect(res.statusCode).toBe(404);
  });

  it('cannot lock the operator out: the env bootstrap key always works', async () => {
    // Delete every registry entry, including the admin one.
    for (const record of h.registry.list()) h.registry.remove(record.id);
    expect(h.registry.size()).toBe(0);

    // The panel is still reachable, so a bad deletion is recoverable.
    const res = await h.app.inject({ method: 'GET', url: '/admin/api/keys', headers: auth(ADMIN_KEY) });
    expect(res.statusCode).toBe(200);
  });

  it('lets an admin key issue and promote further admin keys', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/admin/api/keys',
      headers: { ...auth(ADMIN_KEY), 'content-type': 'application/json' },
      payload: { name: 'second-admin', admin: true },
    });
    const { key } = created.json() as { key: string };

    // A newly issued admin key can itself manage the gateway.
    const res = await h.app.inject({
      method: 'POST',
      url: '/admin/api/keys',
      headers: { ...auth(key), 'content-type': 'application/json' },
      payload: { name: 'grandchild' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('denies gateway management to a non-admin key', async () => {
    // The client key authenticates but must not be able to mutate anything.
    const list = await h.app.inject({ method: 'GET', url: '/admin/api/keys', headers: auth(CLIENT_KEY) });
    expect(list.statusCode).toBe(403);
    expect((list.json() as { error: { code: string } }).error.code).toBe('permission_denied');

    const create = await h.app.inject({
      method: 'POST',
      url: '/admin/api/keys',
      headers: { ...auth(CLIENT_KEY), 'content-type': 'application/json' },
      payload: { name: 'sneaky' },
    });
    expect(create.statusCode).toBe(403);

    const remove = await h.app.inject({ method: 'DELETE', url: '/admin/api/keys/whatever', headers: auth(CLIENT_KEY) });
    expect(remove.statusCode).toBe(403);
  });

  it('denies account mutation to a non-admin key', async () => {
    // The same rule has to hold for every mutating admin endpoint, not just the
    // key ones — otherwise a client key could add an upstream account.
    const res = await h.app.inject({
      method: 'POST',
      url: '/admin/api/accounts/remove',
      headers: { ...auth(CLIENT_KEY), 'content-type': 'application/json' },
      payload: { label: 'anything' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('renames a key and toggles its admin flag', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/admin/api/keys',
      headers: { ...auth(ADMIN_KEY), 'content-type': 'application/json' },
      payload: { name: 'old-name' },
    });
    const { id, key } = created.json() as { id: string; key: string };

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/admin/api/keys/${id}`,
      headers: { ...auth(ADMIN_KEY), 'content-type': 'application/json' },
      payload: { name: 'new-name', admin: true },
    });
    expect(patched.statusCode).toBe(200);

    // Promoting takes effect immediately for the holder of that key.
    const res = await h.app.inject({ method: 'GET', url: '/admin/api/keys', headers: auth(key) });
    expect(res.statusCode).toBe(200);
  });

  it('accepts OpenAI-style x-api-key on /v1 as well as Bearer', async () => {
    // The registry sits behind the same header extraction as before, so all
    // three header styles keep working.
    const byBearer = await h.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${CLIENT_KEY}`, 'content-type': 'application/json' },
      payload: { model: 'x', messages: [{ role: 'user', content: 'hi' }] },
    });
    const byXApiKey = await h.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'x-api-key': CLIENT_KEY, 'content-type': 'application/json' },
      payload: { model: 'x', messages: [{ role: 'user', content: 'hi' }] },
    });
    // Neither is 401: both authenticated and got past the auth guard to the
    // upstream layer (which is a mock here).
    expect(byBearer.statusCode).not.toBe(401);
    expect(byXApiKey.statusCode).not.toBe(401);
  });

  it('rejects a revoked key on /v1 immediately', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/admin/api/keys',
      headers: { ...auth(ADMIN_KEY), 'content-type': 'application/json' },
      payload: { name: 'short-lived', admin: true },
    });
    const { id, key } = created.json() as { id: string; key: string };

    const before = await h.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      payload: { model: 'x', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(before.statusCode).not.toBe(401);

    await h.app.inject({ method: 'DELETE', url: `/admin/api/keys/${id}`, headers: auth(ADMIN_KEY) });

    const after = await h.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      payload: { model: 'x', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(after.statusCode).toBe(401);
  });

  it('counts requests per key so the panel can show activity', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/admin/api/keys',
      headers: { ...auth(ADMIN_KEY), 'content-type': 'application/json' },
      payload: { name: 'busy', admin: true },
    });
    const { id, key } = created.json() as { id: string; key: string };

    for (let i = 0; i < 3; i += 1) {
      await h.app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        payload: { model: 'x', messages: [{ role: 'user', content: 'hi' }] },
      });
    }

    const record = h.registry.get(id);
    expect(record?.request_count).toBe(3);
    expect(record?.last_used_at).toBeTruthy();
  });
});
