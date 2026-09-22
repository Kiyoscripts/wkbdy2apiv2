import { describe, expect, it } from 'vitest';
import { extractApiKey, isApiKeyValid, keyFingerprint, keyFingerprintFromHash, maskedKeyPrefix } from '../src/security/downstream-auth.js';
import { hashApiKey, keyPrefix } from '../src/security/api-keys.js';

describe('downstream API-key normalization', () => {
  it.each([
    [{ authorization: 'Bearer secret-value' }, 'secret-value', ['authorization']],
    [{ authorization: 'bearer   secret-value  ' }, 'secret-value', ['authorization']],
    [{ 'x-api-key': '  secret-value  ' }, 'secret-value', ['x-api-key']],
    [{ 'api-key': 'secret-value' }, 'secret-value', ['api-key']],
  ] as const)('extracts supported header variants', (headers, value, sources) => {
    expect(extractApiKey(headers)).toEqual({ value, conflicting: false, sources });
  });

  it('allows matching duplicate credentials and rejects different ones', () => {
    expect(extractApiKey({ authorization: 'Bearer same', 'x-api-key': 'same' })).toEqual({
      value: 'same', conflicting: false, sources: ['authorization', 'x-api-key'],
    });
    expect(extractApiKey({ authorization: 'Bearer first', 'x-api-key': 'second' }).conflicting).toBe(true);
  });

  it('does not treat Basic or malformed authorization as an API key', () => {
    expect(extractApiKey({ authorization: 'Basic abc' })).toEqual({ value: undefined, conflicting: false, sources: [] });
    expect(extractApiKey({ authorization: 'Bearer   ' })).toEqual({ value: undefined, conflicting: false, sources: [] });
  });

  it('checks normalized values without accepting prefixes or suffixes', () => {
    expect(isApiKeyValid('correct-key', 'correct-key')).toBe(true);
    expect(isApiKeyValid('correct-key ', 'correct-key')).toBe(false);
    expect(isApiKeyValid('Bearer correct-key', 'correct-key')).toBe(false);
  });
});

/**
 * The usage join depends on the fingerprint being derivable from a stored hash.
 * If these two ever diverge, per-key usage silently reports null for every key,
 * which looks exactly like "no traffic".
 */
describe('keyFingerprintFromHash', () => {
  it('matches the fingerprint computed from the key itself', () => {
    for (const key of ['wkb_live_abc123', 'client-key-0123456789abcdef', 'x'.repeat(60)]) {
      expect(keyFingerprintFromHash(hashApiKey(key))).toBe(keyFingerprint(key));
    }
  });

  it('returns undefined for a missing hash', () => {
    expect(keyFingerprintFromHash(undefined)).toBeUndefined();
    expect(keyFingerprintFromHash('')).toBeUndefined();
  });

  it('never returns the hash itself', () => {
    const hash = hashApiKey('wkb_live_abc123');
    const fp = keyFingerprintFromHash(hash)!;
    expect(fp).not.toBe(hash);
    expect(hash.startsWith(fp.replace('key_', ''))).toBe(true);
    // Only the 16-character prefix is exposed, matching keyFingerprint.
    expect(fp).toHaveLength('key_'.length + 16);
  });
});

/**
 * A rejected key is absent from the registry, so it has no name to report and
 * the operator has nothing to match against the key list. The fragment exists
 * for that, and must never become the secret itself.
 */
describe('maskedKeyPrefix', () => {
  it('returns nothing for anything shorter than a real key', () => {
    // A 9-character key would be disclosed entirely by a naive 12-char prefix.
    for (const key of ['wrong-key', 'short', 'a'.repeat(23)]) {
      expect(maskedKeyPrefix(key)).toBeUndefined();
    }
    expect(maskedKeyPrefix(undefined)).toBeUndefined();
    expect(maskedKeyPrefix('')).toBeUndefined();
  });

  it('never returns the whole key, even at the boundary', () => {
    // 24 is the shortest maskable value; 8 characters must still be a fragment.
    const shortest = 'a'.repeat(24);
    expect(maskedKeyPrefix(shortest)).toBe('a'.repeat(8));
    expect(maskedKeyPrefix(shortest)).not.toBe(shortest);
  });

  it('returns a comparable fragment for a real issued key', () => {
    const key = 'wkb_K41B4UvjgyUTm54BPUssffAY20NloGne';
    expect(maskedKeyPrefix(key)).toBe('wkb_K41B');
    // The panel identifies stored keys by their first 12 characters, so the
    // fragment has to be a prefix of that to be matchable by eye.
    expect(keyPrefix(key).startsWith(maskedKeyPrefix(key)!)).toBe(true);
  });
});
