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
<meta name="color-scheme" content="light dark">
<meta name="description" content="Local administration console for the Wkbdy2api gateway.">
<!-- Inline SVG favicon: a monogram tile. Kept as a data URI so the panel stays a
     single self-contained document with no external asset to fetch or 404. -->
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231d1d1f'/%3E%3Cpath d='M8 9.5l2.6 13 2.6-8 2.6 8 2.6-13' fill='none' stroke='%23f5f5f7' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
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

/* ---- status tags ---- */
/* Deliberately not pill-shaped: a rounded rectangle reads as a label, where a
   full-radius pill reads as decoration. Same for the badges below. */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 5px;
  flex-shrink: 0;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pill.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
.pill.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
.pill.error { color: var(--error); background: color-mix(in srgb, var(--error) 12%, transparent); }
.pill.neutral { color: var(--text-secondary); background: var(--row-hover); }
.pill.neutral::before { display: none; }

/* ---- request log table ---- */
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

/* Any table sits in a scroll container so a wide row scrolls instead of
   forcing the whole page sideways. The last column is pinned so the row action
   stays reachable while the rest scrolls under it. */
.table-wrap { overflow-x: auto; }
.table-wrap th:last-child,
.table-wrap td:last-child {
  position: sticky;
  right: 0;
  background: var(--bg-raised);
  box-shadow: -1px 0 0 var(--divider);
}
.table-wrap td:last-child { text-align: right; }
/* Tables collapse to stacked rows when there is no room for columns. */
@media (max-width: 720px) {
  .table-wrap table, .table-wrap thead, .table-wrap tbody,
  .table-wrap tr, .table-wrap th, .table-wrap td { display: block; width: auto; }
  .table-wrap thead { display: none; }
  .table-wrap tr {
    border-top: 1px solid var(--divider);
    padding: 10px 0;
  }
  .table-wrap tr:first-child { border-top: none; }
  .table-wrap td {
    border: none;
    padding: 2px 18px;
    white-space: normal;
    display: flex;
    gap: 10px;
    position: static;
    box-shadow: none;
  }
  .table-wrap td::before {
    content: attr(data-label);
    flex: 0 0 88px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding-top: 2px;
  }
  .table-wrap td:last-child { justify-content: flex-end; padding-top: 8px; }
  .table-wrap td:last-child::before { content: none; }
}

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
.bar-fill { height: 100%; border-radius: 2px; background: var(--accent); position: relative; overflow: hidden; }
/* Failing share of a model's requests, drawn at the trailing end of its bar. */
.bar-errors { position: absolute; top: 0; right: 0; height: 100%; background: var(--error); border-radius: 2px; }

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

/* Page header: title on the left, the primary action on the right, so the
   create form stays collapsed until it is actually wanted. */
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.page-head .page-sub { max-width: 62ch; }

/* Create form: hidden by default, revealed by the header action. */
.create-panel {
  padding: 16px 18px;
  border-bottom: 1px solid var(--divider);
  background: var(--row-hover);
}
.create-panel[hidden] { display: none; }
.create-panel .actions { display: flex; gap: 8px; align-items: center; margin-top: 14px; }
.create-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px 16px;
}
.field { display: flex; flex-direction: column; gap: 5px; }
.field label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.input {
  width: 100%;
  padding: 7px 10px;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  outline: none;
}
.input:focus { border-color: var(--accent); }

/* One-time key reveal: the whole reason this page exists, so it is the
   loudest thing on it. */
.reveal {
  padding: 16px 18px;
  border-bottom: 1px solid var(--divider);
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}
.reveal-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.reveal-title { font-size: 13px; font-weight: 650; }
.reveal-note { font-size: 12px; color: var(--text-secondary); margin: 0 0 12px; line-height: 1.55; }
.reveal-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.reveal-saved { font-size: 12px; color: var(--ok); font-weight: 600; }

/* Row layout for each key, used instead of a table: a key has a name, a
   secondary line, and a few figures, which reads better as a list. */
.key-row { align-items: flex-start; }
.key-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 3px;
}
/* Field labels in the key metadata line: muted so the values carry emphasis. */
.key-meta b { font-weight: 500; color: var(--text-tertiary); }
.key-prefix { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 11.5px; }
.key-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.empty-state { padding: 20px 18px; font-size: 13px; color: var(--text-secondary); }

/* ---- request log filters ---- */
.filters { padding: 12px 18px; display: flex; flex-direction: column; gap: 10px; }
.filter-input { max-width: 420px; }
.filters-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.filters-spacer { flex: 1; }
/* Filter chips are toggle buttons, not pills: squared, with a border that
   carries their pressed state rather than a filled capsule. */
