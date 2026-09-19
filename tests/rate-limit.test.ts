import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/security/rate-limit.js';
import { keyFingerprint, extractApiKey } from '../src/security/downstream-auth.js';

const MINUTE = 60_000;

describe('RateLimiter — requests per minute', () => {
  it('allows traffic up to the limit and rejects beyond it', () => {
    const limiter = new RateLimiter({ requestsPerMinute: 3 });
    const now = Date.now();
    expect(limiter.check('key_a', now).allowed).toBe(true);
    expect(limiter.check('key_a', now).allowed).toBe(true);
    expect(limiter.check('key_a', now).allowed).toBe(true);
    const blocked = limiter.check('key_a', now);
    expect(blocked.allowed).toBe(false);
    expect(blocked).toMatchObject({ reason: 'requests_per_minute', limit: 3, used: 3 });
  });

  it('reports how long to wait before retrying', () => {
    const limiter = new RateLimiter({ requestsPerMinute: 1 });
    const now = Date.now();
    limiter.check('key_a', now);
    const blocked = limiter.check('key_a', now + 10_000);
    expect(blocked.allowed).toBe(false);
    // The window started at `now`, so ~50s remain.
    expect(blocked.allowed === false && blocked.retryAfterSeconds).toBe(50);
  });

  it('frees capacity once the window slides', () => {
    const limiter = new RateLimiter({ requestsPerMinute: 1 });
    const now = Date.now();
    limiter.check('key_a', now);
    expect(limiter.check('key_a', now).allowed).toBe(false);
    expect(limiter.check('key_a', now + MINUTE + 1).allowed).toBe(true);
  });

  it('counts each key independently', () => {
    const limiter = new RateLimiter({ requestsPerMinute: 1 });
    const now = Date.now();
    expect(limiter.check('key_a', now).allowed).toBe(true);
    // One noisy key must not throttle the others.
    expect(limiter.check('key_b', now).allowed).toBe(true);
    expect(limiter.check('key_a', now).allowed).toBe(false);
  });
});

describe('RateLimiter — tokens per day', () => {
  it('blocks once the daily token quota is spent', () => {
    const limiter = new RateLimiter({ tokensPerDay: 100 });
    const now = Date.now();
    expect(limiter.check('key_a', now).allowed).toBe(true);
    limiter.recordTokens('key_a', 60, now);
    expect(limiter.check('key_a', now).allowed).toBe(true);
    limiter.recordTokens('key_a', 50, now);
    const blocked = limiter.check('key_a', now);
    expect(blocked.allowed).toBe(false);
    expect(blocked).toMatchObject({ reason: 'tokens_per_day', limit: 100, used: 110 });
  });

  it('lets a request through when no usage has been recorded', () => {
    // Token accounting is post-hoc: usage arrives with the finish frame, so the
    // very first request of a window can never be blocked by token counts.
    const limiter = new RateLimiter({ tokensPerDay: 1 });
    expect(limiter.check('fresh', Date.now()).allowed).toBe(true);
  });

  it('expires usage after a rolling day', () => {
    const limiter = new RateLimiter({ tokensPerDay: 100 });
    const now = Date.now();
    limiter.check('key_a', now);
    limiter.recordTokens('key_a', 200, now);
    expect(limiter.check('key_a', now).allowed).toBe(false);
    expect(limiter.check('key_a', now + 25 * 60 * 60_000).allowed).toBe(true);
  });

  it('ignores zero or negative token reports', () => {
    const limiter = new RateLimiter({ tokensPerDay: 100 });
    const now = Date.now();
    limiter.recordTokens('key_a', 0, now);
    limiter.recordTokens('key_a', -50, now);
    expect(limiter.check('key_a', now).allowed).toBe(true);
    expect(limiter.describe('key_a', now).tokens_last_day).toBe(0);
  });
});

describe('RateLimiter — configuration and observability', () => {
  it('is inert when both limits are zero', () => {
    const limiter = new RateLimiter({});
    expect(limiter.enabled).toBe(false);
    const now = Date.now();
    for (let i = 0; i < 100; i += 1) expect(limiter.check('key_a', now).allowed).toBe(true);
  });

  it('describes current usage for the admin panel', () => {
    const limiter = new RateLimiter({ requestsPerMinute: 10, tokensPerDay: 1000 });
    const now = Date.now();
    limiter.check('key_a', now);
    limiter.check('key_a', now);
    limiter.recordTokens('key_a', 42, now);
    expect(limiter.describe('key_a', now)).toEqual({ requests_last_minute: 2, tokens_last_day: 42 });
  });

  it('describes an unknown key as unused', () => {
    expect(new RateLimiter({ requestsPerMinute: 1 }).describe('nobody')).toEqual({
      requests_last_minute: 0,
      tokens_last_day: 0,
    });
  });

  it('sweeps idle keys so the limiter cannot grow without bound', () => {
    const limiter = new RateLimiter({ requestsPerMinute: 2 });
    const now = Date.now();
    limiter.check('key_a', now);
    limiter.sweep(now + 48 * 60 * 60_000);
    // Fresh window after the sweep: capacity is available again.
    expect(limiter.check('key_a', now + 48 * 60 * 60_000).allowed).toBe(true);
  });
});

describe('keyFingerprint', () => {
  it('is stable for the same key', () => {
    expect(keyFingerprint('secret-key-value')).toBe(keyFingerprint('secret-key-value'));
  });

  it('distinguishes different keys', () => {
    expect(keyFingerprint('key-one')).not.toBe(keyFingerprint('key-two'));
  });

  it('never contains the raw key', () => {
    const raw = 'super-secret-api-key';
    const fp = keyFingerprint(raw)!;
    expect(fp).not.toContain(raw);
    expect(fp).toMatch(/^key_[0-9a-f]{16}$/);
  });

  it('returns undefined for a missing key', () => {
    expect(keyFingerprint(undefined)).toBeUndefined();
    expect(keyFingerprint('')).toBeUndefined();
  });
});

describe('extractApiKey', () => {
  it('accepts a Bearer token', () => {
    expect(extractApiKey({ authorization: 'Bearer abc123' })).toMatchObject({ value: 'abc123', conflicting: false });
  });

  it('accepts a lowercase bearer scheme', () => {
    expect(extractApiKey({ authorization: 'bearer abc123' }).value).toBe('abc123');
  });

  it('accepts x-api-key and api-key', () => {
    expect(extractApiKey({ 'x-api-key': 'abc123' }).value).toBe('abc123');
    expect(extractApiKey({ 'api-key': 'abc123' }).value).toBe('abc123');
  });

  it('trims surrounding whitespace', () => {
    expect(extractApiKey({ authorization: 'Bearer   abc123  ' }).value).toBe('abc123');
  });

  it('flags conflicting values across headers', () => {
    const out = extractApiKey({ authorization: 'Bearer abc123', 'x-api-key': 'different' });
    expect(out.conflicting).toBe(true);
    expect(out.sources).toEqual(['authorization', 'x-api-key']);
  });

  it('does not flag the same value repeated in two headers', () => {
    expect(extractApiKey({ authorization: 'Bearer abc123', 'x-api-key': 'abc123' }).conflicting).toBe(false);
  });

  it('reports no value when nothing is supplied', () => {
    expect(extractApiKey({})).toMatchObject({ value: undefined, conflicting: false, sources: [] });
  });

  it('ignores an authorization header that is not a bearer token', () => {
    expect(extractApiKey({ authorization: 'Basic dXNlcjpwYXNz' }).value).toBeUndefined();
  });
});
