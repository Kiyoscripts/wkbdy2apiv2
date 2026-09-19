/**
 * Recursive redaction for structured logs. Keys are matched case-insensitively
 * against a sensitive-key set; values are replaced wholesale, never logged.
 * Arrays and nested objects are traversed; cycles are tolerated.
 */

const SENSITIVE_KEYS = new Set(
  [
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'api-key',
    'x-api-key',
    'x-user-id',
    'token',
    'accesstoken',
    'refreshtoken',
    'x-refresh-token',
    'authurl',
    'authorization_url',
    'officialstate',
    'state',
    'accesstokentype',
    'session',
    'secret',
    'password',
    'apikey',
  ].map((k) => k.toLowerCase()),
);
const SENSITIVE_SNAKE = new Set(['access_token', 'refresh_token', 'api_key', 'user_id']);

const REDACTED = '[REDACTED]';

/**
 * Credential-shaped substrings scrubbed from otherwise-innocent fields.
 *
 * Key-name matching alone is not enough. During the "invalid API key"
 * investigation, tokens showed up in fields nobody expected — a model name
 * echoed back by a caller, an upstream error message, a redirect URL. Anything
 * persisted to disk or printed to logs must be scrubbed by *shape* as well as
 * by key name, because a leaked token in a field named `model` is still leaked.
 */
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  // Authorization header values embedded in a larger string.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/=]{8,}/gi, `$1 ${REDACTED}`],
  // OpenAI/Anthropic-style keys.
  [/\bsk-[A-Za-z0-9\-_]{8,}/g, REDACTED],
  [/\bsk-ant-[A-Za-z0-9\-_]{8,}/g, REDACTED],
  // JWTs (three base64url segments); WorkBuddy access tokens are this shape.
  [/\beyJ[A-Za-z0-9\-_]{4,}\.[A-Za-z0-9\-_]{4,}\.[A-Za-z0-9\-_]{4,}/g, REDACTED],
  // Long opaque hex blobs, but not ordinary words or short ids.
  [/\b[a-f0-9]{32,}\b/gi, REDACTED],
  // Credential-bearing query parameters.
  [/([?&](?:access_token|refresh_token|api_key|token|code)=)[^&\s"]+/gi, `$1${REDACTED}`],
];

/** Scrub credential-shaped substrings from a string value. */
export function scrubString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of VALUE_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[CYCLE]';
    seen.add(value);
    return value.map((v) => redact(v, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return '[CYCLE]';
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const lower = k.toLowerCase();
      out[k] =
        SENSITIVE_KEYS.has(lower) || SENSITIVE_SNAKE.has(k) ? REDACTED : redact(v, seen);
    }
    return out;
  }
  return value;
}