.chip {
  appearance: none;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--card-border);
  background: var(--bg);
  color: var(--text-secondary);
  cursor: pointer;
}
.chip[aria-pressed="true"] {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}
.filter-count {
  padding: 8px 18px;
  font-size: 12px;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--divider);
}
/* Second line inside a cell: the diagnostics that used to be dropped. */
.cell-sub { font-size: 11.5px; color: var(--text-tertiary); margin-top: 2px; }
.detail-error { color: var(--warn); font-weight: 600; }
.account-error { color: var(--error); }
/* Keyboard focus ring for row stepping (n / p), distinct from text selection. */
.row-focused { background: var(--row-hover); outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
</head>
<body>

<div id="app"></div>

<script>
(function () {
  'use strict';

  var KEY_STORAGE = 'wkb2api-admin-key';
  /**
   * Mirrors MAX_LOG in src/observability/metrics.ts. The panel states it in
   * prose so an operator knows why a busy gateway's totals exceed the rows
   * listed below them; if the two ever disagree the copy becomes misleading.
   */
  var MAX_LOG = 200;
  var state = {
    key: null,
    overview: null,
    view: 'overview',
    timer: null,
    tick: null,
    unlockError: null,
    oauth: null,
    oauthTimer: null,
    oauthBusy: false,
    oauthMessage: '',
    oauthUrl: '',
    overviewPending: false,
    keys: null,
    newKey: null,
    // Request log: cached entries plus the active filter, so typing filters the
    // last fetch instead of issuing a request per keystroke.
    requests: null,
    reqFilter: '',
    reqStatuses: [],
    // Durable usage window (hours) and its last result or unavailability.
    usageWindow: 24,
    usage: null,
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
    set('stat-retries', fmtInt(s.total_retries || 0) + (s.retry_rate ? ' · ' + fmtPct(s.retry_rate) : ''));

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
      // Keep the failing share of the bar in step with the counts; it is drawn
      // as a child of the fill, so it must exist before it can be sized.
      var errBar = row.querySelector('.bar-errors');
      if (m.errors) {
        var pct = m.count ? Math.round(m.errors / m.count * 100) : 0;
        if (!errBar && fill) {
          errBar = document.createElement('span');
          errBar.className = 'bar-errors';
          fill.appendChild(errBar);
        }
        if (errBar) errBar.style.width = pct + '%';
      } else if (errBar) {
        errBar.remove();
      }
      if (val) {
        val.innerHTML = fmtInt(m.count) + ' req · ' + fmtInt(m.tokens) + ' tok' +
          (m.errors ? ' · <span style="color:var(--error)">' + fmtInt(m.errors) + ' err</span>' : '');
      }
    });
  }

  function startTimer() {
    stopTimer();
    // Two cadences: the data poll stays at 5s, while the cooldown countdown is
    // a purely local label that needs to tick every second to look alive.
    state.timer = setInterval(function () {
      refreshOverview().catch(function () {});
      // Tail the log only while it is on screen, and silently so a refresh
      // cannot interrupt someone typing into the filter.
      if (state.view === 'requests') loadRequests(true);
    }, 5000);
    state.tick = setInterval(function () {
      if (state.view === 'upstream') tickCooldowns();
    }, 1000);
  }
  function stopTimer() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    if (state.tick) { clearInterval(state.tick); state.tick = null; }
  }

  // ---------- formatting ----------
  function fmtInt(n) { return (n || 0).toLocaleString(); }
  function fmtPct(x) { return (x * 100).toFixed(1) + '%'; }
  function fmtMs(n) { return n == null ? '-' : (n >= 1000 ? (n / 1000).toFixed(1) + ' s' : Math.round(n) + ' ms'); }
  function fmtUptime(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm ' + (s % 60) + 's';
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }
  /**
   * Lifespan-aware stamp for records that can be days old. fmtTime shows only
   * a clock reading, which is fine inside one request-log burst but reads as
   * today's time on a key created last week, so anything older than a day
   * carries its date too.
   */
  function fmtStamp(ts) {
    if (ts == null) return 'never';
    var d = new Date(ts);
    // A malformed persisted line should not print "Invalid Date" in the table.
    if (isNaN(d.getTime())) return '-';
    var sameDay = d.toDateString() === new Date().toDateString();
    if (sameDay) return d.toLocaleTimeString(undefined, { hour12: false });
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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
      '<p>Enter the gateway API key. It is the same Bearer key used for the /v1 endpoints, and it is stored in this browser only.</p>' +
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

    if (state.view === 'overview') { main.innerHTML = viewOverview(d); wireUsageCard(); loadUsage(); }
    else if (state.view === 'models') main.innerHTML = viewModels(d);
    else if (state.view === 'requests') { main.innerHTML = viewRequestsShell(); wireRequestFilters(); loadRequests(); }
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
        // The error portion of each bar is drawn over the request bar, so a
        // model with failures is visible as failures rather than only volume.
        var errPct = m.count ? Math.round((m.errors || 0) / m.count * 100) : 0;
        return '<div class="row" data-mkey="' + escapeHtml(m.model) + '">' +
          '<div class="row-main"><div class="row-title">' + escapeHtml(m.model) + '</div>' +
          '<div class="bar-track">' +
          '<div class="bar-fill" style="width:' + (maxCount ? Math.round(m.count / maxCount * 100) : 0) + '%">' +
          (m.errors ? '<span class="bar-errors" style="width:' + errPct + '%"></span>' : '') +
          '</div></div></div>' +
          '<div class="row-value">' + fmtInt(m.count) + ' req · ' + fmtInt(m.tokens) + ' tok' +
          (m.errors ? ' · <span style="color:var(--error)">' + fmtInt(m.errors) + ' err</span>' : '') +
          '</div></div>';
      }).join('');

    var errorCodes = (s.error_codes || []).length
      ? s.error_codes.map(function (e) {
        return '<div class="row"><div class="row-main"><div class="row-title">' + escapeHtml(e.code) + '</div></div>' +
          '<div class="row-value">' + fmtInt(e.count) + '</div></div>';
      }).join('')
      : '<div class="row"><div class="row-main"><div class="row-title" style="color:var(--text-tertiary)">No errors recorded</div></div></div>';

    return '<section class="section"><h2>Overview</h2>' +
      '<p class="page-sub">Gateway up ' + fmtUptime(s.uptime_ms) + '.' +
      (d.started_at ? ' Started ' + escapeHtml(fmtStamp(d.started_at)) + '.' : '') +
      ' These figures count only the current run and return to zero after a restart or redeploy, ' +
      'so use Durable totals below for numbers that survive one. The log keeps the most recent ' + MAX_LOG + '.</p>' +
      '<div class="stat-grid">' +
      statTile('Requests since restart', fmtInt(s.total_requests), '', 'stat-total') +
      statTile('Error rate since restart', fmtPct(s.error_rate), s.error_rate > 0.05 ? 'bad' : 'ok', 'stat-errors') +
      statTile('P95 latency', fmtMs(s.p95_ms), '', 'stat-p95') +
      statTile('Tokens since restart', fmtInt(s.tokens.prompt + s.tokens.completion), '', 'stat-tokens') +
      statTile('Retries since restart', fmtInt(s.total_retries || 0) + (s.retry_rate ? ' · ' + fmtPct(s.retry_rate) : ''), '', 'stat-retries') +
      '</div>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">Calls by model</h3>' +
      '<span class="card-note">this run · bar shows request volume, red is the failing share</span></div>' +
      '<div class="rows">' + modelRows + '</div></div>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">Error codes</h3>' +
      '<span class="card-note">this run</span></div>' +
      '<div class="rows">' + errorCodes + '</div></div>' +
      usageCard() +
      '</section>';
  }

  /**
   * Durable usage over a rolling window.
   *
   * The tiles above reset whenever the process restarts, which is exactly the
   * moment an operator wants a number that did not. These come from the
   * database, so they survive a redeploy. The card renders its own loading and
   * unavailable states rather than zeros, because on the file backend the
   * question has no answer and saying "0" would be a lie.
   */
  function usageCard() {
    // The body is painted by renderUsageBody/renderUsageRows; the initial
    // markup is the same loading row so the first paint and every refetch agree.
    var u = state.usage;
    var body;
    if (u && u.unavailable) {
      body = '<div class="rows"><div class="row"><div class="row-main">' +
        '<div class="row-sub">' + escapeHtml(u.unavailable) + '</div></div></div></div>';
    } else if (u && u.data) {
      var scratch = document.createElement('div');
      renderUsageRows(scratch, u);
      body = scratch.innerHTML;
    } else {
      body = '<div class="rows"><div class="row"><div class="row-main"><div class="row-sub">Loading…</div></div></div></div>';
    }
    var note = u && u.data && u.windowHours
      ? 'survives restarts · last ' + u.windowHours + 'h'
      : 'survives restarts';
    var seg = [24, 168].map(function (h) {
      var label = h === 24 ? '24 hours' : '7 days';
      var on = state.usageWindow === h;
      return '<button class="seg-btn' + (on ? ' active' : '') + '" data-usage-window="' + h + '" role="tab" aria-selected="' + on + '">' + label + '</button>';
    }).join('');
    return '<div class="card"><div class="card-header"><h3 class="card-title">Durable totals</h3>' +
      '<div class="controls">' +
      '<div class="seg" role="tablist">' + seg + '</div>' +
      '<span class="card-note">' + escapeHtml(note) + '</span>' +
      '</div></div>' +
      '<div id="usage-body">' + body + '</div>' +
      (u && u.reason ? '<div class="card-footer"><div class="footer-note">' + escapeHtml(u.reason) + '</div></div>' : '') +
      '</div>';
  }

  function loadUsage() {
    var hours = state.usageWindow;
    var host = $('#usage-body');
    if (host) host.innerHTML = '<div class="rows"><div class="row"><div class="row-main"><div class="row-sub">Loading…</div></div></div></div>';
    return api('usage?window=' + hours).then(function (d) {
      state.usage = { data: d, windowHours: hours };
      renderUsageBody();
      return null;
    }).catch(function (err) {
      // The file backend genuinely cannot answer this, so the reason is shown
      // verbatim instead of a zero that would read as "no usage".
      state.usage = {
        unavailable: err.message || 'Durable usage is not available on this backend.',
        reason: err.code === 'internal_error' ? 'Set WKB2API_STORAGE_BACKEND=postgres to enable durable totals.' : '',
      };
      renderUsageBody();
      return null;
    });
  }

  /** Repaint only the usage card, so a refresh cannot disturb the rest. */
  function renderUsageBody() {
    var host = $('#usage-body');
    if (!host) return;
    var u = state.usage;
    if (!u) { host.innerHTML = '<div class="rows"><div class="row"><div class="row-main"><div class="row-sub">Loading…</div></div></div></div>'; return; }
    if (u.unavailable) {
      host.innerHTML = '<div class="rows"><div class="row"><div class="row-main">' +
        '<div class="row-sub">' + escapeHtml(u.unavailable) + '</div></div></div></div>';
      var foot = host.parentNode && host.parentNode.querySelector('.footer-note');
      if (!foot && u.reason && host.parentNode) {
        var node = document.createElement('div');
        node.className = 'card-footer';
        node.innerHTML = '<div class="footer-note">' + escapeHtml(u.reason) + '</div>';
        host.parentNode.appendChild(node);
      }
      return;
    }
    renderUsageRows(host, u);
  }

  /** The rows themselves, shared by first paint and refetch. */
  function renderUsageRows(host, u) {
    var d = u.data;
    if (!d || !d.requests) {
      host.innerHTML = '<div class="rows"><div class="row"><div class="row-main">' +
        '<div class="row-sub">No requests recorded in this window.</div></div></div></div>';
      return;
    }
    var rows = [
      ['Requests', fmtInt(d.requests)],
      ['Errors', fmtInt(d.errors || 0)],
      ['Tokens', fmtInt((d.prompt_tokens || 0) + (d.completion_tokens || 0))],
    ].map(function (pair) {
      return '<div class="row"><div class="row-main"><div class="row-title">' + pair[0] + '</div></div>' +
        '<div class="row-value">' + pair[1] + '</div></div>';
    }).join('');
    var models = (d.per_model || []).slice(0, 5).map(function (m) {
      return '<div class="row"><div class="row-main"><div class="row-title">' + escapeHtml(m.model) + '</div></div>' +
        '<div class="row-value">' + fmtInt(m.requests) + ' req · ' + fmtInt(m.tokens) + ' tok</div></div>';
    }).join('');
    host.innerHTML = '<div class="rows">' + rows + models + '</div>';
  }

  function wireUsageCard() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-usage-window]'), function (btn) {
      btn.addEventListener('click', function () {
        var hours = Number(btn.getAttribute('data-usage-window'));
        if (hours === state.usageWindow) return;
        state.usageWindow = hours;
        Array.prototype.forEach.call(document.querySelectorAll('[data-usage-window]'), function (b) {
          var on = Number(b.getAttribute('data-usage-window')) === hours;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        state.usage = null;
        loadUsage();
      });
    });
  }

  function viewModels(d) {
    var rows = d.models.map(function (m) {
      var x = m.x_workbuddy || {};
      var tags = [];
      if (x.is_default) tags.push('<span class="pill neutral">default</span>');
      if (x.supports_tool_call) tags.push('tool');
      if (x.supports_images) tags.push('vision');
      var maxIn = x.max_input_tokens ? (x.max_input_tokens >= 1000000 ? (x.max_input_tokens / 1000000) + 'M' : Math.round(x.max_input_tokens / 1000) + 'K') : '-';
      var maxOut = x.max_output_tokens ? (x.max_output_tokens >= 1000 ? Math.round(x.max_output_tokens / 1000) + 'K' : x.max_output_tokens) : '-';
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
    return '<section class="section">' +
      '<div class="page-head">' +
        '<div>' +
          '<h2>API Keys</h2>' +
          '<p class="page-sub">Keys authenticate <code>/v1</code> requests and this console. Only a hash is stored, so a lost key cannot be recovered. Revoke it and issue a new one.</p>' +
        '</div>' +
        '<button class="btn" id="key-new" aria-expanded="false" aria-controls="key-create-panel">Create key</button>' +
      '</div>' +
      '<div class="card" id="key-card">' +
        '<div class="create-panel" id="key-create-panel" hidden>' +
          '<div class="create-grid">' +
            '<div class="field"><label for="key-name">Name</label>' +
            '<input class="input" id="key-name" type="text" placeholder="laptop, ci, teammate" autocomplete="off"></div>' +
            '<div class="field"><label for="key-note">Note (optional)</label>' +
            '<input class="input" id="key-note" type="text" placeholder="What this key is for" autocomplete="off"></div>' +
          '</div>' +
          '<label class="check"><input type="checkbox" id="key-admin"> <span>Allow this key to manage the gateway (accounts, keys, settings)</span></label>' +
          '<div class="actions">' +
            '<button class="btn" id="key-create">Create key</button>' +
            '<button class="btn btn-ghost" id="key-cancel">Cancel</button>' +
          '</div>' +
          '<div id="key-error" class="form-error"></div>' +
        '</div>' +
        '<div id="key-banner"></div>' +
        '<div id="key-body"><div class="empty-state">Loading</div></div>' +
      '</div>' +
      '</section>';
  }

  function loadKeys() {
    var create = $('#key-create');
    if (create) create.addEventListener('click', createKey);
    var toggle = $('#key-new');
    if (toggle) toggle.addEventListener('click', function () { setCreateOpen(toggle.getAttribute('aria-expanded') !== 'true'); });
    var cancel = $('#key-cancel');
    if (cancel) cancel.addEventListener('click', function () { setCreateOpen(false); });
    var name = $('#key-name');
    if (name) name.addEventListener('keydown', function (e) { if (e.key === 'Enter') createKey(); });
    return api('keys').then(function (d) {
      state.keys = d;
      renderKeyBanner();
      renderKeyList();
    }).catch(function () {});
  }

  /**
   * The create form is collapsed until asked for: an operator visiting this page
   * is usually checking or revoking a key, not making one.
   */
  function setCreateOpen(open) {
    var panel = $('#key-create-panel');
    var toggle = $('#key-new');
    if (!panel) return;
    panel.hidden = !open;
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      var name = $('#key-name');
      if (name) name.focus();
    } else {
      var err = $('#key-error');
      if (err) err.textContent = '';
    }
  }

  /** The one-time reveal, shown above the list after a successful create. */
  function renderKeyBanner() {
    var host = $('#key-banner');
    if (!host) return;
    if (!state.newKey) { host.innerHTML = ''; return; }
    // Offer the two shapes the value is actually pasted into, but only while the
    // plaintext exists: after dismissal nothing here can honour a copy.
    host.innerHTML = '<div class="reveal">' +
      '<div class="reveal-head"><span class="reveal-title">Copy this key now</span>' +
      '<span class="pill warn">shown once</span></div>' +
      '<p class="reveal-note">' + escapeHtml(state.newKey.warning) + '</p>' +
      '<div class="secret-row"><code id="new-key-value">' + escapeHtml(state.newKey.key) + '</code>' +
      '<button class="btn" id="key-copy">Copy</button>' +
      '<button class="btn btn-ghost" id="key-dismiss">Dismiss</button></div>' +
      '<div class="reveal-actions">' +
      '<button class="btn secondary" id="key-copy-header">Copy as Authorization header</button>' +
      '<button class="btn secondary" id="key-copy-curl">Copy as curl</button>' +
      '<span class="reveal-saved" id="key-copied-note" role="status" aria-live="polite"></span>' +
      '</div>' +
      '</div>';

    function copyText(text, label) {
      var note = $('#key-copied-note');
      var show = function (ok) {
        if (note) note.textContent = ok ? label + ' copied' : 'Copy failed. Select the key and copy it manually.';
        setTimeout(function () { if (note) note.textContent = ''; }, 2000);
      };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () { show(true); }).catch(function () { show(false); });
      } else {
        show(false);
      }
    }

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
    var header = $('#key-copy-header');
    if (header) header.addEventListener('click', function () {
      copyText('Authorization: Bearer ' + (state.newKey ? state.newKey.key : ''), 'Header');
    });
    var curl = $('#key-copy-curl');
    if (curl) curl.addEventListener('click', function () {
      var base = window.location.origin;
      // Built from parts so the JSON body never needs escaped quotes nested
      // inside the surrounding string literal.
      var body = JSON.stringify({ model: 'wb-2', messages: [{ role: 'user', content: 'hello' }] });
      var token = state.newKey ? state.newKey.key : '';
      copyText(
        'curl ' + base + '/v1/chat/completions \\\n' +
        '  -H "Authorization: Bearer ' + token + '" \\\n' +
        '  -H "Content-Type: application/json" \\\n' +
        '  -d ' + "'" + body + "'",
        'curl command');
    });
    var dismiss = $('#key-dismiss');
    if (dismiss) dismiss.addEventListener('click', function () { state.newKey = null; renderKeyBanner(); });
  }

  /**
   * Keys render as rows rather than table columns: each key carries a name, an
   * optional note, and four short figures, which a six-column table could only
   * fit by overflowing on every narrower window.
   */
  function renderKeyList() {
    var body = $('#key-body');
    if (!body || !state.keys) return;

    function figures(k) {
      // Usage is joined server-side (the panel never sees a key hash). Absent
      // or null means no traffic was recorded, which is reported as such rather
      // than as a zero that would read like disuse.
      var usage = k.usage
        ? '<span><b>Tokens</b> ' + escapeHtml(fmtInt(k.usage.total_tokens)) + '</span>'
        : '';
      var recorded = k.usage
        ? ''
        : '<span class="muted">no recorded usage</span>';
      return '<div class="key-meta">' +
        '<span><b>Prefix</b> <code class="key-prefix">' + escapeHtml(k.prefix) + '</code></span>' +
        '<span><b>Requests</b> ' + escapeHtml(String(k.request_count)) + '</span>' +
        usage +
        '<span><b>Last used</b> ' + escapeHtml(fmtStamp(k.last_used_at)) + '</span>' +
        '<span><b>Created</b> ' + escapeHtml(fmtStamp(k.created_at)) + '</span>' +
        recorded +
        '</div>';
    }

    var rows = state.keys.keys.map(function (k) {
      var badge = k.admin
        ? '<span class="badge badge-admin">admin</span>'
        : '<span class="badge">api</span>';
      return '<div class="row key-row' + (k.id === state.keys.just_created ? ' row-new' : '') + '">' +
        '<div class="row-main">' +
          '<div class="row-title">' + escapeHtml(k.name) + ' ' + badge + '</div>' +
          (k.note ? '<div class="row-sub">' + escapeHtml(k.note) + '</div>' : '') +
          figures(k) +
        '</div>' +
        '<div class="key-actions">' +
          '<button class="btn btn-ghost btn-danger" data-revoke="' + escapeHtml(k.id) + '" data-name="' + escapeHtml(k.name) + '">Revoke</button>' +
        '</div>' +
        '</div>';
    }).join('');

    // The env key is not a stored record and cannot be revoked, so it is
    // labelled rather than given a disabled button that would invite a click.
    var bootstrap = '<div class="row key-row">' +
      '<div class="row-main">' +
        '<div class="row-title">' + escapeHtml(state.keys.bootstrap_key.name) + ' <span class="badge badge-admin">admin</span></div>' +
        '<div class="row-sub">' + escapeHtml(state.keys.bootstrap_key.note) + '</div>' +
        '<div class="key-meta">' +
          '<span><b>Source</b> environment variable</span>' +
          '<span><b>Revoke</b> not possible from here</span>' +
          (state.keys.bootstrap_key.usage_note
            ? '<span class="muted">' + escapeHtml(state.keys.bootstrap_key.usage_note) + '</span>'
            : '') +
        '</div>' +
      '</div>' +
      '</div>';

    var list = rows || '<div class="empty-state">No keys yet. Create one to authenticate a client.</div>';
    body.innerHTML = '<div class="rows">' + list + bootstrap + '</div>';

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

    var submit = $('#key-create');
    if (submit) submit.disabled = true;

    api('keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (created) {
        state.newKey = created;
        state.keys && (state.keys.just_created = created.id);
        if (nameEl) nameEl.value = '';
        if (noteEl) noteEl.value = '';
        if (adminEl) adminEl.checked = false;
        // Collapse on success: the reveal above the list is the next thing to
        // act on, and leaving the form open invites a duplicate submission.
        setCreateOpen(false);
        return loadKeys();
      })
      .catch(function (err) {
        // Keys are unique by name, so a rejected create is usually something the
        // operator needs to fix and resubmit. Reopen so the fields stay in reach.
        setCreateOpen(true);
        if (errorEl) errorEl.textContent = err.message || 'Could not create the key.';
      })
      .then(function () {
        var btn = $('#key-create');
        if (btn) btn.disabled = false;
      });
  }

  function viewRequestsShell() {
    return '<section class="section">' +
      '<div class="page-head"><div><h2>Requests</h2>' +
      '<p class="page-sub">Newest first. The in-memory buffer holds ' + MAX_LOG + ' entries and is cleared on restart.</p></div></div>' +
      '<div class="card"><div class="filters">' +
      '<input class="input filter-input" id="req-filter" type="search" placeholder="Filter by path, model, status or error code" autocomplete="off" aria-label="Filter requests">' +
      '<div class="filters-row">' +
      '<button class="chip" data-status="ok" aria-pressed="false">2xx</button>' +
      '<button class="chip" data-status="client" aria-pressed="false">4xx</button>' +
      '<button class="chip" data-status="server" aria-pressed="false">5xx</button>' +
      '<button class="chip" data-status="retried" aria-pressed="false">Retried</button>' +
      '<button class="chip" data-status="failed" aria-pressed="false">Errors only</button>' +
      '<span class="filters-spacer"></span>' +
      '<button class="btn btn-ghost" id="req-clear" hidden>Clear filter</button>' +
      '</div>' +
      '</div></div>' +
      '<div class="card" id="req-card"><div id="req-body"><div class="empty-state">Loading</div></div></div>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">Persisted history</h3>' +
      '<span class="card-note" id="history-note">Disabled until loaded</span></div>' +
      '<div class="rows"><div class="row"><div class="row-main"><div class="row-sub">The buffer above is lost on restart. Load the on-disk log to see requests recorded before the last restart.</div></div>' +
      '<button class="btn secondary" id="history-load">Load history</button></div></div>' +
      '<div id="history-body"></div>' +
      '</div>' +
      '</section>';
  }

  /** Status colouring shared by the in-memory table and the persisted list. */
  function statusCell(status) {
    if (status >= 500) return '<span style="color:var(--error);font-weight:600">' + status + '</span>';
    if (status >= 400) return '<span style="color:var(--warn);font-weight:600">' + status + '</span>';
    if (status < 300) return '<span style="color:var(--ok);font-weight:600">' + status + '</span>';
    return '<span class="muted">' + status + '</span>';
  }

  /**
   * The extra detail a failed or retried request carries. Every field here is
   * already recorded by the gateway; the panel previously dropped them, which
   * left a bare status number as the only clue to what went wrong.
   */
  function requestDetail(r) {
    var parts = [];
    if (r.error_class || r.error_code) {
      parts.push('<span class="detail-error">' + escapeHtml([r.error_class, r.error_code].filter(Boolean).join(' · ')) + '</span>');
    }
    // A rejected key cannot be named (it is not in the registry), so the prefix
    // is shown for comparison against the key list. Its absence means the
    // request carried no credential at all, which is a different fix.
    if (r.status === 401 && r.error_code === 'invalid_api_key') {
      parts.push(r.key_prefix
        ? 'presented key ' + escapeHtml(r.key_prefix) + '… does not match any stored key'
        : 'no key presented');
    }
    if (r.retries > 0) parts.push(escapeHtml(r.retries === 1 ? 'after 1 retry' : 'after ' + r.retries + ' retries'));
    if (r.account) parts.push('via ' + escapeHtml(r.account));
    return parts.length ? '<div class="cell-sub">' + parts.join(' · ') + '</div>' : '';
  }

  function requestRows(entries) {
    return entries.map(function (r) {
      // data-label feeds the stacked layout on narrow screens, where the header
      // row is hidden and each cell carries its own heading.
      return '<tr><td data-label="Time">' + fmtTime(r.time) + '</td>' +
        '<td class="path" data-label="Request">' + escapeHtml(r.method + ' ' + r.path) +
        (r.model ? ' <span class="muted">· ' + escapeHtml(r.model) + (r.stream ? ' · stream' : '') + '</span>' : '') + '</td>' +
        '<td data-label="Status">' + statusCell(r.status) + requestDetail(r) + '</td>' +
        '<td data-label="tok in/out">' + fmtTokens(r) + '</td>' +
        '<td data-label="Duration">' + fmtMs(r.duration_ms) + '</td></tr>';
    }).join('');
  }

  function fmtTokens(r) {
    var has = r.prompt_tokens || r.completion_tokens;
    return has ? (r.prompt_tokens || 0) + ' / ' + (r.completion_tokens || 0) : '<span class="muted">-</span>';
  }

  /** Does one entry survive the current filter text and status chips? */
  function matchesFilter(r, text, statuses) {
    if (statuses.length) {
      var group = r.status >= 500 ? 'server' : r.status >= 400 ? 'client' : r.status < 300 ? 'ok' : 'other';
      var ok = statuses.indexOf(group) !== -1
        || (statuses.indexOf('retried') !== -1 && r.retries > 0)
        || (statuses.indexOf('failed') !== -1 && r.status >= 400);
      if (!ok) return false;
    }
    if (!text) return true;
    var hay = [r.method, r.path, r.model, r.status, r.error_code, r.error_class, r.account]
      .filter(function (v) { return v != null && v !== ''; }).join(' ').toLowerCase();
    return hay.indexOf(text.toLowerCase()) !== -1;
  }

  /**
   * Re-render the table from the cached entries.
   *
   * Filtering happens here rather than in the fetch so typing never triggers a
   * request, and so the same render path serves both the first load and every
   * later refresh.
   */
  function renderRequests() {
    var body = $('#req-body');
    if (!body) return;
    var entries = state.requests;
    if (!entries) { body.innerHTML = '<div class="empty-state">Loading</div>'; return; }
    if (!entries.length) {
      body.innerHTML = '<div class="empty-state">No requests recorded yet.</div>';
      return;
    }
    var text = state.reqFilter.trim();
    var statuses = state.reqStatuses;
    var shown = entries.filter(function (r) { return matchesFilter(r, text, statuses); });
    var clear = $('#req-clear');
    if (clear) clear.hidden = !text && statuses.length === 0;
    if (!shown.length) {
      // Distinct from "nothing recorded": the log has entries, the filter
      // excludes them, and saying so avoids looking like a broken page.
      body.innerHTML = '<div class="empty-state">No requests match this filter. ' +
        '<button class="btn btn-ghost" id="req-clear-2">Clear filter</button></div>';
      var inner = $('#req-clear-2');
      if (inner) inner.addEventListener('click', clearRequestFilter);
      return;
    }
    var count = '<div class="filter-count">' + shown.length + ' of ' + entries.length + ' shown</div>';
    // Write into #req-body, not the card: overwriting the card would destroy
    // the #req-body element itself and break every later refresh.
    body.innerHTML = count + '<div class="table-wrap"><table><thead><tr>' +
      '<th>Time</th><th>Request</th><th>Status</th><th>tok in/out</th><th>Duration</th>' +
      '</tr></thead><tbody>' + requestRows(shown) + '</tbody></table></div>';
  }

  function clearRequestFilter() {
    state.reqFilter = '';
    state.reqStatuses = [];
    var input = $('#req-filter');
    if (input) input.value = '';
    var chips = document.querySelectorAll('.chip[data-status]');
    Array.prototype.forEach.call(chips, function (c) { c.setAttribute('aria-pressed', 'false'); c.classList.remove('active'); });
    renderRequests();
  }

  function loadRequests(silent) {
    return api('requests').then(function (d) {
      state.requests = d.recent || [];
      // A live refresh must not yank text out from under someone mid-type.
      if (silent && document.activeElement && document.activeElement.id === 'req-filter') return;
      renderRequests();
    }).catch(function () {});
  }

  function wireRequestFilters() {
    var input = $('#req-filter');
    if (input) {
      input.value = state.reqFilter;
      input.addEventListener('input', function () { state.reqFilter = input.value; renderRequests(); });
    }
    var clear = $('#req-clear');
    if (clear) clear.addEventListener('click', clearRequestFilter);
    Array.prototype.forEach.call(document.querySelectorAll('.chip[data-status]'), function (chip) {
      var key = chip.getAttribute('data-status');
      var on = state.reqStatuses.indexOf(key) !== -1;
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) chip.classList.add('active');
      chip.addEventListener('click', function () {
        var at = state.reqStatuses.indexOf(key);
        if (at === -1) state.reqStatuses.push(key); else state.reqStatuses.splice(at, 1);
        chip.setAttribute('aria-pressed', at === -1 ? 'true' : 'false');
        chip.classList.toggle('active', at === -1);
        renderRequests();
      });
    });
    var load = $('#history-load');
    if (load) load.addEventListener('click', loadHistory);
  }

  /**
   * The durable log. It is deliberately a separate, explicit action rather than
   * part of the page load: on the file backend, or with persistence switched
   * off, the endpoint answers 503, and that is a normal state the operator
   * should be told about plainly rather than shown an error card for.
   */
  function loadHistory() {
    var host = $('#history-body');
    var note = $('#history-note');
    if (!host) return;
    host.innerHTML = '<div class="empty-state">Loading history</div>';
    api('telemetry?limit=200&kind=request').then(function (d) {
      if (note) note.textContent = d.count + ' event(s) from the ' + d.backend + ' backend' + (d.path ? ' at ' + d.path : '');
      if (!d.events || !d.events.length) {
        host.innerHTML = '<div class="empty-state">The persisted log is empty.</div>';
        return;
      }
      // Newest first, matching the live table above. Events are tagged by kind:
      // request records mirror the live rows, pool events record account
      // changes so a restart sits in the same timeline as its cause.
      var entries = d.events.slice().reverse();
      host.innerHTML = '<div class="table-wrap"><table><thead><tr>' +
        '<th>Time</th><th>Kind</th><th>Detail</th></tr></thead><tbody>' +
        entries.map(function (e) { return historyRow(e); }).join('') + '</tbody></table></div>';
    }).catch(function (err) {
      if (note) note.textContent = 'Not available';
      host.innerHTML = '<div class="empty-state">' + escapeHtml(err.message || 'Could not load the persisted log.') + '</div>';
    });
  }

  function historyRow(e) {
    if (!e || typeof e !== 'object') {
      return '<tr><td data-label="Time">-</td><td data-label="Kind">unknown</td><td data-label="Detail">-</td></tr>';
    }
    if (e.kind === 'pool') {
      var p = e.record || {};
      var who = p.label ? p.label + ' ' : '';
      return '<tr><td data-label="Time">' + fmtStamp(Date.parse(p.time) || null) + '</td>' +
        '<td data-label="Kind"><span class="badge">pool</span></td>' +
        '<td data-label="Detail">' + escapeHtml(who + (p.event || '') + (p.detail ? ' · ' + p.detail : '')) + '</td></tr>';
    }
    var r = (e.record || {});
    return '<tr><td data-label="Time">' + fmtStamp(Date.parse(r.time) || null) + '</td>' +
      '<td data-label="Kind"><span class="badge">request</span></td>' +
      '<td class="path" data-label="Detail">' + escapeHtml(r.method + ' ' + r.path) +
      (r.model ? ' <span class="muted">· ' + escapeHtml(r.model) + '</span>' : '') +
      ' ' + statusCell(r.status) + requestDetail(r) + '</td></tr>';
  }

  /** The health record matching a pool label, when the panel has one. */
  function healthFor(health, label) {
    if (!health || !health.accounts) return null;
    for (var i = 0; i < health.accounts.length; i++) {
      if (health.accounts[i].label === label) return health.accounts[i];
    }
    return null;
  }

  /**
   * One account row. The availability tag alone could not explain itself: an
   * account cooling down from a 401 and one that simply has not been used
   * looked identical, so the recorded error and the remaining cooldown are
   * shown alongside it.
   */
  function accountRow(a, h) {
    var tag = 'available';
    var tone = 'ok';
    if (h && h.state === 'reauth_required') { tag = 'sign-in required'; tone = 'error'; }
    else if (h && h.state === 'cooling_down') { tag = 'cooling down'; tone = 'warn'; }
    else if (!a.ok) { tag = 'unavailable'; tone = 'warn'; }

    var detail = '<div class="row-sub">' + escapeHtml(a.detail) + '</div>';
    if (h && (h.last_error || h.failures)) {
      var bits = [];
      if (h.failures) bits.push(h.failures + (h.failures === 1 ? ' failure' : ' failures'));
      if (h.last_error) bits.push(h.last_error);
      if (h.last_failure_at) bits.push('last at ' + fmtStamp(h.last_failure_at));
      detail += '<div class="row-sub account-error">' + escapeHtml(bits.join(' · ')) + '</div>';
    }
    // Counted down client-side from the server's remainder, then re-synced on
    // each poll. Rendered only when the server actually reports a cooldown, so
    // it can never show a countdown for an account that is not cooling down.
    if (h && h.cooldown_remaining_ms) {
      detail += '<div class="row-sub" data-cooldown-until="' + (Date.now() + h.cooldown_remaining_ms) + '">' +
        'retrying in ' + Math.ceil(h.cooldown_remaining_ms / 1000) + 's</div>';
    }
    return '<div class="row">' +
      '<div class="row-main"><div class="row-title">' + escapeHtml(a.label) + (a.note ? ' · ' + escapeHtml(a.note) : '') + '</div>' +
      detail + '</div>' +
      '<span class="pill ' + tone + '">' + tag + '</span>' +
      '<button class="btn secondary acct-remove" data-label="' + escapeHtml(a.label) + '" style="padding:4px 10px;font-size:12px">Remove</button>' +
      '</div>';
  }

  /** Tick the countdowns between polls so they do not sit frozen for 5s. */
  function tickCooldowns() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-cooldown-until]'), function (el) {
      var until = Number(el.getAttribute('data-cooldown-until'));
      var left = until - Date.now();
      if (left <= 0) { el.textContent = 'cooldown elapsed, retrying on next request'; return; }
      el.textContent = 'retrying in ' + Math.ceil(left / 1000) + 's';
    });
  }

  function viewUpstream(d) {    var c = d.credential;
    var u = d.upstream;
    var pool = d.pool || { size: 0, strategy: 'round-robin', accounts: [] };
    var stratName = pool.strategy === 'random' ? 'random' : 'round-robin';
    // Declared before the rows are built: accountRow reads it for cooldown and
    // failure detail.
    var health = pool.health;

    var acctRows = pool.accounts.map(function (a) { return accountRow(a, healthFor(health, a.label)); }).join('');
    if (pool.size === 0) {
      acctRows = '<div class="row"><div class="row-main"><div class="row-title" style="color:var(--text-tertiary)">Account pool is empty. Falling back to the single account in the local credential file.</div></div></div>';
    }

    // Pool readiness banner. "Size > 0" is not the same as "usable": every
    // account can be cooling down or need a fresh web login, and the previous
    // panel showed a green dot in that state.
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
      '<p class="form-hint" id="oauth-status" role="status" aria-live="polite">The result appears here automatically. No refresh needed.</p>' +
      '<a id="oauth-link" class="form-hint" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" hidden>Open the official sign-in page</a>' +
      '<p class="form-hint">Accounts are stored encrypted and restored automatically after a gateway restart, so you do not need to sign in again.</p>' +
      '</div></div>' +
      '<div class="card"><div class="card-header"><h3 class="card-title">Pool status</h3><span class="pill ' + (c.ok ? 'ok' : 'error') + '">' + (c.ok ? 'available' : 'unavailable') + '</span></div>' +
      '<div class="rows">' +
      '<div class="row"><div class="row-main"><div class="row-title">Source</div></div><div class="row-value">' + escapeHtml(c.source) + '</div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">Credential status</div><div class="row-sub">' + escapeHtml(c.ok ? c.detail : 'Account pool is empty. Sign in to WorkBuddy.') + '</div></div></div>' +
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

  /**
   * Keyboard shortcuts for the two things an operator does most: jump to the
   * key filter, and step through keys.
   *
   * Every shortcut is suppressed while focus is in a text field or a form
   * control that consumes the keystroke, so typing a key name can never be
   * mistaken for a command.
   */
  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return el.isContentEditable === true;
  }

  function wireShortcuts() {
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var typing = isTypingTarget(document.activeElement);

      if (e.key === 'Escape') {
        if (state.view === 'requests' && (state.reqFilter || state.reqStatuses.length)) {
          clearRequestFilter();
          e.preventDefault();
        }
        return;
      }
      // "/" focuses the filter from anywhere outside a field. preventDefault
      // stops the browser's quick-find from opening instead.
      if (e.key === '/' && !typing) {
        var input = $('#req-filter');
        if (input) { input.focus(); e.preventDefault(); }
        return;
      }
      if (typing) return;

      // n / p step a highlight through the visible rows of whichever list is on
      // screen, so a long log can be walked without reaching for the mouse.
      if (e.key === 'n' || e.key === 'p') {
        var rows = document.querySelectorAll('#req-body tbody tr, #key-body .row, #acct-rows .row');
        if (!rows.length) return;
        var current = document.querySelector('.row-focused');
        var at = current ? Array.prototype.indexOf.call(rows, current) : -1;
        var next = e.key === 'n' ? at + 1 : at - 1;
        if (next < 0) next = rows.length - 1;
        if (next >= rows.length) next = 0;
        if (current) current.classList.remove('row-focused');
        rows[next].classList.add('row-focused');
        rows[next].scrollIntoView({ block: 'nearest' });
        e.preventDefault();
      }
    });
  }

  function patchAccountPool(d) {
    var rows = $('#acct-rows');
    if (!rows) return;
    var accounts = d.pool.accounts;
    var health = d.pool.health;
    // Same renderer as the first paint, so a refreshed row carries the same
    // failure and cooldown detail rather than reverting to a bare tag.
    var html = accounts.map(function (a) { return accountRow(a, healthFor(health, a.label)); }).join('')
      || '<div class="row"><div class="row-title">Account pool is empty. Use the button below to sign in.</div></div>';
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
    status.textContent = state.oauthMessage || 'The result appears here automatically. No refresh needed.';
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
        state.oauthMessage = result.status === 'pending' ? 'Waiting for you to finish signing in on the official page…' : 'Authorization received. Confirming the account…';
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
  wireShortcuts();
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
