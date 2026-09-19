import { describe, expect, it, beforeEach } from 'vitest';
import { ApiKeyRegistry, generateApiKey, hashApiKey, keyPrefix } from '../src/security/api-keys.js';

/**
 * API-key registry tests.
 *
 * The properties worth locking down are the security ones — a key must never be
 * recoverable from stored state, and revocation must be immediate — plus the
 * lockout case: an operator who deletes the wrong key must still be able to get
 * back into the panel.
 */

describe('ApiKeyRegistry', () => {
  let registry: ApiKeyRegistry;

  beforeEach(() => {
    registry = new ApiKeyRegistry('bootstrap-env-key-0123456789');
  });

  it('accepts the env bootstrap key even with no records', () => {
    const result = registry.verify('bootstrap-env-key-0123456789');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.admin).toBe(true);
      expect(result.id).toBe('env');
    }
  });

  it('rejects an unknown key', () => {
    expect(registry.verify('not-a-real-key').ok).toBe(false);
    expect(registry.verify(undefined).ok).toBe(false);
    expect(registry.verify('').ok).toBe(false);
  });

  it('issues a key that verifies, and never stores the plaintext', () => {
    const issued = registry.create({ name: 'laptop' });
    // The plaintext is available exactly once, at creation.
    expect(issued.key).toMatch(/^wkb_/);
    const verification = registry.verify(issued.key);
    expect(verification.ok).toBe(true);
    if (verification.ok) expect(verification.name).toBe('laptop');

    // Nothing retained anywhere in the registry contains the secret. This is the
    // property that makes a database backup or a support SELECT harmless.
    const serialized = JSON.stringify(registry.list());
    expect(serialized).not.toContain(issued.key);
    expect(serialized).not.toContain(issued.key.slice(4));
    expect(registry.get(issued.record.id)?.hash).toBe(hashApiKey(issued.key));
    // Only the short display prefix is kept in the clear.
    expect(registry.get(issued.record.id)?.prefix).toBe(keyPrefix(issued.key));
  });

  it('revokes immediately, with no cache to expire', () => {
    const issued = registry.create({ name: 'temp' });
    expect(registry.verify(issued.key).ok).toBe(true);
    expect(registry.remove(issued.record.id)).toBe(true);
    expect(registry.verify(issued.key).ok).toBe(false);
  });

  it('reports a failed revocation rather than claiming success', () => {
    expect(registry.remove('no-such-id')).toBe(false);
  });

  it('does not let a non-admin key manage the gateway', () => {
    const issued = registry.create({ name: 'client', admin: false });
    const result = registry.verify(issued.key);
    expect(result.ok).toBe(true);
    // Authenticates, but is not flagged admin — the panel checks this flag
    // before allowing mutations.
    if (result.ok) expect(result.admin).toBe(false);
  });

  it('can grant and revoke admin on an existing key', () => {
    const issued = registry.create({ name: 'teammate', admin: false });
    expect(registry.update(issued.record.id, { admin: true })?.admin).toBe(true);
    const result = registry.verify(issued.key);
    if (result.ok) expect(result.admin).toBe(true);
    expect(registry.update('missing', { admin: true })).toBeUndefined();
  });

  it('counts uses so the panel can show which keys are live', () => {
    const issued = registry.create({ name: 'active' });
    expect(registry.get(issued.record.id)?.request_count).toBe(0);
    expect(registry.get(issued.record.id)?.last_used_at).toBeUndefined();

    const now = Date.parse('2026-09-19T10:00:00.000Z');
    registry.touch(issued.record.id, now);
    registry.touch(issued.record.id, now + 1000);

    const record = registry.get(issued.record.id);
    expect(record?.request_count).toBe(2);
    expect(record?.last_used_at).toBe(new Date(now + 1000).toISOString());
  });

  it('ignores touch calls for unknown ids instead of creating entries', () => {
    registry.touch('does-not-exist');
    expect(registry.size()).toBe(0);
  });

  it('survives a restore round trip through serialized records', () => {
    const first = registry.create({ name: 'persisted', admin: true, note: 'from a test' });
    const serialized = JSON.parse(JSON.stringify(registry.list()));

    const reloaded = new ApiKeyRegistry('bootstrap-env-key-0123456789');
    reloaded.restore(serialized);

    // A key issued before a restart still authenticates after one. This is the
    // property that makes the store worth persisting at all.
    expect(reloaded.verify(first.key).ok).toBe(true);
    expect(reloaded.get(first.record.id)?.note).toBe('from a test');
    expect(reloaded.get(first.record.id)?.admin).toBe(true);
  });

  it('keeps issued keys distinct', () => {
    const a = registry.create({ name: 'a' });
    const b = registry.create({ name: 'b' });
    expect(a.key).not.toBe(b.key);
    expect(a.record.id).not.toBe(b.record.id);
    expect(registry.verify(a.key).ok).toBe(true);
    expect(registry.verify(b.key).ok).toBe(true);
  });

  it('does not confuse similar keys', () => {
    const issued = registry.create({ name: 'original' });
    // One character different must fail: this is what the constant-time
    // comparison is protecting.
    const tampered = issued.key.slice(0, -1) + (issued.key.endsWith('a') ? 'b' : 'a');
    expect(registry.verify(tampered).ok).toBe(false);
  });

  it('distinguishes a key whose prefix matches but body does not', () => {
    const issued = registry.create({ name: 'target' });
    const samePrefix = issued.key.slice(0, 12) + 'XXXXXXXXXXXXXXXXXXXXXXXX';
    expect(samePrefix.slice(0, 12)).toBe(keyPrefix(issued.key));
    expect(registry.verify(samePrefix).ok).toBe(false);
  });

  it('lists keys oldest first so the table order is stable', () => {
    const a = registry.create({ name: 'first' });
    const b = registry.create({ name: 'second' });
    const listed = registry.list().map((k) => k.id);
    expect(listed.indexOf(a.record.id)).toBeLessThan(listed.indexOf(b.record.id));
  });

  it('generates keys with enough entropy to be unguessable', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey()));
    expect(keys.size).toBe(200);
    for (const key of keys) {
      // 24 random bytes base64url-encoded is 32 characters; with the prefix that
      // is well beyond brute-force range.
      expect(key.length).toBeGreaterThanOrEqual(30);
    }
  });
});
