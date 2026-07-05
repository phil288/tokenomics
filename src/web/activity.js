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
  'caveman': { name: 'Caveman', color: 'var(--caveman)' },
  'headroom-compress': { name: 'Headroom · compress', color: 'var(--headroom)' },
  'headroom-proxy': { name: 'Headroom · proxy', color: 'var(--headroom)' },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'rtk', label: 'RTK' },
  { key: 'caveman', label: 'Caveman' },
  { key: 'headroom', label: 'Headroom' },
];

function matchFilter(row, f) {
  if (f === 'rtk') return row.source === 'rtk';
  if (f === 'caveman') return row.source === 'caveman';
  if (f === 'headroom') return String(row.source).startsWith('headroom');
  return true; // 'all'
}

// The active source filter is mirrored in the URL (?filter=rtk) so a refresh — or
// a shared link — keeps the same filter. 'all' is the default, so it's dropped
// from the URL to keep it clean. Unknown values fall back to 'all'.
function filterFromUrl() {
  const v = new URLSearchParams(location.search).get('filter');
  return FILTERS.some(f => f.key === v) ? v : 'all';
}

function setFilterInUrl(f) {
  const url = new URL(location.href);
  if (f && f !== 'all') url.searchParams.set('filter', f);
  else url.searchParams.delete('filter');
  history.replaceState(null, '', url); // no new history entry per filter click
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
  if (r.source === 'rtk') {
    // Output bigger than input → RTK's rewrite cost MORE tokens than the
    // original. Net loss, not a passthrough — flag it distinctly (check before
    // the passthrough branch, since RTK records saved=0 for these).
    if (r.after > r.before) {
      const lost = r.after - r.before;
      const lossPct = r.before ? Math.round((lost / r.before) * 100) : 0;
      return `<span class="act-saved act-loss" title="RTK's rewrite produced more tokens than the original command — a net loss">loss +${ht(lost)} (+${lossPct}%)</span>`;
    }
    // Everything else with no reduction was passed through unchanged (0 saved by
    // design — not a failure). Flag those.
    if (saved <= 0) {
      return `<span class="act-saved act-passthrough" title="RTK has no dedicated filter for this command (or there was nothing to compress) — passed through unchanged">passthrough · no filter</span>`;
    }
  }
  return `<span class="act-saved" style="color:${color}">saved ${ht(saved)} (−${Math.round(p)}%)</span>`;
}

// Same query (original_cmd) + same response (rtk_cmd) ran before — compare the
// prior identical run's effective (post-optimization) tokens against now.
// delta ≤ 0 means it consumed the same or fewer tokens this time (good → down).
function repeatHtml(r, after) {
  if (!r.repeat) return '';
  const prev = Number(r.repeat.prevAfter) || 0;
  const delta = Number(r.repeat.delta) || 0;
  const dir = delta > 0 ? 'up' : 'down';
  const sign = delta > 0 ? '+' : (delta < 0 ? '−' : '±');
  const when = r.repeat.prevTs ? timeAgo(new Date(r.repeat.prevTs).toISOString()) : 'earlier';
  return `<div class="act-repeat ${dir}" title="same command + rewrite seen before (previous run ${esc(when)}) — effective tokens then vs now">`
    + `↻ seen before · ${ht(prev)} → <b>${ht(after)}</b> (${sign}${ht(Math.abs(delta))})</div>`;
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
      ${repeatHtml(r, after)}
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

// Full-history RTK tally (from /api/activity's `rtk` field, computed over the
// whole history.db — not just the loaded rows). gain = tokens RTK removed;
// loss = tokens it added on commands whose rewrite grew the output; net = gain−loss.
function rtkTotalsBar() {
  const t = state.rtkTotals;
  if (!t || (!t.gain && !t.loss)) return '';
  const net = Number(t.net) || 0;
  const netDir = net > 0 ? 'down' : (net < 0 ? 'up' : '');
  const netSign = net > 0 ? '−' : (net < 0 ? '+' : '±');
  return `<div class="act-totals" title="RTK over full history: ${ht(t.gainCmds || 0)} commands saved tokens, ${ht(t.lossCmds || 0)} cost more than the original">`
    + `<span class="act-total-lbl">RTK lifetime</span>`
    + `<span class="act-total gain">saved ${ht(t.gain || 0)}</span>`
    + `<span class="act-total loss">lost ${ht(t.loss || 0)}</span>`
    + `<span class="act-total net ${netDir}">net ${netSign}${ht(Math.abs(net))}</span>`
    + `<span class="act-note">summed per-command from RTK history.db (this activity feed) — not the <code>rtk gain</code> CLI total</span>`
    + `</div>`;
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
    ${rtkTotalsBar()}
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
    const data = await res.json();
    // Endpoint returns { rows, rtk }; tolerate a bare array for safety.
    state.activity = Array.isArray(data) ? data : (data.rows || []);
    state.rtkTotals = Array.isArray(data) ? null : (data.rtk || null);
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
  state.activityFilter = filterFromUrl(); // restore filter from URL on load
  card.addEventListener('click', e => {
    const btn = e.target.closest('.act-filter');
    if (btn) {
      state.activityFilter = btn.dataset.filter;
      setFilterInUrl(state.activityFilter);
      paintActivity();
      return;
    }
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
  // Broadcast so lazily-loaded views (Analysis) can fetch on open without this
  // module importing them.
  window.dispatchEvent(new CustomEvent('viewchange', { detail: { view } }));
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
