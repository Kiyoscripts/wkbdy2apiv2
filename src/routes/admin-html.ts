/**
 * Embedded admin panel — single HTML page, no build step, no external assets.
 * Design follows the apple-design skill: platform system font with
 * size-specific tracking, translucent chrome (backdrop blur) with material
 * weight encoding hierarchy, tabular numerals for data, 200ms cross-fade
 * section transitions with full reduced-motion support, instant press
 * feedback on every control.
 */

export function adminPanelHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wkbdy2api Console</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f5f5f7;
  --bg-raised: rgba(255, 255, 255, 0.72);
  --bg-sidebar: rgba(240, 240, 243, 0.82);
  --chrome-border: rgba(0, 0, 0, 0.08);
  --card-border: rgba(0, 0, 0, 0.06);
  --text: #1d1d1f;
  --text-secondary: #6e6e73;
  --text-tertiary: #8e8e93;
  --accent: #0071e3;
  --accent-pressed: #0060c9;
  --ok: #34c759;
  --warn: #ff9f0a;
  --error: #ff3b30;
  --row-hover: rgba(0, 0, 0, 0.03);
  --divider: rgba(0, 0, 0, 0.07);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1c1c1e;
    --bg-raised: rgba(44, 44, 46, 0.72);
    --bg-sidebar: rgba(28, 28, 30, 0.86);
    --chrome-border: rgba(255, 255, 255, 0.08);
    --card-border: rgba(255, 255, 255, 0.09);
    --text: #f5f5f7;
    --text-secondary: #98989d;
    --text-tertiary: #77777c;
    --accent: #0a84ff;
    --accent-pressed: #409cff;
    --ok: #30d158;
    --warn: #ff9f0a;
    --error: #ff453a;
    --row-hover: rgba(255, 255, 255, 0.04);
    --divider: rgba(255, 255, 255, 0.08);
  }
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font: 100%/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro SC",
        "PingFang SC", "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  font-optical-sizing: auto;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}

/* ---- layout: settings-style sidebar + content ---- */
.shell {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  width: 220px;
  flex-shrink: 0;
  padding: 20px 12px;
  background: var(--bg-sidebar);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  border-right: 1px solid var(--chrome-border);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.main {
  flex: 1;
  min-width: 0;
  padding: 32px clamp(20px, 4vw, 48px) 64px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 8px 12px;
}
.brand-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 20%, transparent);
  flex-shrink: 0;
}
.brand-dot.down { background: var(--error); box-shadow: 0 0 0 3px color-mix(in srgb, var(--error) 20%, transparent); }
.brand h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.brand small { display: block; font-size: 11px; color: var(--text-tertiary); font-weight: 400; letter-spacing: 0; }

.nav { display: flex; flex-direction: column; gap: 2px; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 130ms ease-out;
}
.nav-item:active { background: var(--row-hover); transform: scale(0.985); }
.nav-item[aria-current="true"] { background: var(--accent); color: #fff; }
.nav-item svg { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.85; }

.sidebar-footer {
  margin-top: auto;
  padding: 10px 8px 0;
  border-top: 1px solid var(--divider);
  font-size: 11px;
  color: var(--text-tertiary);
  letter-spacing: 0.02em;
}

/* ---- content ---- */
.section { animation: fadeIn 200ms ease-out; max-width: 920px; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .section { animation: none; }
  * { transition: none !important; }
}
.section[hidden] { display: none; }

h2 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.page-sub { margin: 0 0 24px; color: var(--text-secondary); font-size: 13px; }

/* ---- stat tiles ---- */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.stat {
  background: var(--bg-raised);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  padding: 14px 16px;
}
.stat-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.stat-value {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  margin-top: 4px;
  line-height: 1.1;
}
.stat-value.ok { color: var(--ok); }
.stat-value.bad { color: var(--error); }
.stat-value small { font-size: 14px; font-weight: 500; color: var(--text-secondary); }

/* ---- cards (grouped lists, settings style) ---- */
.card {
  background: var(--bg-raised);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 24px;
}
.card-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px 10px;
}
.card-title { font-size: 15px; font-weight: 650; letter-spacing: -0.01em; margin: 0; }
.card-note { font-size: 12px; color: var(--text-tertiary); }

.rows { display: flex; flex-direction: column; }
.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 11px 18px;
  border-top: 1px solid var(--divider);
  min-height: 44px;
}
.row:first-child { border-top: none; }
.row:hover { background: var(--row-hover); }
.row-main { flex: 1; min-width: 0; }
.row-title { font-size: 13px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-sub { font-size: 12px; color: var(--text-secondary); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-value { font-size: 13px; color: var(--text-secondary); font-variant-numeric: tabular-nums; flex-shrink: 0; }

/* ---- pills / badges ---- */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 99px;
  flex-shrink: 0;
  letter-spacing: 0.01em;
}
.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pill.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
.pill.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
.pill.error { color: var(--error); background: color-mix(in srgb, var(--error) 12%, transparent); }
.pill.neutral { color: var(--text-secondary); background: var(--row-hover); }
.pill.neutral::before { display: none; }

/* ---- request log table ---- */
.log-scroll { overflow-x: auto; }
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 10px 18px;
  border-bottom: 1px solid var(--divider);
  white-space: nowrap;
}
td { padding: 9px 18px; border-top: 1px solid var(--divider); white-space: nowrap; }
td.path { font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; font-size: 11.5px; }
td .muted { color: var(--text-tertiary); }

