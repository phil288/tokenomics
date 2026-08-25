// ============ ENTRY POINT / ORCHESTRATOR ============
// Wires the SSE stream to the renderers, owns the refresh countdown + live clock,
// and bootstraps every feature module once the DOM is parsed.
import { state } from './state.js';
import {
  renderHero, renderRTK, renderCav, renderCursor,
  renderAntigravity, renderClaude, renderHdr, renderUpdateBanner,
} from './cards.js';
import { drawRTKChart, fetchHistory, initHistoryControls, renderHistory } from './charts.js';
import { fetchActivity, initActivity, initDashboardTabs, paintActivity } from './activity.js';
import { initAnalysis, fetchAnalysis } from './analysis.js';
import { initTheme } from './theme.js';
import { initLayout, reapplyCardLayout } from './layout.js';
import { initSettings, initSettingsAndPricing } from './settings.js';

// Apply settings-driven visibility to every Overview card. Cursor & Antigravity
// are also hidden when their collector reports `disabled` (collection skipped
// server-side). Trends is dashboard-level history and is intentionally not
// controlled by provider-card visibility.
function applyOverviewVisibility(vis = {}, stats = {}) {
  const setCard = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? 'block' : 'none'; };
  setCard('rtk-card', vis.rtk !== false);
  setCard('cav-card', vis.caveman !== false);
  setCard('claude-card', vis.claude !== false);
  setCard('hdr-card', vis.headroom !== false);

  const cursorVisible = vis.cursor !== false && !(stats.cursor && stats.cursor.disabled);
  setCard('cursor-card', cursorVisible);
  const agyVisible = vis.antigravity !== false && !(stats.antigravity && stats.antigravity.disabled);
  setCard('antigravity-card', agyVisible);

  return { cursorVisible, agyVisible };
}

// Settings POSTs return the saved configuration before a fresh stats collection
// completes. Apply that response immediately so unchecked sources disappear
// without waiting for the next /api/stats or SSE frame.
export function applySavedProviderVisibility(config) {
  if (!config) {
    return;
  }

  const visibility = {
    rtk: config.RTK_ENABLED !== false,
    caveman: config.CAVEMAN_ENABLED !== false,
    claude: config.CLAUDE_ENABLED !== false,
    headroom: config.HEADROOM_ENABLED !== false,
    cursor: config.CURSOR_ENABLED !== false,
    antigravity: config.ANTIGRAVITY_ENABLED !== false,
  };
  const stats = state.lastStats || { visibility };
  stats.visibility = visibility;
  applyOverviewVisibility(visibility, stats);
  if (state.lastStats) renderHero(state.lastStats);
  renderHistory(visibility);
  reapplyCardLayout();
}

function render(stats) {
  state.lastStats = stats;
  renderHero(stats);
  const lu = stats.last_used || {};
  document.getElementById('rtk').innerHTML = renderRTK(stats.rtk, lu.rtk);
  document.getElementById('cav').innerHTML = renderCav(stats.caveman, lu.caveman);

  const { cursorVisible, agyVisible } = applyOverviewVisibility(stats.visibility || {}, stats);
  if (cursorVisible) {
    const curEl = document.getElementById('cur');
    if (curEl) curEl.innerHTML = renderCursor(stats.cursor);
  }

  if (agyVisible) {
    const agyEl = document.getElementById('agy');
    if (agyEl) agyEl.innerHTML = renderAntigravity(stats.antigravity);
  }

  const claudeEl = document.getElementById('claude');
  if (claudeEl) claudeEl.innerHTML = renderClaude(stats.claude);

  // skip rebuilding the Headroom card while the explainer is open — don't interrupt reading
  if (!state.explainOpen) {
    document.getElementById('hdr').innerHTML = renderHdr(stats.headroom);
    const ex = document.querySelector('.explain');
    if (ex) {
      ex.open = state.explainOpen;
      ex.addEventListener('toggle', () => { state.explainOpen = ex.open; });
    }
  }

  if (stats.rtk && !stats.rtk.error && (stats.rtk.daily || []).length) {
    setTimeout(() => drawRTKChart(stats.rtk.daily), 0);
  } else {
    const wrap = document.getElementById('rtk-chart-wrap');
    if (wrap) wrap.style.display = 'none';
  }

  // Keep the Activity view's status strip live: repaint it from the fresh
  // snapshot when that tab is showing (its rows come from /api/activity, but the
  // RTK/Headroom pills mirror these SSE stats).
  if (document.getElementById('view-activity')?.classList.contains('active')) paintActivity();

  // Analysis view's SSE-derived charts (RTK period/exec/pct + Headroom spend
  // tiles) track the same snapshot; its heavy endpoints refetch on their own
  // throttle. Cheap no-op when the tab is hidden.
  if (document.getElementById('view-analysis')?.classList.contains('active')) fetchAnalysis(false);

  renderVersion(stats.version);
  renderUpdate(stats.version);
  renderHistory();

  const d = new Date(stats.timestamp);
  document.getElementById('ts').textContent = 'updated ' + d.toLocaleTimeString();
  document.getElementById('dot').className = 'dot live';
  resetCountdown(stats.refresh_ms || 10000);
  startClock();

  // refresh the activity feed in lockstep with the countdown, but only while it's
  // the visible view (it tails Headroom's log + reads SQLite — skip when hidden)
  if (document.getElementById('view-activity')?.classList.contains('active')) {
    fetchActivity();
  }

  // re-position cards after visibility/content changes when a free layout is active
  reapplyCardLayout();
}

