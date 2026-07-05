// ============ ANALYSIS VIEW ============
// Deep drill-downs for RTK / Caveman / Headroom. Everything here is lazy: the
// four /api/analysis/* endpoints are only fetched while the Analysis tab is
// visible (they read SQLite + tail logs — too heavy for the 10s SSE loop), and
// the SSE-derived charts (RTK period/exec/pct, Headroom spend) render from the
// last stats snapshot the main loop already holds.
import { state } from './state.js';
import { hcBase, registerRedraw } from './charts.js';
import { ht, usdFull, tc } from './format.js';
import { isArranging } from './layout.js';

// Categorical hues — reuse the dashboard's established brand colors so the
// Analysis view reads as one system with the rest of the app. CVD-separation
// validated (worst adjacent ΔE 16.6, above the 12 target); identity is also
// carried by legends + direct row labels, never color alone.
const CAT = ['#58a6ff', '#3fb950', '#d4a72c', '#f85149', '#bc8cff', '#39c5cf', '#ff9f45', '#e685b5'];

const anCharts = {};   // canvas id → Chart instance (own registry, separate from charts.js)
const cache = {};      // last payloads, so a theme flip can repaint without refetching
let lastFetch = 0;     // throttle the heavy endpoints
let uiWired = false;
let rtkPeriod = 'daily';
let hrUnit = 'tokens';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}
const isVisible = () => document.getElementById('view-analysis')?.classList.contains('active');
const setSince = (id, since) => {
  const el = document.getElementById(id);
  if (el) el.textContent = since ? 'since last reset' : '';
};

// ---- chart helpers (own registry so theme redraw is self-contained) ----

// Update an existing chart in place (no teardown, no animation) so periodic
// repaints don't flash or replay the grow animation. Options are reassigned each
// time so a theme flip's new axis/grid colors (read via tc()) still take effect.
// Only a changed chart TYPE forces a rebuild (Chart.js can't switch type live).
function upsertChart(id, cfg) {
  const cv = document.getElementById(id);
  if (!cv) return;
  const ex = anCharts[id];
  if (ex && ex.config.type === cfg.type) {
    ex.data = cfg.data;
    ex.options = cfg.options;
    ex.update('none');
    return;
  }
  if (ex) ex.destroy();
  anCharts[id] = new Chart(cv.getContext('2d'), cfg);
}

// Vertical bars sharing the history charts' axis/grid styling.
function drawBars(id, labels, data, color, yfmt, tipLabel) {
  const cfg = hcBase({ yfmt, tooltip: { label: tipLabel } });
  cfg.type = 'bar';
  cfg.options.plugins.legend.display = false;
  cfg.data = {
    labels,
    datasets: [{ data, backgroundColor: color, borderRadius: 4, borderSkipped: false, maxBarThickness: 34 }],
  };
  upsertChart(id, cfg);
}

// Horizontal bars for small-cardinality categorical breakdowns (models, modes).
function drawHBars(id, labels, data, yfmt, tipLabel) {
  const cfg = hcBase({ tooltip: { label: tipLabel } });
  cfg.type = 'bar';
  cfg.options.indexAxis = 'y';
  cfg.options.plugins.legend.display = false;
  cfg.options.scales.x.ticks.callback = yfmt;
  cfg.options.scales.y.beginAtZero = false;
  cfg.data = {
    labels,
    datasets: [{
      data,
      backgroundColor: labels.map((_, i) => CAT[i % CAT.length]),
      borderRadius: 4, borderSkipped: false, maxBarThickness: 26,
    }],
  };
  upsertChart(id, cfg);
}

function drawLines(id, labels, datasets, yfmt, tipLabel, showLegend) {
  const cfg = hcBase({ yfmt, tooltip: { label: tipLabel } });
  cfg.options.plugins.legend.display = showLegend !== false;
  cfg.data = { labels, datasets };
  upsertChart(id, cfg);
}

// ---- RTK ----

