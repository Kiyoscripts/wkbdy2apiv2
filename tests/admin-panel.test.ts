import { Window, type HTMLInputElement, type HTMLButtonElement, type HTMLElement } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminPanelHtml } from '../src/routes/admin-html.js';
import { createMetrics } from '../src/observability/metrics.js';

const windows: Window[] = [];
afterEach(async () => { await Promise.all(windows.splice(0).map((w) => w.happyDOM.close())); });
const overview = {
  version: 'test', credential: { ok: false, source: 'not configured', detail: '' },
  upstream: { url: 'https://www.workbuddy.ai/v2/chat/completions', user_agent: 'WorkBuddy/2.137.1' },
  models: [], pool: { size: 0, strategy: 'round-robin', accounts: [] },
  stats: { uptime_ms: 0, total_requests: 0, total_errors: 0, error_rate: 0, p95_ms: null, per_model: [], tokens: { prompt: 0, completion: 0 } },
};

async function panel(popupBlocked = false) {
  const w = new Window({ url: 'http://127.0.0.1:8787/admin' });
  windows.push(w);
  let completed = false;
  const fetchFn = vi.fn(async (path: string, init?: RequestInit) => {
    let body: unknown;
    if (path.endsWith('/oauth/start')) body = { id: 'test-transaction', authorization_url: 'https://www.workbuddy.ai/login?state=secret-in-memory', status: 'pending' };
    else if (path.endsWith('/status')) { completed = true; body = { id: 'test-transaction', status: 'completed', account_label: '#1' }; }
    else if (path.endsWith('/overview')) body = { ...overview, pool: completed ? { size: 1, strategy: 'round-robin', accounts: [{ label: '#1', note: 'Account', ok: true, detail: 'Web login' }] } : overview.pool };
    else throw new Error('unexpected local request');
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  w.fetch = fetchFn as never;
  const popup = { opener: null, closed: false, document: new Window().document, location: { replace: vi.fn() }, close: vi.fn() };
  w.open = vi.fn(() => popupBlocked ? null : popup) as never;
  w.document.write(adminPanelHtml());
  const script = w.document.querySelector('script')!.textContent!;
  // Script tags are inert in this test; evaluate only the page's own trusted code.
  w.eval(script);
  const input = w.document.querySelector('#key-input') as unknown as HTMLInputElement;
  input.value = 'test-only-admin-key';
  (w.document.querySelector('#key-submit') as unknown as HTMLButtonElement).click();
  await vi.waitFor(() => expect(w.document.querySelector('#main h2')?.textContent).toBe('Overview'));
  (w.document.querySelector('[data-view="upstream"]') as unknown as HTMLButtonElement).click();
  return { w, fetchFn, popup };
}

describe('embedded OAuth panel interactions', () => {
  it('unlocks without reload, opens OAuth, and updates only account rows on completion', async () => {
    const { w, fetchFn, popup } = await panel();
    const section = w.document.querySelector('#main .section');
    const note = w.document.querySelector('#oauth-note') as unknown as HTMLInputElement;
    note.value = 'keep my note'; note.focus();
    (w.document.querySelector('#oauth-start') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalledWith('https://www.workbuddy.ai/login?state=secret-in-memory'));
    await vi.waitFor(() => expect(w.document.querySelector('#oauth-status')?.textContent).toContain('Signed in'), { timeout: 3000 });
    await vi.waitFor(() => expect(w.document.querySelector('#acct-rows')?.textContent).toContain('#1'));
    expect(w.document.querySelector('#main .section')).toBe(section);
    expect(w.document.querySelector('#oauth-note')).toBe(note);
    expect(note.value).toBe('keep my note');
    expect(w.localStorage.length).toBe(1);
    expect(w.localStorage.getItem('wkb2api-admin-key')).toBe('test-only-admin-key');
    expect(fetchFn.mock.calls.filter(([p]) => p.endsWith('/oauth/start'))).toHaveLength(1);
  });

  it('offers a safe explicit link if the browser blocks the new tab', async () => {
    const { w } = await panel(true);
    (w.document.querySelector('#oauth-start') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(w.document.querySelector('#oauth-link')?.hasAttribute('hidden')).toBe(false));
    expect(w.document.querySelector('#oauth-link')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(w.document.querySelector('#oauth-status')?.textContent).toContain('link below');
  });
});

/**
 * The keys page is the one screen that both creates and destroys credentials,
 * so its two failure modes matter: a lost key (spend time reissuing) and an
 * accidental revoke (every client starts 401ing). These lock in the behaviours
 * that guard each.
 */
async function keysPanel() {
  const w = new Window({ url: 'http://127.0.0.1:8787/admin' });
  windows.push(w);
  const created: Array<Record<string, unknown>> = [];
  const fetches: string[] = [];
  const api = async (path: string, init?: RequestInit) => {
    fetches.push((init?.method ?? 'GET') + ' ' + path);
    let body: unknown;
    if (path.endsWith('/keys') && (init?.method ?? 'GET') === 'GET') {
      body = { keys: [...created], bootstrap_key: { name: 'WKB2API_API_KEY', note: 'Environment key' } };
    } else if (path.endsWith('/keys') && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body)) as { name: string; note?: string; admin?: boolean };
      const record = {
        id: 'key-1', name: payload.name, note: payload.note ?? '', admin: payload.admin ?? false,
        prefix: 'wkb_live_9f2a', request_count: 0, last_used_at: null, created_at: Date.now(),
      };
      created.push(record);
      body = { id: 'key-1', key: 'wkb_live_9f2a1b2c3d4e5f60', warning: 'This is the only time it is shown.' };
    } else if (init?.method === 'DELETE') {
      created.length = 0;
      body = { ok: true };
    } else if (path.endsWith('/overview')) {
      // The panel gates its first render on this resolving, so it has to answer.
      body = { ...overview };
    } else {
      throw new Error('unexpected local request: ' + path);
    }
    return { ok: true, status: 200, json: async () => body } as Response;
  };
  w.fetch = api as never;
  // happy-dom does not type `confirm` on Window, though it implements it.
  const confirmSpy = vi.fn((_message?: string) => true);
  (w as unknown as { confirm: unknown }).confirm = confirmSpy;
  w.document.write(adminPanelHtml());
  w.eval(w.document.querySelector('script')!.textContent!);
  (w.document.querySelector('#key-input') as unknown as HTMLInputElement).value = 'test-only-admin-key';
  (w.document.querySelector('#key-submit') as unknown as HTMLButtonElement).click();
  await vi.waitFor(() => expect(w.document.querySelector('#main h2')?.textContent).toBe('Overview'));
  (w.document.querySelector('[data-view="keys"]') as unknown as HTMLButtonElement).click();
  await vi.waitFor(() => expect(w.document.querySelector('#key-new')).toBeTruthy());
  return { w, fetches, confirm: confirmSpy };
}

const q = (w: Window, sel: string) => w.document.querySelector(sel) as unknown as HTMLButtonElement;
const setInput = (w: Window, sel: string, value: string) => {
  const el = w.document.querySelector(sel) as unknown as HTMLInputElement;
  el.value = value;
  return el;
};

describe('API keys panel', () => {
  it('keeps the create form collapsed until asked for', async () => {
    const { w } = await keysPanel();
    const panelEl = w.document.querySelector('#key-create-panel') as unknown as HTMLElement;
    // Collapsed by default: arriving here is usually about checking or revoking.
    expect(panelEl.hasAttribute('hidden')).toBe(true);
    expect(q(w, '#key-new').getAttribute('aria-expanded')).toBe('false');

    q(w, '#key-new').click();
    expect(panelEl.hasAttribute('hidden')).toBe(false);
    expect(q(w, '#key-new').getAttribute('aria-expanded')).toBe('true');

    q(w, '#key-cancel').click();
    expect(panelEl.hasAttribute('hidden')).toBe(true);
    expect(q(w, '#key-new').getAttribute('aria-expanded')).toBe('false');
  });

  it('reveals a new key once, then collapses the form', async () => {
    const { w, fetches } = await keysPanel();
    q(w, '#key-new').click();
    setInput(w, '#key-name', 'laptop');
    setInput(w, '#key-note', 'primary machine');
    q(w, '#key-create').click();

    await vi.waitFor(() => expect(w.document.querySelector('.reveal')).toBeTruthy());
    expect(w.document.querySelector('.reveal')?.textContent).toContain('wkb_live_9f2a1b2c3d4e5f60');
    expect(w.document.querySelector('#key-create-panel')?.hasAttribute('hidden')).toBe(true);
    // Only the create call, no accidental duplicate POST from a stale handler.
    expect(fetches.filter((f) => f === 'POST /admin/api/keys')).toHaveLength(1);

    const body = w.document.querySelector('#key-body')?.textContent ?? '';
    expect(body).toContain('laptop');
    expect(body).toContain('primary machine');
    expect(body).toContain('wkb_live_9f2a');
    // The env key is listed but never offered a revoke control.
    expect(body).toContain('WKB2API_API_KEY');
  });

  it('names the key in the revoke confirmation before deleting', async () => {
    const { w, confirm, fetches } = await keysPanel();
    q(w, '#key-new').click();
    setInput(w, '#key-name', 'ci-runner');
    q(w, '#key-create').click();
    await vi.waitFor(() => expect(w.document.querySelector('[data-revoke]')).toBeTruthy());

    q(w, '[data-revoke]').click();
    await vi.waitFor(() => expect(fetches.some((f) => f.startsWith('DELETE'))).toBe(true));
    // Destructive and irreversible, so it must confirm and name the target.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0]?.[0])).toContain('ci-runner');
  });

  it('lists keys as rows rather than a table that would overflow', async () => {
    const { w } = await keysPanel();
    q(w, '#key-new').click();
    setInput(w, '#key-name', 'laptop');
    q(w, '#key-create').click();
    await vi.waitFor(() => expect(w.document.querySelector('#key-body')?.textContent).toContain('laptop'));
    // The old six-column table overflowed every narrow window; rows wrap instead.
    expect(w.document.querySelector('#key-card table')).toBeNull();
  });
});

/**
 * The request log previously refreshed by overwriting #req-card, which held
 * #req-body; the first refresh destroyed the element the next one looked up, so
 * revisiting the page showed a table that never updated again. Column widths
 * also needed a scroll container rather than pushing the page sideways.
 */
describe('request log panel', () => {
  async function requestsPanel() {
    const w = new Window({ url: 'http://127.0.0.1:8787/admin' });
    windows.push(w);
    w.fetch = (async (path: string) => {
      const body = path.endsWith('/requests')
        ? { recent: [{ time: Date.now(), method: 'POST', path: '/v1/chat/completions', model: 'wb-2', stream: true, status: 200, prompt_tokens: 120, completion_tokens: 340, duration_ms: 812 }] }
        : { ...overview, credential: { ok: true, source: 'pool', detail: '' } };
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as never;
    w.document.write(adminPanelHtml());
    w.eval(w.document.querySelector('script')!.textContent!);
    (w.document.querySelector('#key-input') as unknown as HTMLInputElement).value = 'test-only-admin-key';
    (w.document.querySelector('#key-submit') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(w.document.querySelector('#main h2')?.textContent).toBe('Overview'));
    return w;
  }

  it('renders the log inside a scroll container and keeps it refreshable', async () => {
    const w = await requestsPanel();
    const goRequests = () => (w.document.querySelector('[data-view="requests"]') as unknown as HTMLButtonElement).click();

    goRequests();
    await vi.waitFor(() => expect(w.document.querySelector('#req-body table')).toBeTruthy());
    expect(w.document.querySelector('#req-body .table-wrap')).toBeTruthy();
    expect(w.document.querySelector('#req-body td')?.getAttribute('data-label')).toBe('Time');

    // Leaving and returning must repopulate the same node rather than leave the
    // page stuck on a stale or empty body.
    (w.document.querySelector('[data-view="overview"]') as unknown as HTMLButtonElement).click();
    goRequests();
    await vi.waitFor(() => expect(w.document.querySelector('#req-body table')).toBeTruthy());
  });
});

/**
 * The panel is a template literal holding a whole program, so a stray quote
 * produces valid TypeScript that is broken JavaScript. Nothing else catches it
 * until a browser silently fails to boot the page, so parse the emitted script
 * here.
 */
describe('embedded panel script', () => {
  it('is syntactically valid JavaScript when emitted', () => {
    const html = adminPanelHtml();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });

  it('never loads an external asset, so the console works offline', () => {
    const html = adminPanelHtml();
    // The favicon is a data URI; nothing may point at a CDN or a local file.
    expect(html).not.toMatch(/<link[^>]+href="https?:/);
    expect(html).not.toMatch(/<img/i);
  });
});

/**
 * Failure detail is the point of the log. The gateway records error class,
 * retry count and the serving account for every request; the panel used to
 * render none of them, leaving a bare status code as the only clue.
 */
describe('request log detail and filtering', () => {
  const entries = [
    { time: Date.now(), request_id: 'r1', method: 'POST', path: '/v1/chat/completions', status: 200, model: 'wb-2', stream: true, duration_ms: 412, prompt_tokens: 10, completion_tokens: 20, attempts: 1, retries: 0, account: '#1' },
    { time: Date.now(), request_id: 'r2', method: 'POST', path: '/v1/chat/completions', status: 502, model: 'wb-2', stream: false, duration_ms: 900, attempts: 2, retries: 1, error_code: 'upstream_error', error_class: 'upstream_error', account: '#2' },
    { time: Date.now(), request_id: 'r3', method: 'GET', path: '/v1/models', status: 401, stream: false, duration_ms: 3, attempts: 1, retries: 0, error_code: 'invalid_api_key', error_class: 'auth_error' },
  ];

  async function logPanel() {
    const w = new Window({ url: 'http://127.0.0.1:8787/admin' });
    windows.push(w);
    w.fetch = (async (path: string) => {
      const body = path.endsWith('/requests') ? { recent: entries } : { ...overview, credential: { ok: true, source: 'pool', detail: '' } };
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as never;
    w.document.write(adminPanelHtml());
    w.eval(w.document.querySelector('script')!.textContent!);
    (w.document.querySelector('#key-input') as unknown as HTMLInputElement).value = 'test-only-admin-key';
    (w.document.querySelector('#key-submit') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(w.document.querySelector('#main h2')?.textContent).toBe('Overview'));
    (w.document.querySelector('[data-view="requests"]') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(w.document.querySelector('#req-body table')).toBeTruthy());
    return w;
  }

  const text = (w: Window) => w.document.querySelector('#req-body')?.textContent ?? '';

  it('shows the recorded error class, retry count and serving account', async () => {
    const w = await logPanel();
    const body = text(w);
    expect(body).toContain('upstream_error');
    expect(body).toContain('after 1 retry');
    expect(body).toContain('via #2');
    expect(body).toContain('auth_error');
  });

  it('filters by free text across path, model and error code', async () => {
    const w = await logPanel();
    const filter = w.document.querySelector('#req-filter') as unknown as HTMLInputElement;

    filter.value = '/v1/models';
    filter.dispatchEvent(new w.Event('input') as never);
    await vi.waitFor(() => expect(text(w)).not.toContain('/v1/chat/completions'));
    expect(text(w)).toContain('/v1/models');

    filter.value = 'upstream_error';
    filter.dispatchEvent(new w.Event('input') as never);
    await vi.waitFor(() => expect(text(w)).toContain('502'));
    expect(text(w)).not.toContain('/v1/models');
  });

  it('filters by status chip and reports the shown count', async () => {
    const w = await logPanel();
    const chip = w.document.querySelector('.chip[data-status="server"]') as unknown as HTMLButtonElement;
    chip.click();
    await vi.waitFor(() => expect(text(w)).toContain('502'));
    expect(text(w)).not.toContain('/v1/models');
    expect(text(w)).toContain('1 of 3 shown');
  });

  it('distinguishes an empty filter result from an empty log', async () => {
    const w = await logPanel();
    const filter = w.document.querySelector('#req-filter') as unknown as HTMLInputElement;
    filter.value = 'nothing-matches-this';
    filter.dispatchEvent(new w.Event('input') as never);
    // The log is not empty; the filter is. Saying so avoids looking broken.
    await vi.waitFor(() => expect(text(w)).toContain('No requests match this filter'));
    expect(text(w)).not.toContain('No requests recorded yet');
  });

  it('clears the filter from the empty state', async () => {
    const w = await logPanel();
    const filter = w.document.querySelector('#req-filter') as unknown as HTMLInputElement;
    filter.value = 'nothing-matches-this';
    filter.dispatchEvent(new w.Event('input') as never);
    await vi.waitFor(() => expect(w.document.querySelector('#req-clear-2')).toBeTruthy());
    (w.document.querySelector('#req-clear-2') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(text(w)).toContain('/v1/chat/completions'));
  });

  it('reports plainly when persisted history is turned off', async () => {
    const w = await logPanel();
    // The telemetry endpoint answers 503 on the file backend / when disabled.
    (w.fetch as unknown as { mock?: unknown }) = (async (path: string) => {
      if (path.includes('telemetry')) {
        return { ok: false, status: 503, json: async () => ({ error: { message: 'Request telemetry persistence is disabled.' } }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ recent: entries }) } as Response;
    }) as never;

    (w.document.querySelector('#history-load') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(w.document.querySelector('#history-body')?.textContent).toContain('telemetry persistence is disabled'));
  });
});

/**
 * Cooldown state was previously a static tag, so an account cooling down and an
 * account that had never been used looked identical.
 */
describe('upstream account health', () => {
  async function upstreamPanel(pool: unknown) {
    const w = new Window({ url: 'http://127.0.0.1:8787/admin' });
    windows.push(w);
    w.fetch = (async (path: string) => {
      const body = path.endsWith('/overview')
        ? { ...overview, credential: { ok: true, source: 'pool', detail: 'token abc' }, pool }
        : { recent: [] };
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as never;
    w.document.write(adminPanelHtml());
    w.eval(w.document.querySelector('script')!.textContent!);
    (w.document.querySelector('#key-input') as unknown as HTMLInputElement).value = 'test-only-admin-key';
    (w.document.querySelector('#key-submit') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(w.document.querySelector('#main h2')?.textContent).toBe('Overview'));
    (w.document.querySelector('[data-view="upstream"]') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(w.document.querySelector('#acct-rows')).toBeTruthy());
    return w;
  }

  it('explains a cooling account with its last error and a live countdown', async () => {
    const w = await upstreamPanel({
      size: 1, strategy: 'round-robin', accounts: [{ label: '#1', note: '', ok: false, detail: 'Web login' }],
      health: {
        size: 1, available: 0, unhealthy: 1, ready: false, state: 'unavailable', strategy: 'round-robin',
        accounts: [{ label: '#1', state: 'cooling_down', failures: 2, last_error: 'HTTP 401', last_failure_at: Date.now(), cooldown_remaining_ms: 30_000 }],
      },
    });
    const body = w.document.querySelector('#acct-rows')?.textContent ?? '';
    expect(body).toContain('cooling down');
    expect(body).toContain('HTTP 401');
    expect(body).toContain('2 failures');
    expect(body).toContain('retrying in');
  });

  it('does not invent a countdown for a healthy account', async () => {
    const w = await upstreamPanel({
      size: 1, strategy: 'round-robin', accounts: [{ label: '#1', note: '', ok: true, detail: 'Web login' }],
      health: {
        size: 1, available: 1, unhealthy: 0, ready: true, state: 'ready', strategy: 'round-robin',
        accounts: [{ label: '#1', state: 'healthy', failures: 0 }],
      },
    });
    const body = w.document.querySelector('#acct-rows')?.textContent ?? '';
    expect(body).toContain('available');
    // No remainder from the server means no countdown is rendered at all.
    expect(body).not.toContain('retrying in');
    expect(body).not.toContain('failures');
  });
});

/**
 * Keyboard shortcuts must never swallow ordinary typing. The filter is a text
 * field on a page that also listens for bare letters, so "n" inside the input
 * has to stay an "n".
 */
describe('keyboard shortcuts', () => {
  async function panelWithRows() {
    const w = new Window({ url: 'http://127.0.0.1:8787/admin' });
    windows.push(w);
    w.fetch = (async (path: string) => {
      const body = path.endsWith('/requests')
        ? { recent: [
            { time: Date.now(), method: 'GET', path: '/v1/models', status: 200, stream: false, duration_ms: 1, attempts: 1, retries: 0 },
            { time: Date.now(), method: 'POST', path: '/v1/chat/completions', status: 200, stream: false, duration_ms: 2, attempts: 1, retries: 0 },
          ] }
        : { ...overview, credential: { ok: true, source: 'pool', detail: '' } };
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as never;
    w.document.write(adminPanelHtml());
    w.eval(w.document.querySelector('script')!.textContent!);
    (w.document.querySelector('#key-input') as unknown as HTMLInputElement).value = 'test-only-admin-key';
    (w.document.querySelector('#key-submit') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(w.document.querySelector('#main h2')?.textContent).toBe('Overview'));
    (w.document.querySelector('[data-view="requests"]') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(w.document.querySelector('#req-body table')).toBeTruthy());
    return w;
  }

  const key = (w: Window, k: string) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }) as never);

  it('focuses the filter with / and clears it with Escape', async () => {
    const w = await panelWithRows();
    key(w, '/');
    const filter = w.document.querySelector('#req-filter') as unknown as HTMLInputElement;
    expect(w.document.activeElement).toBe(filter);

    filter.value = 'wb-2';
    filter.dispatchEvent(new w.Event('input') as never);
    await vi.waitFor(() => expect(filter.value).toBe('wb-2'));
    key(w, 'Escape');
    await vi.waitFor(() => expect(filter.value).toBe(''));
  });

  it('steps rows with n and p, and does not do so while typing', async () => {
    const w = await panelWithRows();
    key(w, 'n');
    await vi.waitFor(() => expect(w.document.querySelectorAll('.row-focused')).toHaveLength(1));
    key(w, 'p');
    await vi.waitFor(() => expect(w.document.querySelectorAll('.row-focused')).toHaveLength(1));

    // Focus the filter, then press n: it must not move the highlight.
    const filter = w.document.querySelector('#req-filter') as unknown as HTMLInputElement;
    filter.focus();
    const before = w.document.querySelector('.row-focused');
    key(w, 'n');
    expect(w.document.querySelector('.row-focused')).toBe(before);
  });
});

/**
 * The panel states the log window in prose ("the most recent 200"). That number
 * is duplicated from the metrics collector, so assert they agree: if the window
 * changes and the copy does not, the page describes itself incorrectly.
 */
describe('log window copy', () => {
  it('matches the window the metrics collector actually keeps', () => {
    const metrics = createMetrics();
    for (let i = 0; i < 260; i++) {
      metrics.record({
        method: 'GET', path: '/v1/models', status: 200, stream: false, duration_ms: 1,
      });
    }
    const kept = metrics.snapshot().recent.length;
    // The figure lives in the panel's inline script (the copy is assembled at
    // runtime), not in the served markup, so inspect the script itself.
    const script = adminPanelHtml().match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
    expect(script).toContain(`var MAX_LOG = ${kept};`);
    // Both sentences that mention the window must interpolate it rather than
    // hardcode a number that could drift away from the collector.
    expect(script).toContain("the most recent ' + MAX_LOG +");
    expect(script).toContain("buffer holds ' + MAX_LOG +");
  });
});
