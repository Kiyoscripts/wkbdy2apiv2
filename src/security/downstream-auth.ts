import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Downstream API key check. Constant-time comparison; the key never appears
 * in logs or error messages.
 */
export function isApiKeyValid(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * A stable, non-reversible fingerprint of a downstream API key.
 *
 * Per-key quotas and per-key usage reporting both need to tell callers apart,
 * but the key itself must never reach metrics, the admin panel, or disk. A
 * salted-free SHA-256 truncated to 16 hex characters is enough to distinguish
 * keys while remaining useless to anyone who reads the log.
 */
export function keyFingerprint(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return 'key_' + createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * The same fingerprint, derived from a stored key hash instead of the key.
 *
 * A key record keeps the full SHA-256 (`hashApiKey`), and telemetry keeps the
 * truncated, prefixed form (`keyFingerprint`), so usage can be attributed to a
 * key by prefixing the record's hash. Doing it here keeps the two definitions
 * adjacent: if the fingerprint format ever changes, this is the one other place
 * that must change with it. Callers use this instead of slicing a hash inline,
 * and it stays server-side — the hash itself is never sent to the panel.
 */
export function keyFingerprintFromHash(hash: string | undefined): string | undefined {
  if (!hash) return undefined;
  return 'key_' + hash.slice(0, 16);
}

/**
 * A short, human-comparable fragment of a presented key, safe to record.
 *
 * Only auth rejections need this, because a rejected key is absent from the
 * registry and therefore has no name to report. The fragment is what an
 * operator compares by eye against the key list, whose entries are identified
 * by their own leading characters.
 *
 * It is deliberately not `keyPrefix`, which returns the first 12 characters:
 * for a key shorter than that, it returns the whole secret, and even for a
 * 13-character key it would disclose almost all of it. Two rules keep this safe
 * by construction rather than by convention:
 *
 *  - Nothing is returned below {@link MIN_MASKABLE_LENGTH}. Shorter values are
 *    not keys this gateway issued (generated keys are 36 characters), so a
 *    fragment of one would be both useless and disproportionate.
 *  - At most {@link MASK_LENGTH} characters come back, which for any eligible
 *    key leaves the overwhelming majority of its entropy unrecorded.
 */
const MASK_LENGTH = 8;
const MIN_MASKABLE_LENGTH = 24;
export function maskedKeyPrefix(key: string | undefined): string | undefined {
  if (!key || key.length < MIN_MASKABLE_LENGTH) return undefined;
  return key.slice(0, MASK_LENGTH);
}

export type ApiKeyHeaders = {
  authorization?: string | string[];
  'x-api-key'?: string | string[];
  'api-key'?: string | string[];
};

export type ExtractedApiKey = {
  value?: string;
  conflicting: boolean;
  sources: string[];
};

/**
 * Normalize common OpenAI/Anthropic/Azure-style API-key headers.
 * Values are trimmed and Bearer matching is case-insensitive. Multiple
 * identical headers are accepted; different values are rejected as ambiguous.
 */
export function extractApiKey(headers: ApiKeyHeaders): ExtractedApiKey {
  const candidates: Array<{ source: string; value: string }> = [];
  const first = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value)?.trim();

  const authorization = first(headers.authorization);
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (match?.[1]?.trim()) candidates.push({ source: 'authorization', value: match[1].trim() });
  }
  const xApiKey = first(headers['x-api-key']);
  if (xApiKey) candidates.push({ source: 'x-api-key', value: xApiKey });
  const apiKey = first(headers['api-key']);
  if (apiKey) candidates.push({ source: 'api-key', value: apiKey });

  const values = new Set(candidates.map((candidate) => candidate.value));
  return {
    value: candidates[0]?.value,
    conflicting: values.size > 1,
    sources: candidates.map((candidate) => candidate.source),
  };
}