function paintRtkPeriod() {
  const rtk = state.lastStats && state.lastStats.rtk;
  const rows = (rtk && Array.isArray(rtk[rtkPeriod])) ? rtk[rtkPeriod].slice() : [];
  const keyOf = { daily: r => r.date, weekly: r => r.week_start, monthly: r => r.month }[rtkPeriod];
  // Buckets arrive newest-first; chart oldest→newest, last ~14.
  rows.sort((a, b) => String(keyOf(a)).localeCompare(String(keyOf(b))));
  const show = rows.slice(-14);
  drawBars('an-rtk-period',
    show.map(r => String(keyOf(r) || '')),
    show.map(r => r.saved_tokens || 0),
    tc('rtk'),
    v => ht(v),
    c => ' saved ' + ht(c.parsed.y));

  drawLines('an-rtk-pct',
    show.map(r => String(keyOf(r) || '')),
    [{ label: 'savings %', data: show.map(r => +(r.savings_pct || 0).toFixed(1)), borderColor: tc('headroom'), backgroundColor: 'transparent' }],
    v => v + '%',
    c => ' ' + c.parsed.y + '%', false);

  drawLines('an-rtk-exec',
    show.map(r => String(keyOf(r) || '')),
    [{ label: 'avg exec ms', data: show.map(r => r.avg_time_ms != null ? Math.round(r.avg_time_ms) : (r.commands ? Math.round((r.total_time_ms || 0) / r.commands) : 0)), borderColor: tc('caveman'), backgroundColor: 'transparent' }],
    v => v + 'ms',
    c => ' ' + c.parsed.y + ' ms', false);
}

// ---- sortable tables ----
// Any column header is clickable: first click sorts (num→desc, text→asc),
// clicking the active column flips direction. State + raw rows are held per
// mount id so repaints (SSE tick / refetch) preserve the user's chosen sort.
const tableStore = {}; // mountId → { cols, rows }
const tableSort = {};  // mountId → { idx, dir }  (dir: 1 asc, -1 desc)

// Each column: { label, num?, cell(r)→html, title?(r), v?(r)→sortable value }.
// v defaults to the raw cell for text and is required (as a number) for num cols
// to sort numerically rather than lexically.
function colValue(col, r) {
  if (col.v) return col.v(r);
  return col.cell(r);
}

function sortRows(cols, rows, st) {
  if (!st) return rows;
  const col = cols[st.idx];
  if (!col) return rows;
  return [...rows].sort((a, b) => {
    const av = colValue(col, a), bv = colValue(col, b);
    if (col.num) return ((Number(av) || 0) - (Number(bv) || 0)) * st.dir;
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * st.dir;
  });
}

