import { CredentialError, stripBearer, type WorkBuddyCredential, type CredentialSource } from './auth.js';
import type { CredentialStore, CredentialStoreSnapshot } from './credential-store.js';

export type PoolStrategy = 'round-robin' | 'random';
export type PoolAccount = { label: string; credential: WorkBuddyCredential; note?: string };
type AccountState = {
  account: PoolAccount;
  failures: number;
  quarantinedUntil: number;
  reauthRequired: boolean;
  refresh?: Promise<WorkBuddyCredential>;
  /** Timestamps for the health surface; persisted state does not carry them. */
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastError?: string;
};
type Refresher = (credential: WorkBuddyCredential) => Promise<WorkBuddyCredential>;

/** Health of a single pooled account, as reported to the admin panel. */
export type AccountHealth = {
  label: string;
  note?: string;
  state: 'healthy' | 'cooling_down' | 'reauth_required';
  failures: number;
  last_error?: string;
  last_success_at?: number;
  last_failure_at?: number;
  quarantined_until?: number;
  cooldown_remaining_ms?: number;
};

/** Aggregate availability of the pool, used by /ready and the panel. */
export type PoolHealth = {
  size: number;
  available: number;
  unhealthy: number;
  /** True when at least one account can serve a request right now. */
  ready: boolean;
  state: 'empty' | 'ready' | 'degraded' | 'unavailable';
  strategy: PoolStrategy;
  accounts: AccountHealth[];
};

/** Sink for pool lifecycle events; wired to the durable telemetry file. */
export type PoolEventSink = (event: {
  event: 'added' | 'removed' | 'quarantined' | 'reauth_required' | 'restored' | 'strategy_changed';
  label?: string;
  detail?: string;
  pool_size?: number;
  strategy?: string;
}) => void;

export class CredentialPool {
  private states: AccountState[] = [];
  private cursor = 0;
  private nextLabel = 1;
  private refresher?: Refresher;
  strategy: PoolStrategy;
  private readonly cooldownMs: number;
  private readonly store?: CredentialStore;
  private events?: PoolEventSink;

  constructor(opts: { strategy?: PoolStrategy; cooldownMs?: number; store?: CredentialStore } = {}) {
    this.strategy = opts.strategy ?? 'round-robin';
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.store = opts.store;
  }

  /** Attach a lifecycle sink (durable telemetry). Safe to call before restore(). */
  setEventSink(sink: PoolEventSink): void {
    this.events = sink;
  }

  restore(snapshot: CredentialStoreSnapshot): void {
    this.strategy = snapshot.strategy;
    this.nextLabel = snapshot.nextLabel;
    this.cursor = 0;
    this.states = snapshot.accounts.map((account) => ({
      account: {
        ...account,
        credential: {
          ...account.credential,
          accessToken: stripBearer(account.credential.accessToken),
        },
      },
      failures: 0,
      quarantinedUntil: 0,
      reauthRequired: false,
    }));
    this.events?.({ event: 'restored', pool_size: this.states.length, strategy: this.strategy });
  }

  setRefresher(refresh: Refresher): void { this.refresher = refresh; }

  private snapshot(): CredentialStoreSnapshot {
    return {
      version: 1,
      strategy: this.strategy,
      nextLabel: this.nextLabel,
      accounts: this.states.map(({ account }) => ({
        label: account.label,
        ...(account.note !== undefined ? { note: account.note } : {}),
        credential: { ...account.credential },
      })),
    };
  }

  private async persist(): Promise<void> {
    if (this.store) await this.store.save(this.snapshot());
  }

  /**
   * Current state in the shape the account store persists.
   *
   * Exposed so a caller can route persistence through a storage abstraction
   * instead of handing the pool a concrete file store. The pool keeps its own
   * `store` path for the file backend's synchronous call sites; when neither is
   * wired the pool simply lives in memory.
   */
  snapshotForStorage(): CredentialStoreSnapshot {
    return this.snapshot();
  }