// ---- app version pill (top-left, next to the title) ----
// Shows the running version; gets an "update" marker when a newer tag exists.
function renderVersion(version) {
  const el = document.getElementById('app-version');
  if (!el) return;
  const cur = version && version.current;
  if (!cur) { el.style.display = 'none'; return; }
  const label = /^v/i.test(cur) ? cur : 'v' + cur;
  el.textContent = label;
  const stale = !!(version && version.update_available);
  el.classList.toggle('update', stale);
  el.title = stale
    ? `Update available: ${version.latest} (running ${label}) — view releases`
    : `App version ${label} — view releases`;
  el.style.display = 'inline-flex';
}

// ---- self-update banner ----
// Dismissal is keyed by the latest version so a newer release re-shows even
// after the user dismissed an older notice (sessionStorage = clears per tab).
function renderUpdate(version) {
  const el = document.getElementById('update-banner');
  if (!el) return;
  const html = renderUpdateBanner(version);
  const dismissed = version && version.latest
    && sessionStorage.getItem('update-dismissed') === version.latest;
  if (!html || dismissed) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.innerHTML = html;
  el.style.display = 'flex';
  const btn = document.getElementById('update-dismiss');
  if (btn) btn.addEventListener('click', () => {
    sessionStorage.setItem('update-dismissed', version.latest);
    el.style.display = 'none';
  });
}

// ---- auto-refresh countdown ----
let cdRemaining = 10;
let cdTimer = null;
function resetCountdown(refreshMs) {
  cdRemaining = Math.round(refreshMs / 1000);
  const el = document.getElementById('countdown');
  if (cdTimer) clearInterval(cdTimer);
  el.textContent = cdRemaining + 's';
  cdTimer = setInterval(() => {
    cdRemaining = Math.max(0, cdRemaining - 1);
    el.textContent = cdRemaining + 's';
  }, 1000);
}

// ---- live wall-clock tick ----
// SSE pushes only every REFRESH_MS, and Headroom polls every ~5min, so any
// clock-derived value (quota reset countdowns, "used Xago") would otherwise sit
// frozen between updates. Re-render those bits once per second from the last
// snapshot — secsUntil/timeAgo/session estimates recompute against Date.now().
let clockTimer = null;
function clockTick() {
  if (!state.lastStats) return;
  renderHero(state.lastStats); // refreshes "used Xago" chips (no chart, safe to rebuild)
  const claudeEl = document.getElementById('claude');
  if (claudeEl) claudeEl.innerHTML = renderClaude(state.lastStats.claude);
}
function startClock() {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(clockTick, 1000);
}

// manual refresh — pulls a fresh snapshot immediately via /api/stats
export async function manualRefresh() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/stats');
    render(await r.json());
    fetchActivity();
  } catch (err) { console.error(err); }
  btn.disabled = false;
}

function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = e => {
    try { render(JSON.parse(e.data)); } catch (err) { console.error(err); }
  };
  es.onerror = () => {
    document.getElementById('dot').className = 'dot error';
    document.getElementById('ts').textContent = 'reconnecting…';
    if (cdTimer) clearInterval(cdTimer);
    document.getElementById('countdown').textContent = '—';
    es.close();
    setTimeout(connect, 5000);
  };
}

// ---- bootstrap ----
document.getElementById('refresh-btn').addEventListener('click', manualRefresh);

initTheme();
connect();

initHistoryControls();
fetchHistory();
setInterval(fetchHistory, 60000);

initDashboardTabs();
initActivity();
initAnalysis();
fetchActivity(); // initial paint; subsequent refreshes ride the SSE/countdown tick in render()

initLayout();         // grab board refs + wire drag before any applyLayout()
initSettings();
initSettingsAndPricing();
