import type { FastifyRequest } from 'fastify';
import { openAiError, type ApiErrorCode } from '../openai/errors.js';
import { anthropicError } from '../anthropic/errors.js';
import type { MetricsCollector } from '../observability/metrics.js';
import type { RateLimiter } from '../security/rate-limit.js';

/**
 * Shared per-request bookkeeping for every protocol route.
 *
 * The three protocol routes (/v1/chat/completions, /v1/responses,
 * /v1/messages) each grew their own metrics-recording closure. They drifted:
 * only two of them recorded token usage, none recorded retry counts, and a
 * request that failed before reaching the upstream was recorded differently
 * from one that failed after. This module is the single place that decides
 * what a request record looks like, so dashboards do not have to know which
 * route produced a row.
 */

export type RequestOutcome = {
  status: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  error_code?: string;
  error_class?: string;
  account?: string;
};

export type RequestRecorder = {
  /** Record the request exactly once; later calls are ignored. */
  finish(outcome: RequestOutcome): void;
  /** Attempts made against the upstream so far, tracked in place. */
  readonly attempts: { attempts: number; retries: number };
  /** True once a record has been written. */
  readonly done: boolean;
};

const CLASS_BY_STATUS: Record<number, string> = {
  400: 'client_error',
  401: 'auth_error',
  403: 'auth_error',
  404: 'not_found',
  429: 'rate_limit',
  499: 'client_aborted',
  500: 'internal_error',
  502: 'upstream_error',
  503: 'unavailable',
  504: 'upstream_timeout',
};

export function createRecorder(opts: {
  req: FastifyRequest;
  path: string;
  metrics: MetricsCollector;
  startedAt: number;
  describe: () => { model?: string; stream: boolean; account?: string };
  keyId?: string;
}): RequestRecorder {
  let done = false;
  const attempts = { attempts: 1, retries: 0 };
  return {
    attempts,
    get done() {
      return done;
    },
    finish(outcome: RequestOutcome) {
      if (done) return;
      done = true;
      const meta = opts.describe();
      opts.metrics.record({
        request_id: String(opts.req.id),
        method: opts.req.method,
        path: opts.path,
        status: outcome.status,
        ...(meta.model !== undefined ? { model: meta.model } : {}),
        stream: meta.stream,
        duration_ms: Math.round(performance.now() - opts.startedAt),
        ...(outcome.prompt_tokens !== undefined ? { prompt_tokens: outcome.prompt_tokens } : {}),
        ...(outcome.completion_tokens !== undefined ? { completion_tokens: outcome.completion_tokens } : {}),
        ...(outcome.error_code !== undefined ? { error_code: outcome.error_code } : {}),
        error_class: outcome.error_class ?? CLASS_BY_STATUS[outcome.status],
        ...(meta.account !== undefined ? { account: meta.account } : {}),
        ...(opts.keyId !== undefined ? { key_id: opts.keyId } : {}),
        attempts: attempts.attempts,
        retries: attempts.retries,
      });
    },
  };
}

/**
 * Apply the per-key limiter to an incoming request. Returns a ready-to-send
 * rejection, or undefined when the request may proceed.
 *
 * Uses each protocol's own error shape: an Anthropic caller must receive an
 * Anthropic error object even for a 429.
 */
export function applyRateLimit(
  limiter: RateLimiter | undefined,
  keyId: string | undefined,
  isAnthropic: boolean,
  requestId: string,
):
  | { statusCode: number; body: unknown; code: string; retryAfterSeconds: number }
  | undefined {
  if (!limiter || !limiter.enabled || !keyId) return undefined;
  const decision = limiter.check(keyId);
  if (decision.allowed) return undefined;

  const code: ApiErrorCode = decision.reason === 'tokens_per_day' ? 'insufficient_quota' : 'rate_limit_exceeded';
  const message =
    decision.reason === 'tokens_per_day'
      ? `Daily token quota exceeded for this API key (${decision.used}/${decision.limit} tokens).`
      : `Rate limit exceeded for this API key (${decision.used}/${decision.limit} requests per minute).`;

  if (isAnthropic) {
    return {
      statusCode: 429,
      body: anthropicError(429, message, requestId),
      code,
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  }
  const err = openAiError(429, code, message);
  return { statusCode: err.statusCode, body: err.body, code, retryAfterSeconds: decision.retryAfterSeconds };
}
