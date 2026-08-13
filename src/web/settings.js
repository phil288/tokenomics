// ============ SETTINGS MODAL & LOGIC ============
import { PRICING, derivePricingRates } from './pricing.js';
import { setCardLayout, hasSavedLayout, applyLayout, setAnalysisLayout } from './layout.js';
import { manualRefresh } from './main.js';
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

    pricingTableBody.innerHTML = '';
    const pricing = config.PRICING || [];
    for (const [prefix, cost] of pricing) {
      addPricingRow(prefix, cost);
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

// Prefix values come back from user-editable settings — escape them so a
// stray quote/angle bracket can't break out of the value="" attribute.
const escAttr = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

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

function addPricingRow(prefix = '', cost = { in: 0, out: 0, cr: 0, cw5: 0, cw1: 0 }) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="px-prefix" value="${escAttr(prefix)}" placeholder="model-prefix"></td>
    <td><input type="number" step="any" class="px-num px-in" value="${cost.in || 0}"></td>
    <td><input type="number" step="any" class="px-num px-out" value="${cost.out || 0}"></td>
    <td><input type="number" step="any" class="px-num px-cr" value="${cost.cr || 0}"></td>
    <td><input type="number" step="any" class="px-num px-cw5" value="${cost.cw5 || 0}"></td>
    <td><input type="number" step="any" class="px-num px-cw1" value="${cost.cw1 || 0}"></td>
    <td style="text-align:center;"><button class="btn-del-pricing">&times;</button></td>
  `;
  tr.querySelector('.btn-del-pricing').addEventListener('click', () => tr.remove());
  // Input (and prefix family) drive the other columns live. Don't recompute
  // on load — a saved row may have a custom override. Refresh rates snaps
  // every row back to the formula.
  tr.querySelector('.px-in').addEventListener('input', () => applyDerivedRates(tr));
  tr.querySelector('.px-prefix').addEventListener('input', () => applyDerivedRates(tr));
  pricingTableBody.appendChild(tr);
}

function refreshPricingRates() {
  if (!pricingTableBody) return;
  for (const tr of pricingTableBody.querySelectorAll('tr')) applyDerivedRates(tr);
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
          const res = await fetch('/api/cursor/token');
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
    addPricingRow();
  });
  refreshPricingBtn.addEventListener('click', (e) => {
    e.preventDefault();
    refreshPricingRates();
  });

  // Tab navigation
  const tabButtons = document.querySelectorAll('#settings-tabs .modal-tab');
  const tabPanels = document.querySelectorAll('#settings-overlay .tab-panel');
  const activateTab = (name) => {
    tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    tabPanels.forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
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
    const rows = pricingTableBody.querySelectorAll('tr');
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
    // Alerts must be live from page load, not only after the modal is opened.
    if (config) applyPaceAlertSettings(config);
    // server is the source of truth; fall back to the local mirror if empty
    let layout = (config && config.CARD_LAYOUT) || {};
    if (!Object.keys(layout).length) {
      try { layout = JSON.parse(localStorage.getItem('ltm-card-layout') || '{}'); } catch { }
    }
    setCardLayout(layout);
    // apply a saved layout immediately on load (wide viewports only)
    if (hasSavedLayout() && window.innerWidth > 1100) applyLayout();

    // Analysis view panel order (source of truth: server, mirror: localStorage).
    let anLayout = (config && config.ANALYSIS_LAYOUT) || {};
    if (!Object.keys(anLayout).length) {
      try { anLayout = JSON.parse(localStorage.getItem('ltm-analysis-layout') || '{}'); } catch { }
    }
    setAnalysisLayout(anLayout);
  } catch (err) {
    console.error('Failed to load dynamic pricing from settings:', err);
  }
}