function tableInnerHtml(mountId) {
  const { cols, rows } = tableStore[mountId];
  if (!rows.length) return '<div class="an-empty">No data.</div>';
  const st = tableSort[mountId];
  const sorted = sortRows(cols, rows, st);
  const head = cols.map((c, i) => {
    const arrow = st && st.idx === i ? (st.dir === 1 ? ' ▲' : ' ▼') : '';
    const aria = st && st.idx === i ? (st.dir === 1 ? 'ascending' : 'descending') : 'none';
    return `<th class="an-th${c.num ? ' num' : ''}" data-col="${i}" role="columnheader" aria-sort="${aria}" tabindex="0">${esc(c.label)}${arrow}</th>`;
  }).join('');
  const body = sorted.map(r => '<tr>' + cols.map(c =>
    `<td class="${c.num ? 'num' : ''}"${c.title ? ` title="${esc(c.title(r))}"` : ''}>${c.cell(r)}</td>`
  ).join('') + '</tr>').join('');
  return `<table class="an-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// Render (or re-render) a sortable table into its mount, wiring header-click
// sorting once per mount (the delegated listener survives innerHTML repaints).
function mountTable(mountId, cols, rows) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  tableStore[mountId] = { cols, rows };
  if (!mount.dataset.sortWired) {
    mount.dataset.sortWired = '1';
    const onSort = (e) => {
      if (isArranging()) return; // arrange mode: header drags the panel, not sorts
      const th = e.target.closest('th[data-col]');
      if (!th || !mount.contains(th)) return;
      const idx = Number(th.dataset.col);
      const cur = tableSort[mountId];
      const defDir = tableStore[mountId].cols[idx].num ? -1 : 1; // num→desc first
      tableSort[mountId] = (cur && cur.idx === idx) ? { idx, dir: -cur.dir } : { idx, dir: defDir };
      mount.innerHTML = tableInnerHtml(mountId);
    };
    mount.addEventListener('click', onSort);
    mount.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(e); }
    });
  }
  mount.innerHTML = tableInnerHtml(mountId);
}

function paintRtkProjects(d) {
  setSince('an-rtk-since', d.since);
  const short = p => p === '(unknown)' ? p : p.replace(/^.*\/([^/]+\/[^/]+)$/, '$1');
  mountTable('an-rtk-projects', [
    { label: 'Project', v: r => r.path, cell: r => esc(short(r.path)), title: r => r.path },
    { label: 'Cmds', num: true, v: r => r.commands, cell: r => r.commands },
    { label: 'Saved', num: true, v: r => r.net, cell: r => ht(r.net) },
    { label: 'Avg %', num: true, v: r => r.avg_pct || 0, cell: r => (r.avg_pct || 0).toFixed(1) + '%' },
  ], d.projects || []);
}

function paintRtkTypes(d) {
  mountTable('an-rtk-types', [
    { label: 'Type', v: r => r.type, cell: r => esc(r.type) },
    { label: 'Cmds', num: true, v: r => r.commands, cell: r => r.commands },
    { label: 'Saved', num: true, v: r => r.net, cell: r => ht(r.net) },
    { label: 'Pass %', num: true, v: r => r.passthrough_rate || 0, cell: r => (r.passthrough_rate || 0).toFixed(0) + '%' },
    { label: 'ms', num: true, v: r => r.avg_time_ms, cell: r => r.avg_time_ms },
  ], d.types || []);
}

function paintRtkLosses(d) {
  mountTable('an-rtk-losses', [
    { label: 'Command', v: r => r.original_cmd, cell: r => esc(r.original_cmd), title: r => r.rtk_cmd || r.original_cmd },
    { label: 'Before', num: true, v: r => r.before, cell: r => ht(r.before) },
    { label: 'After', num: true, v: r => r.after, cell: r => ht(r.after) },
    { label: 'Lost', num: true, v: r => r.lost, cell: r => '+' + ht(r.lost) },
  ], d.rows || []);
}

// ---- Caveman ----

function paintCaveman(d) {
  setSince('an-cav-since', d.since);
  mountTable('an-cav-sessions', [
    { label: 'Session', v: r => r.session_id, cell: r => esc(String(r.session_id).slice(0, 8)), title: r => r.session_id },
    { label: 'Mode', v: r => r.mode, cell: r => esc(r.mode) },
    { label: 'Model', v: r => r.model, cell: r => esc(r.model) },
    { label: 'Output', num: true, v: r => r.output_tokens, cell: r => ht(r.output_tokens) },
    { label: 'Saved', num: true, v: r => r.est_saved_tokens, cell: r => ht(r.est_saved_tokens) },
    { label: '$', num: true, v: r => r.est_saved_usd, cell: r => usdFull(r.est_saved_usd) },
  ], d.sessions || []);

  const bm = (d.by_model || []).slice(0, 8);
  drawHBars('an-cav-models', bm.map(r => r.model), bm.map(r => r.est_saved_tokens),
    v => ht(v), c => ' saved ' + ht(c.parsed.x));
  const bd = (d.by_mode || []).slice(0, 8);
  drawHBars('an-cav-modes', bd.map(r => r.mode), bd.map(r => r.est_saved_tokens),
    v => ht(v), c => ' saved ' + ht(c.parsed.x));

  // Session growth: cumulative est_saved_tokens over each session's own events.
  // x is the point index (sessions start at different times); each series is one
  // recent session, direct-labeled by short id.
  const series = (d.series || []).filter(s => s.points.length > 1);
  const maxLen = series.reduce((m, s) => Math.max(m, s.points.length), 0);
  const labels = Array.from({ length: maxLen }, (_, i) => String(i + 1));
  const datasets = series.map((s, i) => {
    let sum = 0;
    const data = s.points.map(p => (sum += p.est_saved_tokens));
    return { label: String(s.session_id).slice(0, 8), data, borderColor: CAT[i % CAT.length], backgroundColor: 'transparent' };
  });
  drawLines('an-cav-growth', labels, datasets, v => ht(v),
    c => ' ' + ht(c.parsed.y), datasets.length > 1);
}

// ---- Headroom ----

function paintHrSpend() {
  const life = (state.lastStats && state.lastStats.headroom && state.lastStats.headroom.savings && state.lastStats.headroom.savings.lifetime) || {};
  const gross = life.total_input_cost_usd || 0;
  const saved = life.compression_savings_usd || 0;
  const net = Math.max(0, gross - saved);
  const pct = gross ? (saved / gross) * 100 : 0;
  const tile = (label, val, accent) =>
    `<div class="an-tile"><div class="an-tile-val"${accent ? ` style="color:${accent}"` : ''}>${val}</div><div class="an-tile-label">${esc(label)}</div></div>`;
  document.getElementById('an-hr-spend').innerHTML =
    tile('gross spend', usdFull(gross)) +
    tile('saved', usdFull(saved), tc('headroom')) +
    tile('net', usdFull(net)) +
    tile('% of spend', pct.toFixed(1) + '%', tc('headroom')) +
    tile('tokens saved', ht(life.tokens_saved || 0)) +
    tile('requests', ht(life.requests || 0));
}

function paintHrModels(d) {
  setSince('an-hr-since', d.since);
  const useUsd = hrUnit === 'usd';
  const key = useUsd ? 'saved_usd' : 'saved_tokens';
  const models = (d.models || []).slice(0, 8);
  // Union of timestamps across models → shared x-axis of local time labels.
  const tset = new Set();
  for (const m of models) for (const p of m.points) tset.add(p.t);
  const ts = [...tset].sort((a, b) => a - b);
  const labels = ts.map(t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }));
  const datasets = models.map((m, i) => {
    const byT = new Map(m.points.map(p => [p.t, p[key]]));
    let last = 0;
    const data = ts.map(t => { if (byT.has(t)) last = byT.get(t); return last; });
    return { label: m.model, data, borderColor: CAT[i % CAT.length], backgroundColor: 'transparent' };
  });
  drawLines('an-hr-models', labels, datasets,
    v => useUsd ? '$' + v : ht(v),
    c => ' ' + (useUsd ? usdFull(c.parsed.y) : ht(c.parsed.y)),
    datasets.length > 1);
}

function paintHrOps(d) {
  const note = document.getElementById('an-hr-window-note');
  if (note) note.textContent = d.window_partial ? `last ${(d.window_bytes / 1048576).toFixed(0)} MB of log` : '';

  mountTable('an-hr-strategies', [
    { label: 'Strategy', v: r => r.strategy, cell: r => esc(r.strategy) },
    { label: 'Events', num: true, v: r => r.events, cell: r => r.events },
    { label: 'Saved', num: true, v: r => r.saved, cell: r => ht(r.saved) },
    { label: 'Avg %', num: true, v: r => r.avg_pct || 0, cell: r => (r.avg_pct || 0).toFixed(0) + '%' },
  ], d.strategies || []);

  const transforms = (d.transforms || []).map(r => ({ ...r, _kind: 'transform', _name: r.transform }));
  const clients = (d.clients || []).map(r => ({ ...r, _kind: 'client', _name: r.client }));
  mountTable('an-hr-transforms', [
    { label: 'Kind', v: r => r._kind, cell: r => esc(r._kind) },
    { label: 'Name', v: r => r._name, cell: r => esc(r._name) },
    { label: 'Reqs', num: true, v: r => r.requests, cell: r => r.requests },
    { label: 'Saved', num: true, v: r => r.saved || 0, cell: r => ht(r.saved || 0) },
  ], [...transforms, ...clients]);

  const pts = d.cache_trend || [];
  drawLines('an-hr-cache',
    pts.map(p => new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
    [{ label: 'cache hit %', data: pts.map(p => p.hit_pct), borderColor: tc('headroom'), backgroundColor: 'transparent' }],
    v => v + '%', c => ' ' + c.parsed.y + '%', false);
}

// Quota-over-time comes from the dashboard's own minute snapshots (already on
// disk via /api/history), not an analysis endpoint.
async function paintQuota() {
  try {
    const r = await fetch('/api/history');
    const rows = await r.json();
    const recent = (Array.isArray(rows) ? rows : []).slice(-720);
    drawLines('an-hr-quota',
      recent.map(x => new Date(x.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      [
        { label: '5-hour', data: recent.map(x => (x.hr && x.hr.q5) || 0), borderColor: CAT[0], backgroundColor: 'transparent' },
        { label: '7-day', data: recent.map(x => (x.hr && x.hr.q7) || 0), borderColor: CAT[2], backgroundColor: 'transparent' },
      ],
      v => v + '%', c => ' ' + c.parsed.y + '%', true);
  } catch { }
}

// ---- fetch + orchestration ----

// SSE-derived surfaces only — cheap, safe to repaint on every 10s tick. Charts
// update in place (no flicker); the spend tiles are plain HTML.
function paintLive() {
  paintRtkPeriod();
  paintHrSpend();
}

// Everything, including the on-demand endpoint payloads. Runs only after a
// refetch (or theme flip / view open) — NOT on every SSE tick — so the tables
// and heavy charts don't re-render (and reset scroll) 6×/minute.
function paintFromCache() {
  paintLive();
  if (cache.projects) paintRtkProjects(cache.projects);
  if (cache.types) paintRtkTypes(cache.types);
  if (cache.losses) paintRtkLosses(cache.losses);
  if (cache.caveman) paintCaveman(cache.caveman);
  if (cache.models) paintHrModels(cache.models);
  if (cache.ops) paintHrOps(cache.ops);
}

async function getJson(url) {
  try { const r = await fetch(url); if (!r.ok) return null; return await r.json(); } catch { return null; }
}

export async function fetchAnalysis(force) {
  if (!isVisible()) return;
  const now = Date.now();
  // Within the throttle window, only the live SSE-derived charts update; the
  // fetched tables/charts stay put until the next real refetch.
  if (!force && now - lastFetch < 30000) { paintLive(); return; }
  lastFetch = now;
  const [projects, types, losses, caveman, models, ops] = await Promise.all([
    getJson('/api/analysis/rtk/projects'),
    getJson('/api/analysis/rtk/commands'),
    getJson('/api/analysis/rtk/losses?limit=50'),
    getJson('/api/analysis/caveman?series=10'),
    getJson('/api/analysis/headroom/models?points=300'),
    getJson('/api/analysis/headroom/ops?bytes=2097152'),
  ]);
  if (projects) cache.projects = projects;
  if (types) cache.types = types;
  if (losses) cache.losses = losses;
  if (caveman) cache.caveman = caveman;
  if (models) cache.models = models;
  if (ops) cache.ops = ops;
  paintFromCache();
  paintQuota();
}

// Rebuild every analysis chart from cache — registered with charts.js so a
// theme flip repaints axis/grid colors here too.
function redrawAnalysisCharts() {
  if (!isVisible()) return;
  paintFromCache();
  paintQuota();
}

function wireToggle(containerId, attr, onPick) {
  const box = document.getElementById(containerId);
  if (!box) return;
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('.an-tgl');
    if (!btn) return;
    for (const b of box.querySelectorAll('.an-tgl')) b.classList.toggle('active', b === btn);
    onPick(btn.dataset[attr]);
  });
}

export function initAnalysis() {
  if (uiWired) return;
  uiWired = true;
  wireToggle('an-rtk-period-toggle', 'period', (p) => { rtkPeriod = p; paintRtkPeriod(); });
  wireToggle('an-hr-unit-toggle', 'unit', (u) => { hrUnit = u; if (cache.models) paintHrModels(cache.models); });
  registerRedraw(redrawAnalysisCharts);
  window.addEventListener('viewchange', (e) => {
    if (e.detail && e.detail.view === 'analysis') fetchAnalysis(true);
  });
  // Deep-link straight to #analysis on load.
  if (isVisible()) fetchAnalysis(true);
}
