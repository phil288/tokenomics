// ============ SETTINGS MODAL & LOGIC ============
import {
  PRICING, derivePricingRates, PRICING_PROVIDERS, groupPricingRows,
  matchPricingRow, analyzePricingRows
} from './pricing.js';
import { esc } from './format.js';
import { setCardLayout, hasSavedLayout, applyLayout, setAnalysisLayout } from './layout.js';
import { manualRefresh, applySavedProviderVisibility } from './main.js';
import { fetchHistory } from './charts.js';
import {
  setPaceAlertConfig, paceAlertConfig, requestNotificationPermission, notificationPermission,
  notificationsSupported, sendTestNotification, resetPaceAlerts
} from './notify.js';

let settingsOverlay, cursorEnabledCb, cursorTokenGroup, pricingTableBody;

// Feed the notifier from a settings payload (server response or initial load).
function applyPaceAlertSettings(config) {
  setPaceAlertConfig({
    enabled: config.PACE_ALERTS_ENABLED === true,
    warnPct: config.PACE_ALERT_WARN_PCT,
    overPct: config.PACE_ALERT_OVER_PCT,
  });
}

function setNotifyStatus(msg, tone = 'muted') {
  const el = document.getElementById('notify-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = tone === 'err' ? 'var(--danger, #f85149)'
    : tone === 'ok' ? 'var(--ok, #3fb950)' : 'var(--muted)';
}

// Alerts only reach the desktop with browser permission — say so plainly
// instead of silently never firing.
function refreshNotifyStatus() {
  if (!notificationsSupported()) {
    setNotifyStatus('This browser does not support desktop notifications', 'err');
    return;
  }
  const p = notificationPermission();
  if (p === 'granted') setNotifyStatus('Notifications allowed', 'ok');
  else if (p === 'denied') setNotifyStatus('Blocked by the browser — allow notifications for this site', 'err');
  else setNotifyStatus('Permission not requested yet');
}

// Force the Cursor token field back to its masked/hidden state (password input,
// closed-eye icon). Called on every modal open so a token revealed in a prior
// session never reappears in plain text; the eye button reveals it again.
function resetCursorTokenReveal() {
  const input = document.getElementById('set-cursor-token');
  const closed = document.getElementById('eye-icon-closed');
  const open = document.getElementById('eye-icon-open');
  const status = document.getElementById('cursor-token-status');
  if (input) { input.type = 'password'; delete input.dataset.tokenSource; }
  if (closed) closed.style.display = 'block';
  if (open) open.style.display = 'none';
  if (status) status.textContent = '';
}

function setCursorConnVisible(on) {
  if (cursorTokenGroup) cursorTokenGroup.style.display = on ? 'flex' : 'none';
}

// Lightweight, non-blocking toast for action feedback (success / failure).
let toastTimer = null;
function showToast(msg, ok = true) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast ' + (ok ? 'ok' : 'err') + ' show';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + (ok ? 'ok' : 'err'); }, 3200);
}

async function loadSettingsUI() {
  try {
    const res = await fetch('/api/settings');
    const config = await res.json();

    cursorEnabledCb.checked = config.CURSOR_ENABLED !== false;
    setCursorConnVisible(cursorEnabledCb.checked);

    document.getElementById('set-vis-rtk').checked = config.RTK_ENABLED !== false;
    document.getElementById('set-vis-caveman').checked = config.CAVEMAN_ENABLED !== false;
    document.getElementById('set-vis-claude').checked = config.CLAUDE_ENABLED !== false;
    document.getElementById('set-vis-headroom').checked = config.HEADROOM_ENABLED !== false;
    document.getElementById('set-vis-antigravity').checked = config.ANTIGRAVITY_ENABLED !== false;

    document.getElementById('set-cursor-token').value = config.CURSOR_ACCESS_TOKEN || '';
    // Always (re)open with the token masked — the eye reveals it. Resets any
    // reveal/fetch state left over from a previous open so it never reopens
    // showing a plain-text token.
    resetCursorTokenReveal();
    document.getElementById('set-rtk-home').value = config.RTK_DATA_HOME || '';
    document.getElementById('set-headroom-path').value = config.HEADROOM_SAVINGS_PATH || '';
    document.getElementById('set-headroom-sub-path').value = config.HEADROOM_SUBSCRIPTION_STATE_PATH || '';
    document.getElementById('set-headroom-health-url').value = config.HEADROOM_HEALTH_URL !== undefined ? config.HEADROOM_HEALTH_URL : 'http://127.0.0.1:8787/health';

    document.getElementById('set-notify-enabled').checked = config.PACE_ALERTS_ENABLED === true;
    document.getElementById('set-notify-warn').value = config.PACE_ALERT_WARN_PCT != null ? config.PACE_ALERT_WARN_PCT : 80;
    document.getElementById('set-notify-over').value = config.PACE_ALERT_OVER_PCT != null ? config.PACE_ALERT_OVER_PCT : 100;
    applyPaceAlertSettings(config);
    refreshNotifyStatus();

    renderPricingTable(config.PRICING || []);
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}


const PX_FIELDS = ['in', 'out', 'cr', 'cw5', 'cw1'];
const PX_LABELS = { out: 'Output', cr: 'Cache read', cw5: 'Cache write 5m', cw1: 'Cache write 1h' };

function applyDerivedRates(tr) {
  const rates = derivePricingRates(
    tr.querySelector('.px-prefix').value,
    tr.querySelector('.px-in').value,
  );
  tr.querySelector('.px-out').value = rates.out;
  tr.querySelector('.px-cr').value = rates.cr;
  tr.querySelector('.px-cw5').value = rates.cw5;
  tr.querySelector('.px-cw1').value = rates.cw1;
}

// [prefix, cost] for every editable row, in DOM (= saved, = matching) order.
function readPricingRows() {
  return [...pricingTableBody.querySelectorAll('tr.px-row')].map((tr) => {
    const cost = {};
    for (const f of PX_FIELDS) cost[f] = parseFloat(tr.querySelector(`.px-${f}`).value) || 0;
    return [tr.querySelector('.px-prefix').value.trim(), cost];
  });
}

function groupHeadRow(key) {
  const g = PRICING_PROVIDERS.find((p) => p.key === key) || PRICING_PROVIDERS[PRICING_PROVIDERS.length - 1];
  const tr = document.createElement('tr');
  tr.className = 'px-group-head';
  tr.dataset.group = g.key;
  tr.innerHTML = `<th colspan="7" scope="rowgroup"><span class="px-group-dot"></span>${esc(g.label)} <span class="px-group-count"></span></th>`;
  return tr;
}

// Rows are shown grouped by provider. The partition is stable and providers'
// leading tokens never prefix each other, so grouping cannot change which row
// priceFor() picks (see groupPricingRows in pricing.js).
function renderPricingTable(rows) {
  pricingTableBody.innerHTML = '';
  const filter = document.getElementById('pricing-filter');
  if (filter) filter.value = '';
  for (const group of groupPricingRows(rows)) {
    pricingTableBody.appendChild(groupHeadRow(group.key));
    for (const [prefix, cost] of group.rows) addPricingRow(prefix, cost, { skipState: true });
  }
  refreshPricingState();
}

function addPricingRow(prefix = '', cost = { in: 0, out: 0, cr: 0, cw5: 0, cw1: 0 }, { skipState = false } = {}) {
  const tr = document.createElement('tr');
  tr.className = 'px-row';
  tr.innerHTML = `
    <td class="px-prefix-cell"><input type="text" class="px-prefix" value="${esc(prefix)}" placeholder="e.g. claude-opus-5-5" aria-label="Model prefix" spellcheck="false"><span class="px-flag" hidden></span></td>
    <td><input type="number" step="any" min="0" class="px-num px-in" value="${cost.in || 0}" aria-label="Input price"></td>
    <td><input type="number" step="any" min="0" class="px-num px-out" value="${cost.out || 0}" aria-label="Output price"></td>
    <td><input type="number" step="any" min="0" class="px-num px-cr" value="${cost.cr || 0}" aria-label="Cache read price"></td>
    <td><input type="number" step="any" min="0" class="px-num px-cw5" value="${cost.cw5 || 0}" aria-label="Cache write 5 minute price"></td>
    <td><input type="number" step="any" min="0" class="px-num px-cw1" value="${cost.cw1 || 0}" aria-label="Cache write 1 hour price"></td>
    <td class="px-actions">
      <button type="button" class="btn-reset-pricing" title="Reset this row to the formula" aria-label="Reset row to formula" hidden>↺</button>
      <button type="button" class="btn-del-pricing" title="Remove row" aria-label="Remove row">&times;</button>
    </td>
  `;
  tr.querySelector('.btn-del-pricing').addEventListener('click', () => { tr.remove(); refreshPricingState(); });
  tr.querySelector('.btn-reset-pricing').addEventListener('click', () => { applyDerivedRates(tr); refreshPricingState(); });
  // Input (and prefix family) drive the other columns live. Don't recompute
  // on load — a saved row may have a custom override. Refresh rates snaps
  // every row back to the formula.
  tr.querySelector('.px-in').addEventListener('input', () => applyDerivedRates(tr));
  tr.querySelector('.px-prefix').addEventListener('input', () => applyDerivedRates(tr));
  // Any edit re-runs the diagnostics (custom / duplicate / shadowed flags).
  tr.addEventListener('input', () => refreshPricingState());
  pricingTableBody.appendChild(tr);
  if (!skipState) refreshPricingState();
  return tr;
}

// New rows go at the end, under the "Custom" header, and get focus.
function addBlankPricingRow() {
  const heads = pricingTableBody.querySelectorAll('tr.px-group-head');
  const last = heads[heads.length - 1];
  if (!last || last.dataset.group !== 'other') pricingTableBody.appendChild(groupHeadRow('other'));
  const filter = document.getElementById('pricing-filter');
  if (filter && filter.value) filter.value = '';
  const tr = addPricingRow();
  const input = tr.querySelector('.px-prefix');
  tr.scrollIntoView({ block: 'nearest' });
  input.focus();
}

// Re-derive every visual hint from the current (unsaved) table: custom cells,
// dead rows, per-group counts, the filter, and the model-id lookup line.
function refreshPricingState() {
  if (!pricingTableBody) return;
  const trs = [...pricingTableBody.querySelectorAll('tr.px-row')];
  const rows = readPricingRows();
  const info = analyzePricingRows(rows);
  let customRows = 0;
  trs.forEach((tr, i) => {
    const r = info[i];
    for (const f of ['out', 'cr', 'cw5', 'cw1']) {
      const input = tr.querySelector(`.px-${f}`);
      const isCustom = f in r.custom;
      input.classList.toggle('px-custom', isCustom);
      input.title = isCustom ? `Custom ${PX_LABELS[f].toLowerCase()} — formula gives ${r.custom[f]}` : '';
    }
    const hasCustom = Object.keys(r.custom).length > 0;
    if (hasCustom) customRows++;
    tr.querySelector('.btn-reset-pricing').hidden = !hasCustom;
    const flag = tr.querySelector('.px-flag');
    const dead = r.duplicateOf >= 0 ? `Duplicate of the earlier "${rows[r.duplicateOf][0]}" row — never used`
      : r.shadowedBy >= 0 ? `Never used — "${rows[r.shadowedBy][0]}" matches first. Move this row above it.`
      : '';
    flag.hidden = !dead;
    flag.className = dead ? 'px-flag warn' : 'px-flag';
    flag.textContent = dead ? '!' : '';
    flag.title = dead;
    tr.classList.toggle('px-dead', !!dead);
  });
  const count = document.getElementById('pricing-count');
  if (count) count.textContent = `${rows.length} rows · ${customRows} with custom rates`;
  refreshPricingFilter(trs, rows);
}

// The search box both filters rows and answers "what would this model id cost?"
// using the same first-prefix-match rule as priceFor().
function refreshPricingFilter(trs = [...pricingTableBody.querySelectorAll('tr.px-row')], rows = readPricingRows()) {
  const filter = document.getElementById('pricing-filter');
  const matchEl = document.getElementById('pricing-match');
  const emptyEl = document.getElementById('pricing-empty');
  const q = filter ? filter.value.trim() : '';
  const ql = q.toLowerCase();
  const hit = q ? matchPricingRow(rows, q) : -1;
  let visible = 0;
  trs.forEach((tr, i) => {
    const prefix = rows[i][0].toLowerCase();
    const show = !ql || !prefix || prefix.includes(ql) || ql.startsWith(prefix);
    tr.hidden = !show;
    tr.classList.toggle('px-match-row', i === hit);
    if (show) visible++;
  });
  for (const head of pricingTableBody.querySelectorAll('tr.px-group-head')) {
    let n = 0, shown = 0;
    for (let el = head.nextElementSibling; el && !el.classList.contains('px-group-head'); el = el.nextElementSibling) {
      n++; if (!el.hidden) shown++;
    }
    head.hidden = shown === 0 && n > 0;
    head.querySelector('.px-group-count').textContent = ql ? `${shown}/${n}` : String(n);
  }
  if (emptyEl) emptyEl.hidden = visible > 0 || trs.length === 0;
  if (!matchEl) return;
  // Only treat the query as a model id once it looks like one (has a dash).
  if (!q || !q.includes('-')) { matchEl.hidden = true; return; }
  matchEl.hidden = false;
  if (hit < 0) {
    matchEl.className = 'px-match warn';
    matchEl.innerHTML = `<strong>${esc(q)}</strong> matches no row — its usage is counted at $0. Add a row with a prefix it starts with.`;
  } else {
    const [prefix, c] = rows[hit];
    matchEl.className = 'px-match ok';
    matchEl.innerHTML = `<strong>${esc(q)}</strong> is billed by <code>${esc(prefix)}</code>: $${c.in} in · $${c.out} out · $${c.cr} cache read <span class="px-per">/ 1M tokens</span>`;
  }
}

function refreshPricingRates() {
  if (!pricingTableBody) return;
  for (const tr of pricingTableBody.querySelectorAll('tr.px-row')) applyDerivedRates(tr);
  refreshPricingState();
}

// Refresh rates overwrites hand-entered vendor prices (e.g. Opus 5.5 cache
// reads at 0.05×), so ask first when any row has one.
function confirmRefreshPricingRates() {
  const custom = analyzePricingRows(readPricingRows()).filter((r) => Object.keys(r.custom).length > 0).length;
  if (custom > 0 && !confirm(`${custom} row${custom === 1 ? '' : 's'} have custom rates that differ from the formula (often real vendor prices). Refresh will overwrite them. Continue?`)) return;
  refreshPricingRates();
}

// Wire the settings button, modal, pricing editor, and save handler.
export function initSettings() {
  settingsOverlay = document.getElementById('settings-overlay');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsClose = document.getElementById('settings-close');
  const settingsCancel = document.getElementById('settings-cancel');
  const settingsSave = document.getElementById('settings-save');
  cursorEnabledCb = document.getElementById('set-cursor-enabled');
  cursorTokenGroup = document.getElementById('set-cursor-token-group');
  pricingTableBody = document.getElementById('pricing-table-body');
  const addPricingRowBtn = document.getElementById('btn-add-pricing-row');
  const refreshPricingBtn = document.getElementById('btn-refresh-pricing');

  cursorEnabledCb.addEventListener('change', () => {
    setCursorConnVisible(cursorEnabledCb.checked);
  });

  const toggleCursorTokenBtn = document.getElementById('toggle-cursor-token');
  const eyeIconClosed = document.getElementById('eye-icon-closed');
  const eyeIconOpen = document.getElementById('eye-icon-open');
  const cursorTokenInput = document.getElementById('set-cursor-token');

  toggleCursorTokenBtn.addEventListener('click', async () => {
    if (cursorTokenInput.type === 'password') {
      cursorTokenInput.type = 'text';
      eyeIconClosed.style.display = 'none';
      eyeIconOpen.style.display = 'block';
      // Reveal on an empty field → pull the effective token (settings → env →
      // Cursor DB) so the user can see a stored token they never typed here.
      // Never clobber text the user is editing; only fill when blank.
      if (!cursorTokenInput.value) {
        try {
          // Explicit header so a bare cross-origin GET cannot reach the JWT
              // (a simple request cannot set custom headers; this forces a
              // preflight, which the server's origin check then rejects).
              const res = await fetch('/api/cursor/token', {
                headers: { 'X-Tokenomics-Reveal': 'token' },
              });
          const { token, source } = await res.json();
          if (token && !cursorTokenInput.value) {
            cursorTokenInput.value = token;
            cursorTokenInput.dataset.tokenSource = source || '';
          }
        } catch (err) {
          console.error('Failed to fetch Cursor token:', err);
        }
      }
    } else {
      cursorTokenInput.type = 'password';
      eyeIconClosed.style.display = 'block';
      eyeIconOpen.style.display = 'none';
    }
  });

  // "Test token" — validate against the live Cursor API. Sends the field value
  // (blank → server tests the effective settings/env/DB token), shows the
  // outcome inline without persisting anything.
  const testTokenBtn = document.getElementById('test-cursor-token');
  const tokenStatus = document.getElementById('cursor-token-status');
  testTokenBtn.addEventListener('click', async () => {
    testTokenBtn.disabled = true;
    tokenStatus.textContent = 'Testing…';
    tokenStatus.style.color = 'var(--muted)';
    try {
      const res = await fetch('/api/cursor/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cursorTokenInput.value.trim() })
      });
      // A stale server (pre-route) or proxy returns non-JSON (e.g. "Not found").
      // Parse defensively so the user sees the real HTTP status, not a JSON
      // SyntaxError.
      const raw = await res.text();
      let r;
      try { r = JSON.parse(raw); }
      catch {
        const hint = res.status === 404 ? ' — restart the server' : '';
        throw new Error(`HTTP ${res.status}: ${raw.slice(0, 80) || res.statusText}${hint}`);
      }
      if (r.ok) {
        tokenStatus.textContent = `✓ Valid${r.source ? ` (${r.source})` : ''}`;
        tokenStatus.style.color = 'var(--ok, #3fb950)';
      } else {
        tokenStatus.textContent = `✗ ${r.error || 'Invalid token'}`;
        tokenStatus.style.color = 'var(--danger, #f85149)';
      }
    } catch (err) {
      tokenStatus.textContent = `✗ ${err.message}`;
      tokenStatus.style.color = 'var(--danger, #f85149)';
    } finally {
      testTokenBtn.disabled = false;
    }
  });

  // Ticking the box is the user gesture browsers require before they will show
  // the permission prompt, so ask right here rather than at save time.
  const notifyEnabledCb = document.getElementById('set-notify-enabled');
  notifyEnabledCb.addEventListener('change', async () => {
    if (!notifyEnabledCb.checked) { refreshNotifyStatus(); return; }
    const perm = await requestNotificationPermission();
    if (perm !== 'granted') notifyEnabledCb.checked = false;
    refreshNotifyStatus();
  });

  const testNotifyBtn = document.getElementById('test-notification-btn');
  testNotifyBtn.addEventListener('click', async () => {
    const perm = await requestNotificationPermission();
    if (perm !== 'granted') { refreshNotifyStatus(); return; }
    setNotifyStatus(sendTestNotification() ? 'Test notification sent' : 'Could not send the notification', 'ok');
  });

  addPricingRowBtn.addEventListener('click', (e) => {
    e.preventDefault();
    addBlankPricingRow();
  });
  refreshPricingBtn.addEventListener('click', (e) => {
    e.preventDefault();
    confirmRefreshPricingRates();
  });
  document.getElementById('pricing-filter').addEventListener('input', () => refreshPricingFilter());

  // Tab navigation
  const tabButtons = document.querySelectorAll('#settings-tabs .modal-tab');
  const tabPanels = document.querySelectorAll('#settings-overlay .tab-panel');
  const activateTab = (name) => {
    tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    tabPanels.forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
    // The pricing grid needs more room than the form tabs.
    settingsOverlay.querySelector('.modal').classList.toggle('modal-wide', name === 'pricing');
  };
  tabButtons.forEach((b) => b.addEventListener('click', () => activateTab(b.dataset.tab)));

  settingsBtn.addEventListener('click', () => {
    loadSettingsUI().then(() => {
      activateTab('sources');   // always open on the first tab
      settingsOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    });
  });

  const closeModal = () => {
    settingsOverlay.classList.remove('open');
    document.body.style.overflow = '';
  };
  settingsClose.addEventListener('click', closeModal);
  settingsCancel.addEventListener('click', closeModal);

  const resetStatsBtn = document.getElementById('reset-stats-btn');
  resetStatsBtn.addEventListener('click', async () => {
    if (!confirm('Reset all stats? This permanently clears the recorded trend history and cannot be undone.')) return;
    resetStatsBtn.disabled = true;
    try {
      const res = await fetch('/api/history/reset', {
        method: 'POST',
        // Server refuses resets without this header, so a stray scripted
        // POST can't silently capture a new baseline (see server.js).
        headers: { 'X-Tokenomics-Reset-Confirm': 'manual' }
      });
      const result = await res.json();
      if (result.success) {
        await fetchHistory();   // redraw trend charts from the now-empty history
        closeModal();
        manualRefresh();
        showToast('Stats reset — trend history cleared', true);
      } else {
        showToast('Failed to reset stats: ' + (result.error || 'unknown error'), false);
      }
    } catch (err) {
      showToast('Error resetting stats: ' + err.message, false);
    } finally {
      resetStatsBtn.disabled = false;
    }
  });

  const restoreBaselineBtn = document.getElementById('restore-baseline-btn');
  restoreBaselineBtn.addEventListener('click', async () => {
    restoreBaselineBtn.disabled = true;
    try {
      const res = await fetch('/api/baseline', { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        closeModal();
        manualRefresh();
        showToast('Absolute totals restored', true);
      } else {
        showToast('Failed to restore totals: ' + (result.error || 'unknown error'), false);
      }
    } catch (err) {
      showToast('Error restoring totals: ' + err.message, false);
    } finally {
      restoreBaselineBtn.disabled = false;
    }
  });

  settingsSave.addEventListener('click', async () => {
    const updatedPricing = [];
    const rows = pricingTableBody.querySelectorAll('tr.px-row');
    for (const row of rows) {
      const prefix = row.querySelector('.px-prefix').value.trim();
      if (!prefix) continue;

      updatedPricing.push([
        prefix,
        {
          in: parseFloat(row.querySelector('.px-in').value) || 0,
          out: parseFloat(row.querySelector('.px-out').value) || 0,
          cr: parseFloat(row.querySelector('.px-cr').value) || 0,
          cw5: parseFloat(row.querySelector('.px-cw5').value) || 0,
          cw1: parseFloat(row.querySelector('.px-cw1').value) || 0
        }
      ]);
    }

    const body = {
      RTK_ENABLED: document.getElementById('set-vis-rtk').checked,
      CAVEMAN_ENABLED: document.getElementById('set-vis-caveman').checked,
      CLAUDE_ENABLED: document.getElementById('set-vis-claude').checked,
      HEADROOM_ENABLED: document.getElementById('set-vis-headroom').checked,
      ANTIGRAVITY_ENABLED: document.getElementById('set-vis-antigravity').checked,
      CURSOR_ENABLED: cursorEnabledCb.checked,
      CURSOR_ACCESS_TOKEN: document.getElementById('set-cursor-token').value,
      RTK_DATA_HOME: document.getElementById('set-rtk-home').value,
      HEADROOM_SAVINGS_PATH: document.getElementById('set-headroom-path').value,
      HEADROOM_SUBSCRIPTION_STATE_PATH: document.getElementById('set-headroom-sub-path').value,
      HEADROOM_HEALTH_URL: document.getElementById('set-headroom-health-url').value,
      PACE_ALERTS_ENABLED: document.getElementById('set-notify-enabled').checked,
      PACE_ALERT_WARN_PCT: document.getElementById('set-notify-warn').value,
      PACE_ALERT_OVER_PCT: document.getElementById('set-notify-over').value,
      PRICING: updatedPricing
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await res.json();
      if (result.success) {
        if (result.settings && result.settings.PRICING) {
          PRICING.length = 0;
          result.settings.PRICING.forEach(item => PRICING.push(item));
        }
        if (result.settings) {
          try {
            applySavedProviderVisibility(result.settings || body);
          } catch (err) {
            console.error('Failed to apply saved provider visibility:', err);
          }
          const before = paceAlertConfig();
          applyPaceAlertSettings(result.settings);
          const after = paceAlertConfig();
          // Changed thresholds re-arm every bar, so a lowered threshold alerts
          // on the current unit instead of waiting for the next day/hour. An
          // unrelated save (pricing, paths) must NOT replay alerts already seen.
          if (before.enabled !== after.enabled || before.warnPct !== after.warnPct
              || before.overPct !== after.overPct) {
            resetPaceAlerts();
          }
        }
        closeModal();
        manualRefresh();
      } else {
        alert('Failed to save settings: ' + (result.error || 'unknown error'));
      }
    } catch (err) {
      alert('Error saving settings: ' + err.message);
    }
  });
}

// Initial load: pull pricing + card layout from the server (source of truth),
// falling back to the local mirror for layout, then apply a saved layout.
export async function initSettingsAndPricing() {
  try {
    const res = await fetch('/api/settings');
    const config = await res.json();
    if (config && config.PRICING) {
      PRICING.length = 0;
      config.PRICING.forEach(item => PRICING.push(item));
    }
    // server is the source of truth; fall back to the local mirror if empty
    let layout = (config && config.CARD_LAYOUT) || {};
    if (!Object.keys(layout).length) {
      try { layout = JSON.parse(localStorage.getItem('ltm-card-layout') || '{}'); } catch { }
    }
    setCardLayout(layout);

    // Analysis view panel order (source of truth: server, mirror: localStorage).
    let anLayout = (config && config.ANALYSIS_LAYOUT) || {};
    if (!Object.keys(anLayout).length) {
      try { anLayout = JSON.parse(localStorage.getItem('ltm-analysis-layout') || '{}'); } catch { }
    }
    setAnalysisLayout(anLayout);

    // Must run after the layout maps are populated: it triggers reapplyCardLayout(),
    // which would otherwise seed/persist against an empty layout.
    if (config) {
      applySavedProviderVisibility(config);
    }

    // Alerts must be live from page load, not only after the modal is opened.
    if (config) applyPaceAlertSettings(config);
    // apply a saved layout immediately on load (wide viewports only)
    if (hasSavedLayout() && window.innerWidth > 1100) applyLayout();
  } catch (err) {
    console.error('Failed to load dynamic pricing from settings:', err);
  }
}
