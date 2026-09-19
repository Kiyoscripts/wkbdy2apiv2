import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Downstream API-key registry.
 *
 * The gateway previously accepted exactly one key: `WKB2API_API_KEY`, compared
 * on every request. That is a bootstrap credential, not a management surface —
 * issuing a key for a new client meant editing an environment variable and
 * redeploying, and revoking one meant rotating the key for every client at once.
 *
 * This adds a small registry alongside it. Design constraints that shaped it:
 *
 *  - **Keys are never stored.** Only a SHA-256 hash and a short prefix are kept.
 *    A leaked database backup or a `SELECT *` in a support session reveals no
 *    usable credential. The plaintext is returned exactly once, at creation.
 *  - **Verification is constant-time.** A hash lookup would otherwise leak
 *    timing information about how many leading bytes of a guess were correct.
 *  - **The env key keeps working.** `WKB2API_API_KEY` is still accepted and is
 *    always treated as an admin credential, so a misconfigured or empty store
 *    can never lock an operator out of the panel that manages the store.
 *
 * Revocation takes effect immediately: the registry is consulted per request and
 * carries no cache, so deleting a key stops it on the next call rather than
 * whenever a process happens to restart.
 */

export type ApiKeyRecord = {
  id: string;
  name: string;
  /** First characters of the key, for display. Not enough to reconstruct it. */
  prefix: string;
  /** Hex SHA-256 of the full key. */
  hash: string;
  created_at: string;
  /** ISO timestamp of the last authenticated request, or absent if never used. */
  last_used_at?: string;
  /** Requests seen since creation. Survives restarts when persisted. */
  request_count: number;
  /** Marks a key that may manage the panel. Implies nothing about /v1 access. */
  admin: boolean;
  /** Optional operator note. */
  note?: string;
};

/** A newly created key — the only time the secret is available. */
export type IssuedApiKey = {
  record: ApiKeyRecord;
  /** Full key value. Shown once and never retrievable again. */
  key: string;
};

/** Result of checking a presented key. */
export type ApiKeyVerification =
  | { ok: true; id: string; name: string; admin: boolean }
  | { ok: false };

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * Length is compared first (timingSafeEqual throws on unequal lengths), which is
 * safe here because every digest is a fixed 64 hex characters.
 */
function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Generate a key with a recognizable prefix.
 *
 * `wkb_` makes a key identifiable at a glance in a config file or a leaked log,
 * which is the difference between "rotate this" and "what is this string".
 */
export function generateApiKey(): string {
  return 'wkb_' + randomBytes(24).toString('base64url');
}

/** First characters kept for display: enough to identify, not to reconstruct. */
export function keyPrefix(key: string): string {
  return key.slice(0, 12);
}

export class ApiKeyRegistry {
  private records = new Map<string, ApiKeyRecord>();

  /**
   * @param envKey The bootstrap key from WKB2API_API_KEY, always valid and
   *   always admin. Held separately from the records so it can never be
   *   deleted through the panel and cannot be lost with the store.
   */
  constructor(private readonly envKey?: string) {}

  restore(records: ApiKeyRecord[]): void {
    this.records = new Map(records.map((record) => [record.id, record]));
  }

  list(): ApiKeyRecord[] {
    return [...this.records.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  size(): number {
    return this.records.size;
  }

  get(id: string): ApiKeyRecord | undefined {
    return this.records.get(id);
  }

  /**
   * Issue a key. Returns the plaintext exactly once; only the hash is retained.
   */
  create(input: { name: string; admin?: boolean; note?: string }): IssuedApiKey {
    const key = generateApiKey();
    const record: ApiKeyRecord = {
      id: randomBytes(8).toString('hex'),
      name: input.name,
      prefix: keyPrefix(key),
      hash: hashApiKey(key),
      created_at: new Date().toISOString(),
      request_count: 0,
      admin: input.admin ?? false,
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    this.records.set(record.id, record);
    return { record, key };
  }

  /**
   * Register a key whose value the caller already knows.
   *
   * Exists for two cases that cannot use `create`: seeding the bootstrap key
   * from configuration, and tests that need to authenticate with a fixed string
   * instead of whatever was randomly generated. The value is hashed immediately
   * and never retained, so this is no less safe than `create` — it just moves
   * who chooses the secret.
   */
  createWithValue(key: string, input: { name: string; admin?: boolean; note?: string }): ApiKeyRecord {
    const record: ApiKeyRecord = {
      id: randomBytes(8).toString('hex'),
      name: input.name,
      prefix: keyPrefix(key),
      hash: hashApiKey(key),
      created_at: new Date().toISOString(),
      request_count: 0,
      admin: input.admin ?? false,
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    this.records.set(record.id, record);
    return record;
  }

  /**
   * Revoke a key. Returns false when the id is unknown, so the caller can
   * answer 404 rather than claiming a deletion that did not happen.
   */
  remove(id: string): boolean {
    return this.records.delete(id);
  }

  /** Rename or re-flag an existing key. Returns undefined when unknown. */
  update(id: string, patch: { name?: string; admin?: boolean; note?: string }): ApiKeyRecord | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    if (patch.name !== undefined) record.name = patch.name;
    if (patch.admin !== undefined) record.admin = patch.admin;
    if (patch.note !== undefined) record.note = patch.note;
    return record;
  }

  /**
   * Check a presented key.
   *
   * Every stored key is compared, even after a match, so the work done does not
   * reveal whether a guess matched an early or late entry. The registry is small
   * by construction (operator-issued), so the linear scan is not a bottleneck.
   */
  verify(presented: string | undefined): ApiKeyVerification {
    if (!presented) return { ok: false };

    // The env key is checked first and independently of the store, so an
    // operator can always get into the panel even if the store is corrupt.
    if (this.envKey && safeEqualStrings(presented, this.envKey)) {
      return { ok: true, id: 'env', name: 'bootstrap key (WKB2API_API_KEY)', admin: true };
    }

    const digest = hashApiKey(presented);
    let match: ApiKeyRecord | undefined;
    for (const record of this.records.values()) {
      if (hashesEqual(record.hash, digest)) match = record;
    }
    return match ? { ok: true, id: match.id, name: match.name, admin: match.admin } : { ok: false };
  }

  /**
   * Record that a key was used. Called after a successful verification; the
   * caller persists the registry when it wants the counters to survive a
   * restart.
   */
  touch(id: string, now = Date.now()): void {
    const record = this.records.get(id);
    if (!record) return;
    record.last_used_at = new Date(now).toISOString();
    record.request_count += 1;
  }
}

/** Length-safe, constant-time string comparison. */
function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
