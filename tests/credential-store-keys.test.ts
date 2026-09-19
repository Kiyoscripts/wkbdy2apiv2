import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { CredentialStore } from '../src/workbuddy/credential-store.js';
import type { CredentialStoreSnapshot } from '../src/workbuddy/credential-store.js';

/**
 * Key resolution for the account store.
 *
 * The property that matters most is **cross-entry-point equivalence**: a key
 * supplied as base64 configuration must produce exactly the same encryption key
 * as the same bytes in a file. If it did not, switching a deployment from a
 * mounted secret to an environment variable would silently make every stored
 * account undecryptable — the failure would look like data loss, not a config
 * error.
 */

function snapshot(): CredentialStoreSnapshot {
  return {
    version: 1,
    strategy: 'round-robin',
    nextLabel: 2,
    accounts: [
      {
        label: 'a1',
        credential: { accessToken: 'token-value', userId: 'u1', domain: 'workbuddy.ai' },
      },
    ],
  };
}

describe('CredentialStore key resolution', () => {
  it('accepts a base64 key value and round-trips a snapshot', () => {
    const key = randomBytes(32);
    const store = CredentialStore.fromKeyValue('/tmp/ignored.enc', key.toString('base64'));
    const envelope = store.encrypt(snapshot());
    expect(store.decryptEnvelope(envelope)).toEqual(snapshot());
  });

  it('accepts a 32-character ASCII key passed as plain text', () => {
    // A raw 32-byte key only survives being carried as a string if every byte is
    // valid UTF-8 that encodes to one byte. Random binary is NOT such a value —
    // see the next test — which is why base64 is the documented form for a
    // value passed through configuration.
    const ascii = randomBytes(24).toString('hex').slice(0, 32);
    expect(Buffer.byteLength(ascii, 'utf8')).toBe(32);
    const store = CredentialStore.fromKeyValue('/tmp/ignored.enc', ascii);
    const envelope = store.encrypt(snapshot());
    expect(store.decryptEnvelope(envelope)).toEqual(snapshot());
  });

  it('documents that random binary cannot be passed as a string, only as base64', () => {
    // This is a real limitation, pinned so it is not mistaken for a bug later.
    // A random 32-byte key almost always contains bytes that are invalid UTF-8;
    // decoding it as a string and re-encoding changes its length, so it is
    // rejected instead of being silently used as a *different* key. Base64
    // exists precisely to avoid this.
    const raw = randomBytes(32);
    const asString = Buffer.from(raw.toString('binary'), 'binary').toString('utf8');
    expect(Buffer.byteLength(asString, 'utf8')).not.toBe(32);
    expect(() => CredentialStore.fromKeyValue('/tmp/ignored.enc', asString)).toThrow(/32 bytes/);

    // The base64 form of the very same key is accepted and is equivalent to the
    // bytes it encodes.
    const viaBase64 = CredentialStore.fromKeyValue('/tmp/ignored.enc', raw.toString('base64'));
    const envelope = viaBase64.encrypt(snapshot());
    expect(viaBase64.decryptEnvelope(envelope)).toEqual(snapshot());
  });

  it('produces the same key from base64 config as from an equivalent file', async () => {
    // This is the guarantee that lets a deployment move from a mounted key file
    // to an environment variable without re-encrypting anything.
    const key = randomBytes(32);
    const base64 = key.toString('base64');

    const fromConfig = CredentialStore.fromKeyValue('/tmp/ignored.enc', base64);

    const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'wkb-key-'));
    const keyFile = join(dir, 'account-store.key');
    await writeFile(keyFile, base64, 'utf8');
    try {
      const fromFile = await CredentialStore.fromKeyFile('/tmp/ignored.enc', keyFile);

      // The file-encrypted blob must decrypt with the config-supplied key.
      const envelope = fromFile.encrypt(snapshot());
      expect(fromConfig.decryptEnvelope(envelope)).toEqual(snapshot());
      // And the reverse direction, so the equivalence is symmetric.
      const reverse = fromConfig.encrypt(snapshot());
      expect(fromFile.decryptEnvelope(reverse)).toEqual(snapshot());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('records the key source so startup can warn about an unstable key', () => {
    CredentialStore.fromKeyValue('/tmp/ignored.enc', randomBytes(32).toString('base64'));
    expect(CredentialStore.lastKeySource).toBe('env');

    CredentialStore.withGeneratedKey('/tmp/ignored.enc');
    // A generated key is the dangerous one: it changes on every boot, so any
    // stored account becomes undecryptable.
    expect(CredentialStore.lastKeySource).toBe('generated');
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => CredentialStore.fromKeyValue('/tmp/ignored.enc', randomBytes(16).toString('base64'))).toThrow(
      /32 bytes/,
    );
    expect(() => CredentialStore.fromKeyValue('/tmp/ignored.enc', 'not-base64-at-all!!')).toThrow();
  });

  it('rejects an empty key value rather than generating one silently', () => {
    // An empty variable is a configuration mistake; treating it as "no key"
    // would be reasonable, but generating a throwaway key would hide it.
    expect(() => CredentialStore.fromKeyValue('/tmp/ignored.enc', '')).toThrow(/empty/i);
    expect(() => CredentialStore.fromKeyValue('/tmp/ignored.enc', '   ')).toThrow(/empty/i);
  });

  it('fails to decrypt a blob written with a different key', () => {
    const a = CredentialStore.fromKeyValue('/tmp/ignored.enc', randomBytes(32).toString('base64'));
    const b = CredentialStore.fromKeyValue('/tmp/ignored.enc', randomBytes(32).toString('base64'));
    const envelope = a.encrypt(snapshot());
    expect(() => b.decryptEnvelope(envelope)).toThrow(/decrypted|invalid/i);
  });
});
