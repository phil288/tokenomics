// ============ SETTINGS MODAL & LOGIC ============
import { PRICING } from './pricing.js';
import { setCardLayout, hasSavedLayout, applyLayout } from './layout.js';
import { manualRefresh } from './main.js';
import { fetchHistory } from './charts.js';

let settingsOverlay, cursorEnabledCb, cursorTokenGroup, pricingTableBody;

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
    cursorTokenGroup.style.display = cursorEnabledCb.checked ? 'flex' : 'none';

    document.getElementById('set-vis-rtk').checked = config.RTK_ENABLED !== false;
    document.getElementById('set-vis-caveman').checked = config.CAVEMAN_ENABLED !== false;
    document.getElementById('set-vis-claude').checked = config.CLAUDE_ENABLED !== false;
    document.getElementById('set-vis-headroom').checked = config.HEADROOM_ENABLED !== false;
    document.getElementById('set-vis-antigravity').checked = config.ANTIGRAVITY_ENABLED !== false;

    document.getElementById('set-cursor-token').value = config.CURSOR_ACCESS_TOKEN || '';
    document.getElementById('set-rtk-home').value = config.RTK_DATA_HOME || '';
    document.getElementById('set-headroom-path').value = config.HEADROOM_SAVINGS_PATH || '';
    document.getElementById('set-headroom-sub-path').value = config.HEADROOM_SUBSCRIPTION_STATE_PATH || '';
    document.getElementById('set-headroom-health-url').value = config.HEADROOM_HEALTH_URL !== undefined ? config.HEADROOM_HEALTH_URL : 'http://127.0.0.1:8787/health';

    pricingTableBody.innerHTML = '';
    const pricing = config.PRICING || [];
    for (const [prefix, cost] of pricing) {
      addPricingRow(prefix, cost);
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function addPricingRow(prefix = '', cost = { in: 0, out: 0, cr: 0, cw5: 0, cw1: 0 }) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="px-prefix" value="${prefix}" placeholder="model-prefix"></td>
    <td><input type="number" step="any" class="px-num px-in" value="${cost.in || 0}"></td>
    <td><input type="number" step="any" class="px-num px-out" value="${cost.out || 0}"></td>
    <td><input type="number" step="any" class="px-num px-cr" value="${cost.cr || 0}"></td>
    <td><input type="number" step="any" class="px-num px-cw5" value="${cost.cw5 || 0}"></td>
    <td><input type="number" step="any" class="px-num px-cw1" value="${cost.cw1 || 0}"></td>
    <td style="text-align:center;"><button class="btn-del-pricing">&times;</button></td>
  `;
  tr.querySelector('.btn-del-pricing').addEventListener('click', () => tr.remove());
  pricingTableBody.appendChild(tr);
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

  cursorEnabledCb.addEventListener('change', () => {
    cursorTokenGroup.style.display = cursorEnabledCb.checked ? 'flex' : 'none';
  });

  const toggleCursorTokenBtn = document.getElementById('toggle-cursor-token');
  const eyeIconClosed = document.getElementById('eye-icon-closed');
  const eyeIconOpen = document.getElementById('eye-icon-open');
  const cursorTokenInput = document.getElementById('set-cursor-token');

  toggleCursorTokenBtn.addEventListener('click', () => {
    if (cursorTokenInput.type === 'password') {
      cursorTokenInput.type = 'text';
      eyeIconClosed.style.display = 'none';
      eyeIconOpen.style.display = 'block';
    } else {
      cursorTokenInput.type = 'password';
      eyeIconClosed.style.display = 'block';
      eyeIconOpen.style.display = 'none';
    }
  });

  addPricingRowBtn.addEventListener('click', (e) => {
    e.preventDefault();
    addPricingRow();
  });

  settingsBtn.addEventListener('click', () => {
    loadSettingsUI().then(() => {
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
      const res = await fetch('/api/history/reset', { method: 'POST' });
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
    // apply a saved layout immediately on load (wide viewports only)
    if (hasSavedLayout() && window.innerWidth > 1100) applyLayout();
  } catch (err) {
    console.error('Failed to load dynamic pricing from settings:', err);
  }
}
