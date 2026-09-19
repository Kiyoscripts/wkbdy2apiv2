/**
 * Per-key rate limiting and quotas.
 *
 * Before this, one leaked gateway key meant unlimited WorkBuddy quota burn:
 * there was no per-key accounting anywhere, and the only limit was whatever the
 * upstream account happened to allow. Limits are per fingerprint (see
 * keyFingerprint), never per raw key, so a limiter state dump cannot leak a
 * credential.
 *
 * Two independent limits:
 *   - requests per rolling minute  (burst protection)
 *   - tokens per rolling day       (cost protection)
 *
 * Token accounting is necessarily post-hoc: usage arrives on the finish frame,
 * after the work is already done. The limit therefore blocks the *next*
 * request rather than aborting the in-flight one, which is the behaviour a
 * caller can actually reason about.
 */

export type RateLimitConfig = {
  /** Max requests per rolling 60s window, per key. 0 disables the limit. */
  requestsPerMinute?: number;
  /** Max total tokens per rolling 24h window, per key. 0 disables the limit. */
  tokensPerDay?: number;
};

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: 'requests_per_minute' | 'tokens_per_day'; retryAfterSeconds: number; limit: number; used: number };

type KeyUsage = {
  /** Timestamps of requests inside the current minute window. */
  requestTimes: number[];
  /** Token totals bucketed by the hour, for the rolling day window. */
  hourly: Map<number, number>;
};

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export class RateLimiter {
  private readonly usage = new Map<string, KeyUsage>();
  private readonly requestLimit: number;
  private readonly tokenLimit: number;

  constructor(config: RateLimitConfig = {}) {
    this.requestLimit = config.requestsPerMinute ?? 0;
    this.tokenLimit = config.tokensPerDay ?? 0;
  }

  get enabled(): boolean {
    return this.requestLimit > 0 || this.tokenLimit > 0;
  }

  /**
   * Check whether a key may start a request. Counts the request when allowed,
   * so callers must not call this twice for one request.
   */
  check(keyId: string, now = Date.now()): RateLimitDecision {
    if (!this.enabled) return { allowed: true };
    const state = this.usage.get(keyId) ?? { requestTimes: [], hourly: new Map() };
    this.usage.set(keyId, state);
    state.requestTimes = state.requestTimes.filter((t) => now - t < MINUTE_MS);
    this.prune(state, now);

    if (this.requestLimit > 0 && state.requestTimes.length >= this.requestLimit) {
      const oldest = state.requestTimes[0] ?? now;
      return {
        allowed: false,
        reason: 'requests_per_minute',
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + MINUTE_MS - now) / 1000)),
        limit: this.requestLimit,
        used: state.requestTimes.length,
      };
    }

    if (this.tokenLimit > 0) {
      const used = this.totalTokens(state);
      if (used >= this.tokenLimit) {
        const oldestBucket = [...state.hourly.keys()].sort((a, b) => a - b)[0] ?? now;
        return {
          allowed: false,
          reason: 'tokens_per_day',
          retryAfterSeconds: Math.max(1, Math.ceil((oldestBucket + DAY_MS - now) / 1000)),
          limit: this.tokenLimit,
          used,
        };
      }
    }

    state.requestTimes.push(now);
    return { allowed: true };
  }

  /** Attribute token usage to a key once the upstream reports it. */
  recordTokens(keyId: string, tokens: number, now = Date.now()): void {
    if (!this.enabled || tokens <= 0) return;
    const state = this.usage.get(keyId) ?? { requestTimes: [], hourly: new Map() };
    this.usage.set(keyId, state);
    const bucket = Math.floor(now / HOUR_MS);
    state.hourly.set(bucket, (state.hourly.get(bucket) ?? 0) + tokens);
    this.prune(state, now);
  }

  /** Current usage for one key, for the admin panel. */
  describe(keyId: string, now = Date.now()): { requests_last_minute: number; tokens_last_day: number } {
    const state = this.usage.get(keyId);
    if (!state) return { requests_last_minute: 0, tokens_last_day: 0 };
    return {
      requests_last_minute: state.requestTimes.filter((t) => now - t < MINUTE_MS).length,
      tokens_last_day: this.totalTokens(state),
    };
  }

  /** Drop usage for keys that have been quiet for over a day. */
  sweep(now = Date.now()): void {
    for (const [key, state] of this.usage) {
      this.prune(state, now);
      if (state.requestTimes.length === 0 && state.hourly.size === 0) this.usage.delete(key);
    }
  }

  private totalTokens(state: KeyUsage): number {
    let total = 0;
    for (const value of state.hourly.values()) total += value;
    return total;
  }

  private prune(state: KeyUsage, now: number): void {
    const cutoff = Math.floor((now - DAY_MS) / HOUR_MS);
    for (const bucket of [...state.hourly.keys()]) {
      if (bucket <= cutoff) state.hourly.delete(bucket);
    }
  }
}

export function createRateLimiter(config: RateLimitConfig = {}): RateLimiter {
  return new RateLimiter(config);
}
