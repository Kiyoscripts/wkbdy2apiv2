import { describe, expect, it, vi } from 'vitest';
import { CredentialPool } from '../src/workbuddy/credential-pool.js';
import { MetricsCollector } from '../src/observability/metrics.js';

const cred = (token: string, userId = 'u1') => ({
  accessToken: token,
  userId,
  domain: 'workbuddy.ai',
  expiresAt: Date.now() + 3_600_000,
  oauthOrigin: 'import',
});

describe('CredentialPool.health', () => {
  it('reports an empty pool as not ready', async () => {
    const health = new CredentialPool().health();
    expect(health).toMatchObject({ size: 0, available: 0, ready: false, state: 'empty' });
    expect(health.accounts).toEqual([]);
  });

  it('reports a single healthy account as ready', async () => {
    const pool: CredentialPool = new CredentialPool();
    await pool.add(cred('token-a'), 'acct-1');
    expect(pool.health()).toMatchObject({ size: 1, available: 1, unhealthy: 0, ready: true, state: 'ready' });
  });

  it('marks a failing account as cooling down with a remaining cooldown', async () => {
    const pool = new CredentialPool({ cooldownMs: 60_000 });
    await pool.add(cred('token-a'), 'acct-1');
    pool.reportFailure('token-a', 'upstream 401');

    const health = pool.health();
    expect(health.ready).toBe(false);
    expect(health.state).toBe('unavailable');
    expect(health.accounts[0]).toMatchObject({
      note: 'acct-1',
      state: 'cooling_down',
      failures: 1,
      last_error: 'upstream 401',
    });
    expect(health.accounts[0]!.cooldown_remaining_ms).toBeGreaterThan(0);
  });

  it('reports degraded when some accounts remain usable', async () => {
    const pool = new CredentialPool({ cooldownMs: 60_000 });
    // Distinct userIds: the pool dedupes on domain+userId, so two fixtures
    // sharing an identity would merge into one account.
    await pool.add(cred('token-a', 'user-a'), 'acct-1');
    await pool.add(cred('token-b', 'user-b'), 'acct-2');
    pool.reportFailure('token-a');

    expect(pool.health()).toMatchObject({ size: 2, available: 1, unhealthy: 1, ready: true, state: 'degraded' });
  });

  it('clears cooldown state when an account succeeds again', async () => {
    const pool = new CredentialPool({ cooldownMs: 60_000 });
    await pool.add(cred('token-a'), 'acct-1');
    pool.reportFailure('token-a', 'transient');
    expect(pool.health().accounts[0]!.state).toBe('cooling_down');

    pool.reportSuccess('token-a');
    expect(pool.health().accounts[0]).toMatchObject({ state: 'healthy', failures: 0 });
    expect(pool.health().ready).toBe(true);
  });

  it('marks an account as needing re-login', async () => {
    const pool: CredentialPool = new CredentialPool();
    await pool.add(cred('token-a'), 'acct-1');
    pool.markReauthRequired(pool.health().accounts[0]!.label, 'refresh token rejected');

    expect(pool.health()).toMatchObject({ available: 0, ready: false });
    expect(pool.health().accounts[0]).toMatchObject({
      state: 'reauth_required',
      last_error: 'refresh token rejected',
    });
  });

  it('escalates the cooldown on repeated failures', async () => {
    const pool = new CredentialPool({ cooldownMs: 1_000 });
    await pool.add(cred('token-a'), 'acct-1');
    pool.reportFailure('token-a');
    const first = pool.health().accounts[0]!.cooldown_remaining_ms!;
    pool.reportFailure('token-a');
    const second = pool.health().accounts[0]!.cooldown_remaining_ms!;
    // Backoff must grow, or a persistently broken account retries forever.
    expect(second).toBeGreaterThan(first);
  });

  it('caps the cooldown so an account always gets retried eventually', async () => {
    const pool = new CredentialPool({ cooldownMs: 60_000 });
    await pool.add(cred('token-a'), 'acct-1');
    for (let i = 0; i < 20; i += 1) pool.reportFailure('token-a');
    expect(pool.health().accounts[0]!.cooldown_remaining_ms!).toBeLessThanOrEqual(30 * 60_000);
  });

  it('ignores a failure report for an unknown token', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('token-a'), 'acct-1');
    pool.reportFailure('not-a-real-token');
    expect(pool.health().accounts[0]).toMatchObject({ state: 'healthy', failures: 0 });
  });

  it('exposes no credential values through the health surface', async () => {
    const pool = new CredentialPool();
    await pool.add(cred('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature'), 'acct-1');
    const serialized = JSON.stringify(pool.health());
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(serialized).not.toContain('signature');
  });
});

