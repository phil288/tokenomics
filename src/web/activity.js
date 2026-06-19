// ---- Activity feed: per-operation before→after token records ----
// Fetched lazily from /api/activity (NOT via the SSE loop). Each row shows one
// operation: source, label, before→after tokens, and tokens saved — the granular
// "how tokens get saved, op by op" view. Counts + labels only: no tool persists
// the actual prompt/response text, so there is nothing more to show per row.
import { state } from './state.js';
import { ht, timeAgo } from './format.js';
import { rtkInstallPill, headroomHealthPill } from './cards.js';

const SOURCE_META = {
  'rtk': { name: 'RTK', color: 'var(--rtk)' },
  'headroom-compress': { name: 'Headroom · compress', color: 'var(--headroom)' },
  'headroom-proxy': { name: 'Headroom · proxy', color: 'var(--headroom)' },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'rtk', label: 'RTK' },
  { key: 'headroom', label: 'Headroom' },
];

function matchFilter(row, f) {
  if (f === 'rtk') return row.source === 'rtk';
  if (f === 'headroom') return String(row.source).startsWith('headroom');
  return true; // 'all'
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

function infoHtml(info) {
  if (!Array.isArray(info) || !info.length) return '';
  const items = info.map(([k, v]) =>
    `<span class="act-info-item"><span class="act-ik">${esc(k)}</span><span class="act-iv">${esc(v)}</span></span>`
  ).join('');
  return `<div class="act-info">${items}</div>`;
}

// The right-hand figure. For RTK/compress it's a genuine reduction ("saved").
// For Headroom proxy it's the cache-served portion of the resent context — that
// is NOT a dollar saving (the same cached prefix recurs every turn and bills at
// the cache-read rate), so we label it "cached" and drop the minus to avoid the
// phantom-savings impression.
function savedFig(r, saved, p, color) {
  if (r.source === 'headroom-proxy') {
    return `<span class="act-saved" style="color:${color}" title="served from prompt cache this turn — reused context, not a dollar saving (cache reads recur each turn and bill at the cache-read rate)">cached ${ht(saved)} (${Math.round(p)}%)</span>`;
  }
  // RTK only filters commands it has a dedicated filter for; everything else is
  // passed through unchanged (0 saved by design — not a failure). Flag those.
  if (r.source === 'rtk' && saved <= 0) {
    return `<span class="act-saved act-passthrough" title="RTK has no dedicated filter for this command (or there was nothing to compress) — passed through unchanged">passthrough · no filter</span>`;
  }
  return `<span class="act-saved" style="color:${color}">saved ${ht(saved)} (−${Math.round(p)}%)</span>`;
}

// Stable per-row identity so expanded state survives a repaint (timestamp +
// source + label uniquely identify an operation across re-fetches).
function rowKey(r) {
  return `${r.source}|${r.ts || 0}|${r.label}`;
}

function rowHtml(r) {
  const meta = SOURCE_META[r.source] || { name: r.source, color: 'var(--muted)' };
  const before = Number(r.before) || 0;
  const after = Number(r.after) || 0;
  const max = Math.max(before, after, 1);
  const saved = Math.max(0, Number(r.saved) || 0);
  const p = typeof r.pct === 'number' ? r.pct : 0;
  const when = timeAgo(r.ts ? new Date(r.ts).toISOString() : null);
  const hasInfo = Array.isArray(r.info) && r.info.length > 0;
  const key = rowKey(r);
  // default expanded; only collapsed if the user explicitly closed this row
  const open = hasInfo && state.activityOpen[key] !== false;
  return `
    <div class="act-row${hasInfo ? ' has-info' : ''}${open ? ' open' : ''}" data-key="${esc(key)}">
      <div class="act-row-top">
        <span class="act-src" style="color:${meta.color};border-color:${meta.color}55;background:${meta.color}1a">${esc(meta.name)}</span>
        <span class="act-label" title="${esc(r.detail || r.label)}">${esc(r.label)}</span>
        ${hasInfo ? '<span class="act-caret">▸</span>' : ''}
        <span class="act-when">${when}</span>
      </div>
      <div class="act-bars">
        <div class="act-bar-track" title="before ${before} tokens"><span class="act-bar" style="width:${(before / max * 100).toFixed(0)}%;background:var(--muted)"></span></div>
        <div class="act-bar-track" title="after ${after} tokens"><span class="act-bar" style="width:${(after / max * 100).toFixed(0)}%;background:${meta.color}"></span></div>
      </div>
      <div class="act-figs">
        <span class="act-ba">${ht(before)} → <b>${ht(after)}</b></span>
        ${savedFig(r, saved, p, meta.color)}
      </div>
      ${infoHtml(r.info)}
    </div>`;
}

// RTK-install + Headroom-health pills, mirrored from the latest SSE snapshot
// (state.lastStats) so the Activity view shows the same live status as the
// Overview cards. Empty until the first stats frame arrives.
function statusStrip() {
  const s = state.lastStats || {};
  const pills = [
    rtkInstallPill(s.rtk && s.rtk.install),
    headroomHealthPill(s.headroom && s.headroom.health),
  ].filter(Boolean).join('');
  return pills ? `<div class="act-status">${pills}</div>` : '';
}

export function renderActivity(rows, filter) {
  rows = Array.isArray(rows) ? rows : [];
  filter = filter || 'all';
  const chips = FILTERS.map(f =>
    `<button class="rbtn act-filter${f.key === filter ? ' active' : ''}" data-filter="${f.key}">${f.label}</button>`
  ).join('');
  const visible = rows.filter(r => matchFilter(r, filter));
  const body = visible.length
    ? visible.map(rowHtml).join('')
    : '<div class="act-empty">No operations recorded yet.</div>';
  return `
    ${statusStrip()}
    <div class="act-filters">${chips}</div>
    <div class="act-list">${body}</div>`;
}

// Repaint the card from current state (used after a filter change or fetch).
export function paintActivity() {
  const el = document.getElementById('activity');
  if (el) el.innerHTML = renderActivity(state.activity, state.activityFilter);
}

export async function fetchActivity() {
  try {
    const res = await fetch('/api/activity?limit=50');
    state.activity = await res.json();
  } catch (err) {
    console.error('activity fetch failed', err);
    if (!Array.isArray(state.activity)) state.activity = [];
  }
  paintActivity();
}

// Wire the source-filter chips once. Chips are re-rendered on every paint, so we
// delegate from the stable card element rather than binding each button.
export function initActivity() {
  const card = document.getElementById('activity-card');
  if (!card) return;
  card.addEventListener('click', e => {
    const btn = e.target.closest('.act-filter');
    if (btn) { state.activityFilter = btn.dataset.filter; paintActivity(); return; }
    // toggle a row's detail, persisting the choice so a background repaint (60s
    // refresh / tab switch) keeps it as the user left it. Rows are open by
    // default; this records an explicit open/closed override per row.
    const row = e.target.closest('.act-row.has-info');
    if (row) {
      const willOpen = !row.classList.contains('open');
      state.activityOpen[row.dataset.key] = willOpen;
      row.classList.toggle('open', willOpen);
    }
  });
}

// Show a view by name, syncing tab buttons + views. Refreshes the feed when
// Activity is opened (it's not on the SSE loop). No-op for an unknown name.
function activateView(view) {
  const tabs = document.getElementById('dash-tabs');
  if (!tabs) return;
  const btn = tabs.querySelector(`.dash-tab[data-view="${view}"]`);
  if (!btn) return;
  for (const t of tabs.querySelectorAll('.dash-tab')) t.classList.toggle('active', t === btn);
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.dataset.view === view);
  if (view === 'activity') fetchActivity();
}

// Top-level dashboard tabs (Overview / Activity). The active tab is reflected in
// the URL hash (#activity) so a refresh — or a shared link — lands on the same
// view. Clicks update the hash; hashchange (incl. back/forward) drives the view.
export function initDashboardTabs() {
  const tabs = document.getElementById('dash-tabs');
  if (!tabs) return;
  tabs.addEventListener('click', e => {
    const btn = e.target.closest('.dash-tab');
    if (!btn) return;
    location.hash = btn.dataset.view; // hashchange handler does the activation
  });
  window.addEventListener('hashchange', () => activateView(location.hash.slice(1)));
  // restore the view named in the URL on load (defaults to overview)
  activateView(location.hash.slice(1) || 'overview');
}