/* ---- controls ---- */
.controls { display: flex; gap: 10px; align-items: center; }
.btn {
  appearance: none;
  border: none;
  border-radius: 8px;
  padding: 7px 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  color: #fff;
  background: var(--accent);
  transition: background 130ms ease-out, transform 80ms ease-out;
}
.btn:active { background: var(--accent-pressed); transform: scale(0.97); }
.btn.secondary {
  color: var(--text);
  background: var(--row-hover);
  border: 1px solid var(--card-border);
}
.btn.secondary:active { background: var(--divider); }

/* ---- segmented control (strategy switch) ---- */
.seg {
  display: inline-flex;
  background: var(--row-hover);
  border: 1px solid var(--card-border);
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
}
.seg-btn {
  appearance: none;
  border: none;
  border-radius: 6px;
  padding: 5px 12px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  transition: background 130ms ease-out, color 130ms ease-out;
}
.seg-btn:active { transform: scale(0.96); }
.seg-btn.active { background: var(--accent); color: #fff; }

/* ---- login form ---- */
.login-form { padding: 4px 18px 16px; display: flex; flex-direction: column; gap: 10px; }
.form-label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.login-form .key-input { font-size: 12.5px; }
.form-hint {
  margin: 10px 0 2px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.55;
}
.form-hint code {
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 11px;
  background: var(--row-hover);
  padding: 1px 5px;
  border-radius: 4px;
}
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  border-top: 1px solid var(--divider);
}
.footer-note { font-size: 12px; color: var(--text-secondary); }

/* ---- unlock view ---- */
.unlock {
  max-width: 420px;
  margin: 18vh auto 0;
  background: var(--bg-raised);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--card-border);
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.08);
  animation: fadeIn 200ms ease-out;
}
.unlock h2 { font-size: 18px; }
.unlock p { font-size: 13px; color: var(--text-secondary); margin: 4px 0 18px; }
.key-input {
  width: 100%;
  padding: 10px 12px;
  font: inherit;
  font-size: 13px;
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  outline: none;
  transition: border-color 130ms ease-out;
}
.key-input:focus { border-color: var(--accent); }
.key-error { color: var(--error); font-size: 12px; min-height: 16px; margin: 8px 0 2px; }

/* ---- model bars (per-model usage) ---- */
.bar-track {
  height: 4px;
  border-radius: 2px;
  background: var(--divider);
  overflow: hidden;
  min-width: 80px;
}
.bar-fill { height: 100%; border-radius: 2px; background: var(--accent); }

/* responsive: sidebar collapses to top bar */
@media (max-width: 720px) {
  .shell { flex-direction: column; }
  .sidebar {
    position: static;
    height: auto;
    width: 100%;
    flex-direction: row;
    align-items: center;
    padding: 10px 16px;
    border-right: none;
    border-bottom: 1px solid var(--chrome-border);
    gap: 10px;
  }
  .brand { padding: 0; }
  .brand h1 { font-size: 14px; }
  .brand small { display: none; }
  .nav { flex-direction: row; overflow-x: auto; flex: 1; }
  .nav-item { width: auto; white-space: nowrap; }
  .nav-item span { display: none; }
  .sidebar-footer { display: none; }
  .main { padding: 20px 16px 48px; }
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
}
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

