import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { WorkBuddyCredential } from './auth.js';
import type { PoolStrategy } from './credential-pool.js';

const credentialSchema = z.object({
  accessToken: z.string().min(1),
  userId: z.string().min(1),
  domain: z.string().min(1),
  oauthOrigin: z.string().url().optional(),
  tokenType: z.literal('Bearer').optional(),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.number().positive().optional(),
  refreshExpiresAt: z.number().positive().optional(),
}).strict();

const snapshotSchema = z.object({
  version: z.literal(1),
  strategy: z.enum(['round-robin', 'random']),
  nextLabel: z.number().int().positive(),
  accounts: z.array(z.object({
    label: z.string().min(1),
    note: z.string().optional(),
    credential: credentialSchema,
  }).strict()),
}).strict();

const envelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('aes-256-gcm'),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  tag: z.string().min(1),
}).strict();

export type CredentialStoreSnapshot = {
  version: 1;
  strategy: PoolStrategy;
  nextLabel: number;
  accounts: Array<{ label: string; note?: string; credential: WorkBuddyCredential }>;
};

export class CredentialStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CredentialStoreError';
  }
}

export class CredentialStore {
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly key: Buffer,
  ) {}

  /**
   * Whether the encryption key came from a file the operator mounted, or from
   * one the process materialized itself (for example from
   * WKB2API_ACCOUNT_STORE_KEY_B64 on an ephemeral filesystem).
   *
   * This matters because a self-managed key is regenerated on every boot: the
   * encrypted store survives a restart but cannot be decrypted, so every
   * account silently disappears. Surfacing it lets startup say so instead of
   * leaving an operator to discover an empty pool later.
   */
  static lastKeySource: 'file' | 'generated' | 'env' = 'file';

  static async fromKeyFile(path: string, keyFile: string): Promise<CredentialStore> {
    let raw: Buffer;
    try {
      raw = await readFile(keyFile);
      CredentialStore.lastKeySource = 'file';
    } catch (cause) {
      throw new CredentialStoreError('Cannot read the account-store encryption key file.', { cause });
    }
    return new CredentialStore(path, CredentialStore.parseKey(raw));
  }

  /**
   * Build a store from a key supplied as configuration rather than a file.
   *
   * This exists for hosts with no persistent disk to mount a key file from
   * (Render, Heroku, and similar): the key arrives as an environment variable
   * and the encrypted state lives in a database. The variable keeps its `_B64`
   * name because base64 is the form that survives an environment variable
   * intact — raw 32 random bytes usually contain NUL or invalid UTF-8 and would
   * be corrupted in transit.
   *
   * Unlike `withGeneratedKey` this key is stable across restarts, so accounts
   * encrypted with it remain readable. Only the storage location changed; the
   * crypto is identical to the file path.
   */
  static fromKeyValue(path: string, value: string): CredentialStore {
    const trimmed = value.trim();
    if (!trimmed) throw new CredentialStoreError('The account-store encryption key value is empty.');
    CredentialStore.lastKeySource = 'env';
    return new CredentialStore(path, CredentialStore.parseKey(Buffer.from(trimmed, 'utf8')));
  }

  /**
   * Accept either 32 raw bytes or a base64 encoding of them.
   *
   * Shared by both entry points so a base64 key behaves identically whether it
   * came from a file or an environment variable — otherwise moving a key
   * between the two would silently produce a different encryption key.
   */
  private static parseKey(raw: Buffer): Buffer {
    if (raw.length === 32) return raw;
    const trimmed = raw.toString('utf8').trim();
    let key: Buffer;
    try {
      key = Buffer.from(trimmed, 'base64');
    } catch (cause) {
      throw new CredentialStoreError('The account-store encryption key is invalid.', { cause });
    }
    if (key.length !== 32) {
      throw new CredentialStoreError(
        'The account-store encryption key must be exactly 32 bytes, given as raw bytes or base64.',
      );
    }
    return key;
  }

  /**
   * Build a store with a freshly generated key, for environments with no
   * persistent disk at all. Accounts added in this mode are readable only until
   * the process exits; the gateway reports that on /ready so it is a documented
   * tradeoff rather than a surprise.
   */
  static withGeneratedKey(path: string): CredentialStore {
    CredentialStore.lastKeySource = 'generated';
    return new CredentialStore(path, randomBytes(32));
  }

  async load(): Promise<CredentialStoreSnapshot | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new CredentialStoreError('Cannot read the encrypted account store.', { cause });
    }
    return this.decryptEnvelope(raw);
  }

  /**
   * Encrypt a snapshot into the same envelope format the file backend writes.
   *
   * Exposed so the Postgres backend can store the identical ciphertext in a
   * column instead of a file. Using one implementation for both means a
   * deployment can move between backends without re-encrypting, and there is
   * only one crypto path to review.
   */
  encrypt(snapshot: CredentialStoreSnapshot): string {
    const validated = snapshotSchema.parse(snapshot);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(validated), 'utf8'),
      cipher.final(),
    ]);
    return JSON.stringify({
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    });
  }

  /**
   * Decrypt an envelope produced by `encrypt`. Throws on tampering or on a key
   * mismatch, because both mean the stored state is unusable and silently
   * returning an empty pool would hide that.
   */
  decryptEnvelope(raw: string): CredentialStoreSnapshot {
    try {
      const envelope = envelopeSchema.parse(JSON.parse(raw));
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]);
      return snapshotSchema.parse(JSON.parse(plaintext.toString('utf8')));
    } catch (cause) {
      throw new CredentialStoreError('The encrypted account store is invalid or cannot be decrypted.', { cause });
    }
  }

  async save(snapshot: CredentialStoreSnapshot): Promise<void> {
    const envelope = this.encrypt(snapshot);
    const operation = this.writeQueue.then(() => this.write(envelope));
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  private async write(envelope: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(envelope + '\n', 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.path);
    } catch (cause) {
      await rm(temporary, { force: true }).catch(() => {});
      throw new CredentialStoreError('Cannot persist the encrypted account store.', { cause });
    }
  }
}
