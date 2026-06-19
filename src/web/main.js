// ============ ENTRY POINT / ORCHESTRATOR ============
// Wires the SSE stream to the renderers, owns the refresh countdown + live clock,
// and bootstraps every feature module once the DOM is parsed.
import { state } from './state.js';
import {
  renderHero, renderRTK, renderCav, renderCursor,
  renderAntigravity, renderClaude, renderHdr,
} from './cards.js';
import { drawRTKChart, fetchHistory, initHistoryControls } from './charts.js';
import { fetchActivity, initActivity, initDashboardTabs } from './activity.js';
import { initTheme } from './theme.js';
import { initLayout, reapplyCardLayout } from './layout.js';
import { initSettings, initSettingsAndPricing } from './settings.js';

function render(stats) {
  state.lastStats = stats;
  renderHero(stats);
  const lu = stats.last_used || {};
  document.getElementById('rtk').innerHTML = renderRTK(stats.rtk, lu.rtk);
  document.getElementById('cav').innerHTML = renderCav(stats.caveman, lu.caveman);

  // Per-card visibility (settings-driven). Cursor & Antigravity are also hidden
  // when their collector reports `disabled` (collection skipped server-side).
  const vis = stats.visibility || {};
  const setCard = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? 'block' : 'none'; };
  setCard('rtk-card', vis.rtk !== false);
  setCard('cav-card', vis.caveman !== false);
  setCard('claude-card', vis.claude !== false);
  setCard('hdr-card', vis.headroom !== false);

  const cursorVisible = vis.cursor !== false && !(stats.cursor && stats.cursor.disabled);
  setCard('cursor-card', cursorVisible);
  if (cursorVisible) {
    const curEl = document.getElementById('cur');
    if (curEl) curEl.innerHTML = renderCursor(stats.cursor);
  }

  const agyVisible = vis.antigravity !== false && !(stats.antigravity && stats.antigravity.disabled);
  setCard('antigravity-card', agyVisible);
  if (agyVisible) {
    const agyEl = document.getElementById('agy');
    if (agyEl) agyEl.innerHTML = renderAntigravity(stats.antigravity);
  }

  const claudeEl = document.getElementById('claude');
  if (claudeEl) claudeEl.innerHTML = renderClaude(stats.headroom);

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

  const d = new Date(stats.timestamp);
  document.getElementById('ts').textContent = 'updated ' + d.toLocaleTimeString();
  document.getElementById('dot').className = 'dot live';
  resetCountdown(stats.refresh_ms || 10000);
  startClock(stats.refresh_ms || 10000);

  // re-position cards after visibility/content changes when a free layout is active
  reapplyCardLayout();
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
// frozen between updates. Re-render those bits at the refresh cadence from the
// last snapshot — secsUntil/timeAgo recompute against Date.now(), so they tick.
let clockTimer = null;
function clockTick() {
  if (!state.lastStats) return;
  renderHero(state.lastStats); // refreshes "used Xago" chips (no chart, safe to rebuild)
  const claudeEl = document.getElementById('claude');
  if (claudeEl) claudeEl.innerHTML = renderClaude(state.lastStats.headroom);
}
// tick at the same cadence as the auto-refresh countdown (stats.refresh_ms)
function startClock(refreshMs) {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(clockTick, refreshMs);
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
fetchActivity();
setInterval(fetchActivity, 60000);

initLayout();         // grab board refs + wire drag before any applyLayout()
initSettings();
initSettingsAndPricing();