/* ---- API keys ---- */
.check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); margin: 10px 0; cursor: pointer; }
.check input { accent-color: var(--accent); width: 15px; height: 15px; }
.badge {
  display: inline-block; font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; padding: 1px 6px; border-radius: 4px;
  background: var(--row-hover); color: var(--text-tertiary); vertical-align: middle;
}
.badge-admin { background: var(--accent); color: #fff; }
.secret-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.secret-row code {
  flex: 1; min-width: 220px; padding: 8px 10px; border-radius: 6px;
  background: var(--row-hover); font-size: 13px; word-break: break-all;
  font-variant-numeric: tabular-nums; user-select: all;
}
.btn-danger { color: var(--error); border-color: var(--error); }
.btn-danger:hover { background: var(--error); color: #fff; }
.btn[disabled] { opacity: 0.5; cursor: default; }
.btn-ghost { background: transparent; }
.row-new { background: var(--accent-soft, var(--row-hover)); }
.form-error { color: var(--error); font-size: 13px; margin-top: 8px; min-height: 16px; }
</style>
</head>
<body>

<div id="app"></div>

<script>
(function () {
  'use strict';

  var KEY_STORAGE = 'wkb2api-admin-key';
  var state = {
    key: null,
    overview: null,
    view: 'overview',
    timer: null,
    unlockError: null,
    oauth: null,
    oauthTimer: null,
    oauthBusy: false,
    oauthMessage: '',
    oauthUrl: '',
    overviewPending: false,
    keys: null,
    newKey: null,
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  // ---------- icons (inline, 16px, stroke-based) ----------
  var icons = {
    overview: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6v3.6l2.3 1.4"/></svg>',
    models: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2.2" y="2.7" width="11.6" height="4" rx="1.2"/><rect x="2.2" y="9.3" width="11.6" height="4" rx="1.2"/><path d="M4.4 4.7h.01M4.4 11.3h.01"/></svg>',
    requests: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.2h11M2.5 8h11M2.5 11.8h7"/></svg>',
    upstream: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.2 6.4a5.2 5.2 0 1 0-1.6 5.1"/><path d="M13.4 2.9v3.6h-3.6"/></svg>',
    keys: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="9.4" r="3.1"/><path d="M8.2 7.2 13 2.4M11.4 4.2l1.5 1.5"/></svg>',
  };

  function navLabel(v) {
    return {
      overview: 'Overview',
      models: 'Models',
      requests: 'Requests',
      upstream: 'Upstream & Credentials',
      keys: 'API Keys',
    }[v];
  }

  // ---------- data ----------
  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers, { 'Authorization': 'Bearer ' + state.key });
    return fetch('/admin/api/' + path, Object.assign({}, opts, { headers: headers, credentials: 'same-origin' })).then(function (res) {
      return res.json().then(function (body) {
        if (res.status === 401 && body.error && body.error.code === 'invalid_api_key') {
          try { localStorage.removeItem(KEY_STORAGE); } catch (e) {}
          state.key = null;
          state.overview = null;
          state.unlockError = 'Invalid key. Check it and try again.';
          clearTimeout(state.oauthTimer);
          state.oauth = null;
          state.oauthUrl = '';
          stopTimer();
          render();
        }
        if (!res.ok) {
          var error = new Error(body.error && body.error.message || 'Request failed (HTTP ' + res.status + ')');
          error.code = body.error && body.error.code;
          throw error;
        }
        return body;
      });
    });
  }

  function refreshOverview() {
    if (state.overviewPending) return Promise.resolve();
    state.overviewPending = true;
    return api('overview').then(function (d) {
      state.overview = d;
      if (!$('#main')) return;
      if (!$('#main').firstElementChild) renderMain();
      else if (state.view === 'overview') patchOverview(d);
      else if (state.view === 'upstream') patchAccountPool(d);
    }).finally(function () { state.overviewPending = false; });
  }

  /** In-place update of overview numbers/bars — never rebuilds the section. */
  function patchOverview(d) {
    if (!$('#stat-total') || !$('#stat-errors')) { renderMain(); return; } // not built yet → full render
    var s = d.stats;
    function set(id, text, cls) {
      var el = $('#' + id);
      if (!el) return;
      el.textContent = text;
      el.className = 'stat-value' + (cls ? ' ' + cls : '');
    }
    set('stat-total', fmtInt(s.total_requests));
    set('stat-errors', fmtPct(s.error_rate), s.error_rate > 0.05 ? 'bad' : 'ok');
    set('stat-p95', fmtMs(s.p95_ms));
    set('stat-tokens', fmtInt(s.tokens.prompt + s.tokens.completion));

    var rows = document.querySelectorAll('[data-mkey]');
    if (rows.length !== s.per_model.length) { renderMain(); return; } // shape changed → rebuild once
    var max = 0;
    s.per_model.forEach(function (m) { if (m.count > max) max = m.count; });
    s.per_model.forEach(function (m) {
      var row = document.querySelector('[data-mkey="' + m.model + '"]');
      if (!row) return;
      var fill = row.querySelector('.bar-fill');
      var val = row.querySelector('.row-value');
      if (fill) fill.style.width = (max ? Math.round(m.count / max * 100) : 0) + '%';
      if (val) val.textContent = fmtInt(m.count) + ' req · ' + fmtInt(m.tokens) + ' tok';
    });
  }

  function startTimer() {
    stopTimer();
    state.timer = setInterval(function () { refreshOverview().catch(function () {}); }, 5000);
  }
  function stopTimer() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  // ---------- formatting ----------
  function fmtInt(n) { return (n || 0).toLocaleString(); }
  function fmtPct(x) { return (x * 100).toFixed(1) + '%'; }
  function fmtMs(n) { return n == null ? '—' : (n >= 1000 ? (n / 1000).toFixed(1) + ' s' : Math.round(n) + ' ms'); }
  function fmtUptime(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm ' + (s % 60) + 's';
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- views ----------
  function render() {
    var app = $('#app');
    if (!state.key) { app.innerHTML = unlockView(); wireUnlock(); return; }
    app.innerHTML = shellView();
    wireNav();
    renderMain();
  }

  function unlockView() {
    return '<div class="unlock">' +
      '<h2>Wkbdy2api Console</h2>' +
      '<p>Enter the gateway API key — the same Bearer key used for the /v1 endpoints. It is stored in this browser only.</p>' +
      '<input class="key-input" id="key-input" type="password" placeholder="wkb2api-local-key…" autocomplete="off">' +
      '<div class="key-error" id="key-error">' + (state.unlockError || '') + '</div>' +
      '<button class="btn" id="key-submit" style="width:100%">Unlock</button>' +
      '</div>';
  }

  function wireUnlock() {
    var input = $('#key-input'), btn = $('#key-submit'), err = $('#key-error');
    function submit() {
      var v = input.value.trim();
      if (!v) { err.textContent = 'Enter the key.'; return; }
      if (btn.disabled) return;
      state.key = v;
      state.overview = null;
      state.unlockError = null;
      btn.disabled = true;
      btn.textContent = 'Verifying…';
      refreshOverview().then(function () {
        try { localStorage.setItem(KEY_STORAGE, v); } catch (e) {}
        render();
        startTimer();
      }).catch(function () {
        state.key = null;
        state.overview = null;
        state.unlockError = state.unlockError || 'Could not reach the gateway. Try again.';
        render();
      });
    }
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    input.focus();
  }

  function shellView() {
    var items = ['overview', 'models', 'requests', 'upstream', 'keys'].map(function (v) {
      return '<button class="nav-item" data-view="' + v + '"' +
        (state.view === v ? ' aria-current="true"' : '') + '>' + icons[v] + '<span>' + navLabel(v) + '</span></button>';
    }).join('');
    return '<div class="shell">' +
      '<aside class="sidebar">' +
      '<div class="brand"><span class="brand-dot" id="health-dot"></span><div><h1>Wkbdy2api</h1><small>WorkBuddy → OpenAI gateway</small></div></div>' +
      '<nav class="nav">' + items + '</nav>' +
      '<div class="sidebar-footer">v' + escapeHtml(state.overview ? state.overview.version : '') + ' · local</div>' +
      '</aside><main class="main" id="main"></main></div>';
  }

  function renderMain() {
    var main = $('#main');
    if (!main || !state.overview) return;
    var d = state.overview;
    var dot = $('#health-dot');
    if (dot) dot.classList.toggle('down', d.credential.ok === false && !(d.pool && d.pool.accounts.some(function (a) { return a.ok; })));

    if (state.view === 'overview') main.innerHTML = viewOverview(d);
    else if (state.view === 'models') main.innerHTML = viewModels(d);
    else if (state.view === 'requests') { main.innerHTML = viewRequestsShell(); loadRequests(); }
    else if (state.view === 'keys') { main.innerHTML = viewKeysShell(); loadKeys(); }
    else if (state.view === 'upstream') {
      main.innerHTML = viewUpstream(d);
      wireLoginForm();
      updateOAuthView();
    }
  }

  function statTile(label, value, cls, id) {
    var idAttr = id ? ' id="' + id + '"' : '';
    return '<div class="stat"><div class="stat-label">' + label + '</div><div class="stat-value ' + (cls || '') + '"' + idAttr + '>' + value + '</div></div>';
  }

  function viewOverview(d) {
    var s = d.stats;
    var maxCount = 0;
    s.per_model.forEach(function (m) { if (m.count > maxCount) maxCount = m.count; });
    var modelRows = s.per_model.length === 0
      ? '<div class="row"><div class="row-main"><div class="row-title muted" style="color:var(--text-tertiary)">No requests yet</div></div></div>'
      : s.per_model.map(function (m) {
        return '<div class="row" data-mkey="' + escapeHtml(m.model) + '">' +
          '<div class="row-main"><div class="row-title">' + escapeHtml(m.model) + '</div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + (maxCount ? Math.round(m.count / maxCount * 100) : 0) + '%"></div></div></div>' +
          '<div class="row-value">' + fmtInt(m.count) + ' req · ' + fmtInt(m.tokens) + ' tok</div></div>';
      }).join('');

    return '<section class="section"><h2>Overview</h2>' +
      '<p class="page-sub">Gateway up ' + fmtUptime(s.uptime_ms) + '. Data refreshes every 5 seconds.</p>' +
      '<div class="stat-grid">' +
      statTile('Total requests', fmtInt(s.total_requests), '', 'stat-total') +
      statTile('Error rate', fmtPct(s.error_rate), s.error_rate > 0.05 ? 'bad' : 'ok', 'stat-errors') +
      statTile('P95 latency', fmtMs(s.p95_ms), '', 'stat-p95') +
      statTile('Token usage', fmtInt(s.tokens.prompt + s.tokens.completion), '', 'stat-tokens') +
      '</div>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">Calls by model</h3><span class="card-note">cumulative · last 200 window</span></div>' +
      '<div class="rows">' + modelRows + '</div></div>' +
      '</section>';
  }

  function viewModels(d) {
    var rows = d.models.map(function (m) {
      var x = m.x_workbuddy || {};
      var tags = [];
      if (x.is_default) tags.push('<span class="pill neutral">default</span>');
      if (x.supports_tool_call) tags.push('tool');
      if (x.supports_images) tags.push('vision');
      var maxIn = x.max_input_tokens ? (x.max_input_tokens >= 1000000 ? (x.max_input_tokens / 1000000) + 'M' : Math.round(x.max_input_tokens / 1000) + 'K') : '—';
      var maxOut = x.max_output_tokens ? (x.max_output_tokens >= 1000 ? Math.round(x.max_output_tokens / 1000) + 'K' : x.max_output_tokens) : '—';
      return '<div class="row">' +
        '<div class="row-main"><div class="row-title" style="font-family:ui-monospace,Consolas,monospace;font-size:12px">' + escapeHtml(m.id) + '</div>' +
        '<div class="row-sub">' + escapeHtml(x.name || '') + (tags.length ? ' · ' + tags.join(' · ') : '') + '</div></div>' +
        '<div class="row-value">in ' + maxIn + ' / out ' + maxOut + '</div>' +
        '<span class="pill ' + (x.credits === 'x0.00' ? 'ok' : 'neutral') + '">' + escapeHtml(x.credits || '') + '</span></div>';
    }).join('');
    return '<section class="section"><h2>Models</h2>' +
      '<p class="page-sub">' + d.models.length + ' available models, intersected from the CLI agent allow-list and the product config.</p>' +
      '<div class="card"><div class="rows">' + rows + '</div></div></section>';
  }

  // ---------- API keys ----------
  //
  // Keys are shown as hash-backed records: the panel never has the plaintext,
  // because the gateway only ever stored a hash. Creation therefore has to show
  // the value once, prominently, with a copy button — after that the only
  // recovery is to revoke and reissue.

  function viewKeysShell() {
    return '<section class="section"><h2>API Keys</h2>' +
      '<p class="page-sub">Keys authenticate <code>/v1</code> requests and the panel. Only a hash is stored, so a lost key cannot be recovered — revoke it and issue a new one.</p>' +
      '<div id="key-banner"></div>' +
      '<div class="card" style="padding:16px 18px;margin-bottom:16px">' +
      '<div class="form-row"><label for="key-name">Name</label>' +
      '<input class="input" id="key-name" type="text" placeholder="e.g. laptop, ci, teammate-name" autocomplete="off"></div>' +
      '<div class="form-row"><label for="key-note">Note (optional)</label>' +
      '<input class="input" id="key-note" type="text" placeholder="what this key is for" autocomplete="off"></div>' +
      '<label class="check"><input type="checkbox" id="key-admin"> <span>Admin key — may manage the gateway (accounts, keys, settings)</span></label>' +
      '<div class="actions"><button class="btn" id="key-create">Create key</button></div>' +
      '<div id="key-error" class="form-error"></div>' +
      '</div>' +
      '<div class="card" id="key-card"><div id="key-body" class="muted" style="color:var(--text-tertiary);padding:16px 18px;font-size:13px">Loading…</div></div>' +
      '</section>';
  }

  function loadKeys() {
    var create = $('#key-create');
    if (create) create.addEventListener('click', createKey);
    var name = $('#key-name');
    if (name) name.addEventListener('keydown', function (e) { if (e.key === 'Enter') createKey(); });
    return api('keys').then(function (d) {
      state.keys = d;
      renderKeyBanner();
      renderKeyTable();
    }).catch(function () {});
  }

  /** The one-time reveal, shown above the table after a successful create. */
  function renderKeyBanner() {
    var host = $('#key-banner');
    if (!host) return;
    if (!state.newKey) { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="card" style="padding:16px 18px;margin-bottom:16px;border-color:var(--accent)">' +
      '<div style="font-weight:600;margin-bottom:6px">Key created — copy it now</div>' +
      '<p class="page-sub" style="margin:0 0 10px">' + escapeHtml(state.newKey.warning) + '</p>' +
      '<div class="secret-row"><code id="new-key-value">' + escapeHtml(state.newKey.key) + '</code>' +
      '<button class="btn" id="key-copy">Copy</button>' +
      '<button class="btn btn-ghost" id="key-dismiss">Dismiss</button></div>' +
      '</div>';
    var copy = $('#key-copy');
    if (copy) copy.addEventListener('click', function () {
      var value = state.newKey ? state.newKey.key : '';
      if (navigator.clipboard) {
        navigator.clipboard.writeText(value).then(function () {
          copy.textContent = 'Copied';
          setTimeout(function () { copy.textContent = 'Copy'; }, 1500);
        }).catch(function () {});
      }
    });
    var dismiss = $('#key-dismiss');
    if (dismiss) dismiss.addEventListener('click', function () { state.newKey = null; renderKeyBanner(); });
  }

  function renderKeyTable() {
    var body = $('#key-body');
    if (!body || !state.keys) return;
    var rows = state.keys.keys.map(function (k) {
      var badge = k.admin
        ? '<span class="badge badge-admin">admin</span>'
        : '<span class="badge">api</span>';
      var used = k.last_used_at ? fmtTime(k.last_used_at) : '<span class="muted">never</span>';
      return '<tr' + (k.id === state.keys.just_created ? ' class="row-new"' : '') + '>' +
        '<td>' + escapeHtml(k.name) + ' ' + badge + (k.note ? '<div class="muted" style="font-size:12px">' + escapeHtml(k.note) + '</div>' : '') + '</td>' +
        '<td><code class="muted">' + escapeHtml(k.prefix) + '…</code></td>' +
        '<td>' + k.request_count + '</td>' +
        '<td>' + used + '</td>' +
        '<td>' + fmtTime(k.created_at) + '</td>' +
        '<td><button class="btn btn-ghost btn-danger" data-revoke="' + escapeHtml(k.id) + '" data-name="' + escapeHtml(k.name) + '">Revoke</button></td>' +
        '</tr>';
    }).join('');

    var bootstrap = '<tr><td>' + escapeHtml(state.keys.bootstrap_key.name) + ' <span class="badge badge-admin">admin</span>' +
      '<div class="muted" style="font-size:12px">' + escapeHtml(state.keys.bootstrap_key.note) + '</div></td>' +
      '<td><span class="muted">—</span></td><td><span class="muted">—</span></td><td><span class="muted">—</span></td>' +
      '<td><span class="muted">from env</span></td>' +
      '<td><span class="muted">not revocable</span></td></tr>';

    var table = rows.length
      ? '<table><thead><tr><th>Name</th><th>Prefix</th><th>Requests</th><th>Last used</th><th>Created</th><th></th></tr></thead><tbody>' + rows + bootstrap + '</tbody></table>'
      : '<table><thead><tr><th>Name</th><th>Prefix</th><th>Requests</th><th>Last used</th><th>Created</th><th></th></tr></thead><tbody>' + bootstrap + '</tbody></table>';

    $('#key-card').innerHTML = table;

    Array.prototype.forEach.call(document.querySelectorAll('[data-revoke]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-revoke');
        var name = btn.getAttribute('data-name');
        // Revocation is immediate and irreversible, so it asks first and names
        // the key rather than acting on a row the operator may have misread.
        if (!window.confirm('Revoke "' + name + '"? Any client using it will start receiving 401s immediately. This cannot be undone.')) return;
        btn.disabled = true;
        api('keys/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () {
          return loadKeys();
        }).catch(function (err) {
          btn.disabled = false;
          var host = $('#key-error');
          if (host) host.textContent = err.message || 'Could not revoke the key.';
        });
      });
    });
  }

  function createKey() {
    var nameEl = $('#key-name');
    var noteEl = $('#key-note');
    var adminEl = $('#key-admin');
    var errorEl = $('#key-error');
    if (errorEl) errorEl.textContent = '';
    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
      if (errorEl) errorEl.textContent = 'Give the key a name so you can tell it apart later.';
      return;
    }
    var payload = { name: name, admin: !!(adminEl && adminEl.checked) };
    var note = noteEl ? noteEl.value.trim() : '';
    if (note) payload.note = note;

    api('keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (created) {
        state.newKey = created;
        state.keys && (state.keys.just_created = created.id);
        if (nameEl) nameEl.value = '';
        if (noteEl) noteEl.value = '';
        if (adminEl) adminEl.checked = false;
        return loadKeys();
      })
      .catch(function (err) {
        if (errorEl) errorEl.textContent = err.message || 'Could not create the key.';
      });
  }

  function viewRequestsShell() {    return '<section class="section"><h2>Requests</h2>' +
      '<p class="page-sub">Last ' + 200 + ' requests (cleared on restart).</p>' +
      '<div class="card log-scroll" id="req-card"><div id="req-body" class="muted" style="color:var(--text-tertiary);padding:16px 18px;font-size:13px">Loading…</div></div></section>';
  }

  function loadRequests() {
    api('requests').then(function (d) {
      var body = $('#req-body');
      if (!body) return;
      if (!d.recent || d.recent.length === 0) {
        body.innerHTML = 'No requests recorded yet.';
        return;
      }
      var trs = d.recent.map(function (r) {
        var st = '<span class="muted">' + r.status + '</span>';
        if (r.status >= 500) st = '<span style="color:var(--error);font-weight:600">' + r.status + '</span>';
        else if (r.status >= 400) st = '<span style="color:var(--warn);font-weight:600">' + r.status + '</span>';
        else if (r.status < 300) st = '<span style="color:var(--ok);font-weight:600">' + r.status + '</span>';
        var tok = (r.prompt_tokens || r.completion_tokens) ? (r.prompt_tokens || 0) + ' / ' + (r.completion_tokens || 0) : '<span class="muted">—</span>';
        return '<tr><td>' + fmtTime(r.time) + '</td><td class="path">' + escapeHtml(r.method + ' ' + r.path) +
          (r.model ? ' <span class="muted">· ' + escapeHtml(r.model) + (r.stream ? ' · stream' : '') + '</span>' : '') + '</td>' +
          '<td>' + st + '</td><td>' + tok + '</td><td>' + fmtMs(r.duration_ms) + '</td></tr>';
      }).join('');
      $('#req-card').innerHTML = '<table><thead><tr><th>Time</th><th>Request</th><th>Status</th><th>tok in/out</th><th>Duration</th></tr></thead><tbody>' + trs + '</tbody></table>';
    }).catch(function () {});
  }

  function viewUpstream(d) {
    var c = d.credential;
    var u = d.upstream;
    var pool = d.pool || { size: 0, strategy: 'round-robin', accounts: [] };
    var stratName = pool.strategy === 'random' ? 'random' : 'round-robin';

    var acctRows = pool.accounts.map(function (a) {
      return '<div class="row">' +
        '<div class="row-main"><div class="row-title">' + escapeHtml(a.label) + (a.note ? ' · ' + escapeHtml(a.note) : '') + '</div>' +
        '<div class="row-sub">' + escapeHtml(a.detail) + '</div></div>' +
        '<span class="pill ' + (a.ok ? 'ok' : 'warn') + '">' + (a.ok ? 'available' : 'cooling down') + '</span>' +
        '<button class="btn secondary acct-remove" data-label="' + escapeHtml(a.label) + '" style="padding:4px 10px;font-size:12px">Remove</button>' +
        '</div>';
    }).join('');
    if (pool.size === 0) {
      acctRows = '<div class="row"><div class="row-main"><div class="row-title" style="color:var(--text-tertiary)">Account pool is empty — falling back to the single account in the local credential file</div></div></div>';
    }

    // Pool readiness banner. "Size > 0" is not the same as "usable": every
    // account can be cooling down or need a fresh web login, and the previous
    // panel showed a green dot in that state.
    var health = pool.health;
    var healthBanner = '';
    if (health) {
      var tone = health.ready ? (health.state === 'degraded' ? 'warn' : 'ok') : 'error';
      var label = health.state === 'empty' ? 'No accounts' :
                  health.state === 'ready' ? 'Ready' :
                  health.state === 'degraded' ? 'Degraded' : 'Unavailable';
      var detail = health.state === 'empty'
        ? 'Every /v1 request will fail until an account is added.'
        : health.available + ' of ' + health.size + ' account(s) usable.';
      healthBanner = '<div class="card"><div class="card-header"><h3 class="card-title">Pool readiness</h3>' +
        '<span class="pill ' + tone + '">' + label + '</span></div>' +
        '<div class="rows"><div class="row"><div class="row-main"><div class="row-title">' + escapeHtml(detail) + '</div>' +
        (health.accounts.some(function (a) { return a.last_error; })
          ? '<div class="row-sub">' + health.accounts.filter(function (a) { return a.last_error; })
              .map(function (a) { return escapeHtml(a.label) + ': ' + escapeHtml(a.last_error); }).join(' · ') + '</div>'
          : '') +
        '</div></div></div></div>';
    }

    var isRR = pool.strategy === 'round-robin';
    return '<section class="section"><h2>Upstream &amp; Credentials</h2>' +
      '<p class="page-sub">Pooled credentials rotate per request; when the pool is empty the gateway falls back to the local credential file. Credential values are never displayed or written to disk.</p>' +
      (d.notice ? '<div class="card"><div class="card-header"><h3 class="card-title">Startup notice</h3><span class="pill warn">attention</span></div>' +
        '<div class="rows"><div class="row"><div class="row-main"><div class="row-title">' + escapeHtml(d.notice) + '</div></div></div></div></div>' : '') +
      healthBanner +
      '<div class="card"><div class="card-header"><h3 class="card-title">Account pool</h3>' +
      '<div class="controls">' +
      '<div class="seg" role="tablist"><button class="seg-btn' + (isRR ? ' active' : '') + '" data-strategy="round-robin" role="tab" aria-selected="' + isRR + '">Round-robin</button>' +
      '<button class="seg-btn' + (!isRR ? ' active' : '') + '" data-strategy="random" role="tab" aria-selected="' + !isRR + '">Random</button></div>' +
      '</div></div>' +
      '<div class="rows" id="acct-rows">' + acctRows + '</div>' +
      (pool.size === 0
        ? ''
        : '<div class="card-footer"><div class="footer-note">' + pool.size + ' account(s) · ' + stratName + ' scheduling · accounts returning 401 cool down and retry automatically</div></div>') +
      '</div>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">Add account</h3><span class="card-note">official web sign-in</span></div>' +
      '<div class="login-form">' +
      '<p class="form-hint">Click to sign in on the official WorkBuddy web page; the gateway adds the account to the pool automatically. No desktop client to install and no token to copy. Passwords and verification codes are entered on the official page only.</p>' +
      '<label class="form-label" for="oauth-note">Account note (optional)</label><input class="key-input" id="oauth-note" maxlength="64" placeholder="e.g. work account">' +
      '<div class="controls"><button class="btn" id="oauth-start">Sign in to WorkBuddy</button><button class="btn secondary" id="oauth-cancel" hidden>Cancel sign-in</button></div>' +
      '<p class="form-hint" id="oauth-status" role="status" aria-live="polite">The result appears here automatically — no refresh needed.</p>' +
      '<a id="oauth-link" class="form-hint" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" hidden>Open the official sign-in page</a>' +
      '<p class="form-hint">Accounts are stored encrypted and restored automatically after a gateway restart — no need to sign in again.</p>' +
      '</div></div>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">Pool status</h3><span class="pill ' + (c.ok ? 'ok' : 'error') + '">' + (c.ok ? 'available' : 'unavailable') + '</span></div>' +
      '<div class="rows">' +
      '<div class="row"><div class="row-main"><div class="row-title">Source</div></div><div class="row-value">' + escapeHtml(c.source) + '</div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">Credential status</div><div class="row-sub">' + escapeHtml(c.ok ? c.detail : 'Account pool is empty — sign in to WorkBuddy') + '</div></div></div>' +
      '</div></div>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">Upstream endpoint</h3></div><div class="rows">' +
      '<div class="row"><div class="row-main"><div class="row-title">URL</div></div><div class="row-value" style="font-family:ui-monospace,Consolas,monospace;font-size:12px">' + escapeHtml(u.url) + '</div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">User-Agent</div></div><div class="row-value" style="font-family:ui-monospace,Consolas,monospace;font-size:12px">' + escapeHtml(u.user_agent) + '</div></div>' +
      '</div></div>' +
      '<div class="controls"><button class="btn" id="refresh-now">Refresh now</button></div>' +
      '</section>';
  }

  // ---------- nav wiring ----------
  function wireNav() {
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.view = btn.getAttribute('data-view');
        document.querySelectorAll('.nav-item').forEach(function (b) {
          b.setAttribute('aria-current', b === btn ? 'true' : 'false');
        });
        renderMain();
      });
    });
    var rf = $('#refresh-now');
    if (rf) rf.addEventListener('click', function () { refreshOverview().catch(function () {}); });
  }

  function patchAccountPool(d) {
    var rows = $('#acct-rows');
    if (!rows) return;
    var accounts = d.pool.accounts;
    var html = accounts.map(function (a) {
      return '<div class="row"><div class="row-main"><div class="row-title">' + escapeHtml(a.label) + (a.note ? ' · ' + escapeHtml(a.note) : '') + '</div><div class="row-sub">' + escapeHtml(a.detail) + '</div></div><span class="pill ' + (a.ok ? 'ok' : 'warn') + '">' + (a.ok ? 'available' : 'recovering') + '</span><button class="btn secondary acct-remove" data-label="' + escapeHtml(a.label) + '">Remove</button></div>';
    }).join('') || '<div class="row"><div class="row-title">Account pool is empty — use the button below to sign in.</div></div>';
    if (rows.dataset.snapshot !== html) { rows.innerHTML = html; rows.dataset.snapshot = html; }
    document.querySelectorAll('[data-strategy]').forEach(function (button) {
      var selected = button.dataset.strategy === d.pool.strategy;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  }

  function updateOAuthView() {
    var start = $('#oauth-start'), cancel = $('#oauth-cancel'), status = $('#oauth-status'), link = $('#oauth-link');
    if (!start) return;
    start.disabled = state.oauthBusy || !!state.oauth;
    start.textContent = state.oauthBusy ? 'Preparing sign-in…' : 'Sign in to WorkBuddy';
    cancel.hidden = !state.oauth;
    status.textContent = state.oauthMessage || 'The result appears here automatically — no refresh needed.';
    link.hidden = !state.oauthUrl;
    if (state.oauthUrl) link.href = state.oauthUrl;
    else link.removeAttribute('href');
  }

  function pollOAuth() {
    if (!state.oauth) return;
    var id = state.oauth;
    api('oauth/' + id + '/status').then(function (result) {
      if (state.oauth !== id) return;
      if (result.status === 'completed') {
        state.oauth = null;
        state.oauthUrl = '';
        state.oauthMessage = 'Signed in. ' + result.account_label + ' was added to the pool.';
        updateOAuthView();
        return refreshOverview();
      }
      if (['failed', 'expired', 'cancelled'].indexOf(result.status) >= 0) {
        state.oauth = null;
        state.oauthUrl = '';
        state.oauthMessage = result.status === 'expired' ? 'Sign-in timed out. Start again.' : result.status === 'cancelled' ? 'Sign-in cancelled.' : 'Sign-in failed: ' + (result.error || 'try again');
      } else {
        state.oauthMessage = result.status === 'pending' ? 'Waiting for you to finish signing in on the official page…' : 'Authorization received — confirming the account…';
        state.oauthTimer = setTimeout(pollOAuth, 1500);
      }
      updateOAuthView();
    }).catch(function (error) {
      if (state.oauth !== id) return;
      state.oauth = null;
      state.oauthUrl = '';
      state.oauthMessage = error.message;
      updateOAuthView();
    });
  }

  function wireLoginForm() {
    var start = $('#oauth-start');
    if (!start) return;
    start.addEventListener('click', function () {
      if (state.oauthBusy || state.oauth) return;
      var popup = window.open('about:blank', '_blank');
      if (popup) {
        popup.opener = null;
        popup.document.title = 'Opening the official sign-in page';
        popup.document.body.textContent = 'Preparing WorkBuddy sign-in, please wait.';
        var meta = popup.document.createElement('meta');
        meta.name = 'referrer'; meta.content = 'no-referrer'; popup.document.head.appendChild(meta);
      }
      state.oauthBusy = true;
      state.oauthMessage = 'Requesting an official sign-in link…';
      updateOAuthView();
      var note = $('#oauth-note').value.trim();
      api('oauth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note || undefined }) }).then(function (result) {
        state.oauth = result.id;
        state.oauthUrl = result.authorization_url;
        state.oauthMessage = 'Finish signing in on the official page that just opened; if it was blocked, use the link below.';
        if (popup && !popup.closed) popup.location.replace(result.authorization_url);
        clearTimeout(state.oauthTimer);
        state.oauthTimer = setTimeout(pollOAuth, 1500);
      }).catch(function (error) {
        if (popup && !popup.closed) popup.close();
        state.oauthMessage = error.code === 'oauth_already_pending' ? 'This browser already has a sign-in in progress. Finish it or wait for it to expire.' : error.message;
      }).finally(function () { state.oauthBusy = false; updateOAuthView(); });
    });
    $('#oauth-cancel').addEventListener('click', function () {
      var id = state.oauth;
      if (!id) return;
      api('oauth/' + id + '/cancel', { method: 'POST' }).then(function (result) {
        if (state.oauth !== id) return;
        clearTimeout(state.oauthTimer);
        state.oauth = null; state.oauthUrl = '';
        state.oauthMessage = result.status === 'completed' ? 'The account signed in and joined the pool.' : 'Sign-in cancelled.';
        updateOAuthView();
        return refreshOverview();
      }).catch(function (error) { state.oauthMessage = error.message; updateOAuthView(); });
    });
    $('#acct-rows').addEventListener('click', function (event) {
      var button = event.target.closest('.acct-remove');
      if (!button) return;
      api('accounts/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: button.dataset.label }) })
        .then(refreshOverview).catch(function (error) { state.oauthMessage = error.message; updateOAuthView(); });
    });
    document.querySelectorAll('.seg-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        api('strategy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategy: button.dataset.strategy }) })
          .then(refreshOverview).catch(function (error) { state.oauthMessage = error.message; updateOAuthView(); });
      });
    });
    $('#refresh-now').addEventListener('click', function () { refreshOverview().catch(function () {}); });
  }

  // ---------- boot ----------
  var saved = null;
  try { saved = localStorage.getItem(KEY_STORAGE); } catch (e) {}
  if (saved) {
    state.key = saved;
    refreshOverview().then(function () { if (state.overview) startTimer(); }).catch(function () {});
  }
  render();
})();
</script>
</body>
</html>`;
}