  async add(credential: WorkBuddyCredential, note?: string): Promise<PoolAccount> {
    const before = this.snapshot();
    const normalized = { ...credential, accessToken: stripBearer(credential.accessToken) };
    const existing = this.states.find((s) => s.account.credential.domain === normalized.domain && s.account.credential.userId === normalized.userId);
    let account: PoolAccount;
    if (existing) {
      existing.account.credential = normalized;
      if (note !== undefined) existing.account.note = note;
      existing.failures = 0;
      existing.quarantinedUntil = 0;
      existing.reauthRequired = false;
      account = existing.account;
    } else {
      account = { label: `#${this.nextLabel++}`, credential: normalized, note };
      this.states.push({ account, failures: 0, quarantinedUntil: 0, reauthRequired: false });
    }
    try {
      await this.persist();
      this.events?.({ event: 'added', label: account.label, detail: existing ? 'refreshed existing account' : 'new account', pool_size: this.states.length });
      return account;
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }

  async remove(label: string): Promise<boolean> {
    const index = this.states.findIndex((s) => s.account.label === label);
    if (index < 0) return false;
    const before = this.snapshot();
    this.states.splice(index, 1);
    if (this.cursor > index) this.cursor--;
    if (this.cursor >= this.states.length) this.cursor = 0;
    try {
      await this.persist();
      this.events?.({ event: 'removed', label, pool_size: this.states.length });
      return true;
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }

  list() {
    const now = Date.now();
    return this.states.map((s) => ({
      label: s.account.label, note: s.account.note,
      ok: !s.reauthRequired && s.quarantinedUntil <= now,
      detail: s.reauthRequired ? 'Web login required' : s.account.credential.oauthOrigin ? 'Web login · held in service memory only' : 'Imported credential',
      reauth_required: s.reauthRequired,
      ...(s.quarantinedUntil > now ? { quarantined_until: s.quarantinedUntil } : {}),
    }));
  }

  /**
   * Account-pool health for the admin panel and the /ready probe.
   *
   * Without this the pool is a black box: an operator can see that requests
   * fail but not which account is cooling down, why, or when it comes back.
   * Only labels and timestamps are exposed — never credential values.
   */
  health(): PoolHealth {
    const now = Date.now();
    const accounts: AccountHealth[] = this.states.map((s) => {
      const quarantinedUntil = s.quarantinedUntil;
      const state: AccountHealth['state'] = s.reauthRequired
        ? 'reauth_required'
        : quarantinedUntil > now
          ? 'cooling_down'
          : 'healthy';
      return {
        label: s.account.label,
        ...(s.account.note !== undefined ? { note: s.account.note } : {}),
        state,
        failures: s.failures,
        ...(s.lastError !== undefined ? { last_error: s.lastError } : {}),
        ...(s.lastSuccessAt !== undefined ? { last_success_at: s.lastSuccessAt } : {}),
        ...(s.lastFailureAt !== undefined ? { last_failure_at: s.lastFailureAt } : {}),
        ...(state === 'cooling_down' ? { quarantined_until: quarantinedUntil, cooldown_remaining_ms: quarantinedUntil - now } : {}),
      };
    });
    const available = accounts.filter((a) => a.state === 'healthy').length;
    const unhealthy = accounts.length - available;
    return {
      size: this.states.length,
      available,
      unhealthy,
      ready: available > 0,
      state: this.states.length === 0 ? 'empty' : available === 0 ? 'unavailable' : unhealthy > 0 ? 'degraded' : 'ready',
      strategy: this.strategy,
      accounts,
    };
  }

  /** Note that a credential worked, clearing any accumulated failure state. */
  reportSuccess(token: string): void {
    const s = this.states.find((x) => x.account.credential.accessToken === token);
    if (!s) return;
    s.lastSuccessAt = Date.now();
    s.lastError = undefined;
    if (s.failures > 0 || s.quarantinedUntil > 0) {
      s.failures = 0;
      s.quarantinedUntil = 0;
      // Recovery is worth recording: it marks the end of an incident window.
      this.events?.({ event: 'restored', label: s.account.label, detail: 'credential succeeded again', pool_size: this.states.length });
    }
  }

  /** Mark one account as needing a fresh interactive login. */
  markReauthRequired(label: string, detail?: string): void {
    const s = this.states.find((x) => x.account.label === label);
    if (!s) return;
    s.reauthRequired = true;
    s.lastFailureAt = Date.now();
    if (detail) s.lastError = detail.slice(0, 200);
    this.events?.({ event: 'reauth_required', label, ...(detail ? { detail: detail.slice(0, 200) } : {}), pool_size: this.states.length });
  }

  get size(): number { return this.states.length; }
  get strategyName(): PoolStrategy { return this.strategy; }

  async setStrategy(strategy: PoolStrategy): Promise<void> {
    const previous = this.strategy;
    this.strategy = strategy;
    try {
      await this.persist();
      this.events?.({ event: 'strategy_changed', strategy, pool_size: this.states.length });
    } catch (error) {
      this.strategy = previous;
      throw error;
    }
  }

  reportFailure(token: string, detail?: string): void {
    const s = this.states.find((x) => x.account.credential.accessToken === token);
    if (!s) return;
    s.failures++;
    s.lastFailureAt = Date.now();
    if (detail) s.lastError = detail.slice(0, 200);
    const cooldown = Math.min(this.cooldownMs * 2 ** Math.min(s.failures - 1, 10), 30 * 60_000);
    s.quarantinedUntil = Date.now() + cooldown;
    this.events?.({ event: 'quarantined', label: s.account.label, detail: `attempt ${s.failures}, cooldown ${Math.round(cooldown / 1000)}s${detail ? `: ${detail.slice(0, 120)}` : ''}`, pool_size: this.states.length });
  }

  async getCredential(): Promise<WorkBuddyCredential> {
    if (!this.states.length) throw new CredentialError('No accounts configured; sign in through the admin panel.');
    const now = Date.now();
    const available = this.states.filter((s) => !s.reauthRequired && s.quarantinedUntil <= now);
    if (!available.length) throw new CredentialError('No available account; wait for cooldown or sign in again.');
    let picked: AccountState;
    if (this.strategy === 'random') picked = available[Math.floor(Math.random() * available.length)]!;
    else {
      const first = this.cursor;
      picked = available[0]!;
      for (let i = 0; i < this.states.length; i++) {
        const index = (first + i) % this.states.length;
        const s = this.states[index]!;
        if (!s.reauthRequired && s.quarantinedUntil <= now) {
          picked = s;
          this.cursor = (index + 1) % this.states.length;
          break;
        }
      }
    }
    const credential = picked.account.credential;
    if (credential.expiresAt !== undefined && credential.expiresAt <= now + 60_000) return this.refreshAccount(picked);
    return credential;
  }

  async refreshRejectedCredential(credential: WorkBuddyCredential): Promise<WorkBuddyCredential> {
    const state = this.states.find((s) => s.account.credential.accessToken === credential.accessToken);
    if (!state) throw new CredentialError('Account changed or was removed; retry with the current session.');
    return this.refreshAccount(state);
  }

  private async refreshAccount(state: AccountState): Promise<WorkBuddyCredential> {
    if (state.refresh) return state.refresh;
    const before = state.account.credential;
    if (!before.refreshToken || !this.refresher) {
      state.reauthRequired = true;
      throw new CredentialError('Account needs a new web login.');
    }
    const refresh = this.refresher;
    state.refresh = (async () => {
      try {
        const credential = await refresh(before);
        if (!this.states.includes(state)) throw new CredentialError('Account was removed while refreshing.');
        if (state.account.credential !== before) return state.account.credential;
        if (credential.userId !== before.userId || credential.domain !== before.domain) throw new CredentialError('Account identity changed during refresh.');
        state.account.credential = credential;
        try {
          await this.persist();
          return credential;
        } catch (error) {
          if (this.states.includes(state) && state.account.credential === credential) {
            state.account.credential = before;
          }
          throw error;
        }
      } catch (err) {
        if (this.states.includes(state) && state.account.credential === before) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 401 || code === 403 || err instanceof CredentialError) state.reauthRequired = true;
          else this.reportFailure(before.accessToken);
        }
        throw new CredentialError('Account refresh failed; retry later or sign in again.');
      } finally { state.refresh = undefined; }
    })();
    return state.refresh;
  }

  invalidate(): void {}
  describe(): string {
    return `account pool (${this.states.length} accounts)`;
  }
}

export type { WorkBuddyCredential, CredentialSource };