describe('CredentialPool event sink', () => {
  it('emits pool lifecycle events in order', async () => {
    const events: Array<{ event: string; label?: string }> = [];
    const pool = new CredentialPool({ cooldownMs: 60_000 });
    pool.setEventSink((event) => events.push(event));

    await pool.add(cred('token-a'), 'acct-1');
    pool.reportFailure('token-a');
    pool.reportSuccess('token-a');
    await pool.remove(pool.health().accounts[0]!.label);

    expect(events.map((e) => e.event)).toEqual(['added', 'quarantined', 'restored', 'removed']);
    expect(events[0]!.label).toMatch(/^#\d+$/);
  });

  it('emits a strategy change so the timeline shows who changed it', async () => {
    const events: Array<{ event: string; strategy?: string }> = [];
    const pool = new CredentialPool();
    pool.setEventSink((event) => events.push(event));
    await pool.setStrategy('random');
    expect(events).toEqual([expect.objectContaining({ event: 'strategy_changed', strategy: 'random' })]);
  });

  it('does not emit a restore event when a success changes nothing', async () => {
    const events: Array<{ event: string }> = [];
    const pool = new CredentialPool();
    await pool.add(cred('token-a'), 'acct-1');
    pool.setEventSink((event) => events.push(event));
    pool.reportSuccess('token-a');
    // A healthy account succeeding is not an event worth persisting.
    expect(events).toEqual([]);
  });
});

describe('MetricsCollector', () => {
  it('aggregates totals, tokens, and retries', async () => {
    const metrics = new MetricsCollector();
    metrics.record({ method: 'POST', path: '/v1/chat/completions', status: 200, stream: false, duration_ms: 10, prompt_tokens: 5, completion_tokens: 3 });
    metrics.record({ method: 'POST', path: '/v1/chat/completions', status: 502, stream: false, duration_ms: 20, error_code: 'upstream_error', attempts: 3, retries: 2 });

    const snap = metrics.snapshot();
    expect(snap.total_requests).toBe(2);
    expect(snap.total_errors).toBe(1);
    expect(snap.tokens).toEqual({ prompt: 5, completion: 3 });
    expect(snap.total_retries).toBe(2);
    // 2 retries across 2 requests: retries can outnumber requests when the upstream
    // needs several attempts for a single call.
    expect(snap.retry_rate).toBe(1);
  });

  it('derives retries from attempts when only attempts are given', async () => {
    const metrics = new MetricsCollector();
    metrics.record({ method: 'POST', path: '/v1/messages', status: 200, stream: false, duration_ms: 1, attempts: 3 });
    expect(metrics.snapshot().total_retries).toBe(2);
  });

  it('keeps per-model, per-key, and per-account token totals', async () => {
    const metrics = new MetricsCollector();
    metrics.record({ method: 'POST', path: '/v1/chat/completions', status: 200, stream: false, duration_ms: 1, model: 'wb-a', prompt_tokens: 10, completion_tokens: 20, key_id: 'key_1', account: 'acct-1' });
    metrics.record({ method: 'POST', path: '/v1/chat/completions', status: 200, stream: false, duration_ms: 1, model: 'wb-b', prompt_tokens: 1, completion_tokens: 1, key_id: 'key_2', account: 'acct-1' });

    const snap = metrics.snapshot();
    expect(snap.per_model).toEqual([
      expect.objectContaining({ model: 'wb-a', count: 1, tokens: 30 }),
      expect.objectContaining({ model: 'wb-b', count: 1, tokens: 2 }),
    ]);
    expect(snap.per_key).toHaveLength(2);
    expect(snap.per_account).toEqual([expect.objectContaining({ account: 'acct-1', requests: 2, total_tokens: 32 })]);
  });

  it('counts error codes by frequency', async () => {
    const metrics = new MetricsCollector();
    metrics.record({ method: 'POST', path: '/v1/chat/completions', status: 502, stream: false, duration_ms: 1, error_code: 'upstream_error' });
    metrics.record({ method: 'POST', path: '/v1/chat/completions', status: 502, stream: false, duration_ms: 1, error_code: 'upstream_error' });
    metrics.record({ method: 'POST', path: '/v1/chat/completions', status: 401, stream: false, duration_ms: 1, error_code: 'invalid_api_key' });
    expect(metrics.snapshot().error_codes).toEqual([
      { code: 'upstream_error', count: 2 },
      { code: 'invalid_api_key', count: 1 },
    ]);
  });

  it('counts accepted-but-dropped fields so SDK drift is visible', async () => {
    const metrics = new MetricsCollector();
    metrics.recordDroppedFields(['logit_bias', 'n']);
    metrics.recordDroppedFields(['logit_bias']);
    expect(metrics.snapshot().dropped_fields).toEqual([
      { field: 'logit_bias', count: 2 },
      { field: 'n', count: 1 },
    ]);
  });

  it('forwards every recorded entry to the durable sink', async () => {
    const metrics = new MetricsCollector();
    const sink = vi.fn();
    metrics.setSink(sink);
    metrics.record({ method: 'POST', path: '/v1/chat/completions', status: 200, stream: false, duration_ms: 1, request_id: 'req-7' });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toMatchObject({ request_id: 'req-7', status: 200 });
  });

  it('preserves the supplied request id rather than replacing it', async () => {
    const metrics = new MetricsCollector();
    const sink = vi.fn();
    metrics.setSink(sink);
    metrics.record({ method: 'POST', path: '/v1/messages', status: 200, stream: true, duration_ms: 1, request_id: 'abc-123' });
    // Request-ID coverage is what makes a persisted row match a log line.
    expect(sink.mock.calls[0]![0].request_id).toBe('abc-123');
  });

  it('reports a bounded recent window, newest first', async () => {
    const metrics = new MetricsCollector();
    for (let i = 0; i < 250; i += 1) {
      metrics.record({ method: 'POST', path: '/v1/chat/completions', status: 200, stream: false, duration_ms: 1, request_id: `req-${i}` });
    }
    const recent = metrics.snapshot().recent;
    expect(recent).toHaveLength(200);
    expect(recent[0]!.request_id).toBe('req-249');
  });

  it('handles an empty snapshot without dividing by zero', async () => {
    const snap = new MetricsCollector().snapshot();
    expect(snap.error_rate).toBe(0);
    expect(snap.retry_rate).toBe(0);
    expect(snap.p95_ms).toBeNull();
  });
});
