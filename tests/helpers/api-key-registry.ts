import { ApiKeyRegistry } from '../../src/security/api-keys.js';

/**
 * Build a registry holding one key whose value the test already knows.
 *
 * The gateway previously compared against a single `apiKey` string; that is now
 * one entry in a registry. Tests that passed `apiKey: KEY` and then sent
 * `Authorization: Bearer KEY` get identical behaviour by registering KEY here.
 *
 * Defaults to an admin key so panel tests keep working: a non-admin key can
 * read the panel but not mutate it, which is deliberate and tested separately.
 */
export function registryWith(key: string, opts: { admin?: boolean; name?: string } = {}): ApiKeyRegistry {
  const registry = new ApiKeyRegistry(undefined);
  registry.createWithValue(key, { name: opts.name ?? 'test-key', admin: opts.admin ?? true });
  return registry;
}
