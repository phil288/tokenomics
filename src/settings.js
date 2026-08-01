const fs = require('fs');
const path = require('path');

// DATA_DIR is overridable via env so tests can isolate state to a temp dir
// instead of clobbering the real (gitignored) data/ directory.
const DATA_DIR = process.env.TOKENOMICS_DATA_DIR || path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_PRICING = [
  ['claude-opus-4',         { in: 5,   out: 25,  cr: 0.50, cw5: 6.25,  cw1: 10  }],
  ['claude-sonnet-4',       { in: 3,   out: 15,  cr: 0.30, cw5: 3.75,  cw1: 6   }],
  ['claude-haiku-4',        { in: 1,   out: 5,   cr: 0.10, cw5: 1.25,  cw1: 2   }],
  ['claude-fable-5',        { in: 10,  out: 50,  cr: 1.00, cw5: 12.50, cw1: 20  }],
  ['antigravity-3.5-flash', { in: 1.5, out: 9,   cr: 0.15, cw5: 1.875, cw1: 3.0  }],
  ['gemini-3.5-flash',      { in: 1.5, out: 9,   cr: 0.15, cw5: 1.875, cw1: 3.0  }],
  ['antigravity-3.1-pro',   { in: 2,   out: 12,  cr: 0.20, cw5: 2.50,  cw1: 4.0  }],
  ['gemini-3.1-pro',        { in: 2,   out: 12,  cr: 0.20, cw5: 2.50,  cw1: 4.0  }],
  ['cursor-opus',           { in: 5,   out: 25,  cr: 0.50, cw5: 6.25,  cw1: 10  }],
  ['cursor-sonnet',         { in: 3,   out: 15,  cr: 0.30, cw5: 3.75,  cw1: 6   }],
  ['cursor-haiku',          { in: 1,   out: 5,   cr: 0.10, cw5: 1.25,  cw1: 2   }],
  ['cursor-small',          { in: 0.1, out: 0.5,  cr: 0.01, cw5: 0.125, cw1: 0.2  }],
];

let settings = {
  // Per-card visibility toggles. CURSOR_ENABLED / ANTIGRAVITY_ENABLED also gate
  // their (expensive) data collection; the rest are display-only.
  RTK_ENABLED: true,
  CAVEMAN_ENABLED: true,
  CLAUDE_ENABLED: true,
  HEADROOM_ENABLED: true,
  CURSOR_ENABLED: true,
  ANTIGRAVITY_ENABLED: true,
  CURSOR_ACCESS_TOKEN: '',
  RTK_DATA_HOME: '',
  // Headroom writes savings and subscription state to TWO separate files
  // (see Headroom's filesystem-contract). HEADROOM_SAVINGS_PATH is the
  // authoritative savings ledger (proxy_savings.json); the subscription
  // state file holds quota windows + raw window-token telemetry only.
  HEADROOM_SAVINGS_PATH: '',
  HEADROOM_SUBSCRIPTION_STATE_PATH: '',
  // Headroom proxy health endpoint. Probed each refresh to show a live
  // up/down status pill on the Headroom card. Empty string disables the probe.
  HEADROOM_HEALTH_URL: 'http://127.0.0.1:8787/health',
  // Desktop pacing alerts (browser Notification API, fired by the dashboard
  // tab). Thresholds are a percentage OF THE PACING BUDGET, not of the quota:
  // 80 → warn once the bar has used 80% of what it may have used by now.
  PACE_ALERTS_ENABLED: false,
  PACE_ALERT_WARN_PCT: 80,
  PACE_ALERT_OVER_PCT: 100,
  PRICING: DEFAULT_PRICING,
  // Free-drag card layout: { "<card-id>": { x, y, w } } in px. Empty = native grid.
  CARD_LAYOUT: {},
  // Analysis view panel order: { "<section>": ["<blockKey>", …] } per section
  // (rtk/cav/hr). Empty = the HTML's native block order.
  ANALYSIS_LAYOUT: {}
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      settings = { ...settings, ...parsed };
    }
  } catch (err) {
    console.error('Failed to load settings:', err.message);
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save settings:', err.message);
  }
}

function getSettings() {
  return {
    ...settings,
    CURSOR_ACCESS_TOKEN: settings.CURSOR_ACCESS_TOKEN || ''
  };
}

// Alert thresholds are user-typed: keep them a sane percentage or fall back to
// the current value rather than persisting NaN/0/absurd numbers.
function clampAlertPct(value, current) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return current;
  return Math.min(500, Math.round(n * 10) / 10);
}

function updateSettings(parsed) {
  for (const key of ['RTK_ENABLED', 'CAVEMAN_ENABLED', 'CLAUDE_ENABLED', 'HEADROOM_ENABLED', 'CURSOR_ENABLED', 'ANTIGRAVITY_ENABLED', 'PACE_ALERTS_ENABLED']) {
    if (typeof parsed[key] === 'boolean') {
      settings[key] = parsed[key];
    } else if (parsed[key] !== undefined) {
      settings[key] = parsed[key] === 'true' || parsed[key] === 1;
    }
  }
  if (parsed.CURSOR_ACCESS_TOKEN !== undefined) {
    settings.CURSOR_ACCESS_TOKEN = parsed.CURSOR_ACCESS_TOKEN.trim();
  }
  if (parsed.RTK_DATA_HOME !== undefined) {
    settings.RTK_DATA_HOME = parsed.RTK_DATA_HOME.trim();
  }
  if (parsed.HEADROOM_SAVINGS_PATH !== undefined) {
    settings.HEADROOM_SAVINGS_PATH = parsed.HEADROOM_SAVINGS_PATH.trim();
  }
  if (parsed.HEADROOM_HEALTH_URL !== undefined) {
    settings.HEADROOM_HEALTH_URL = parsed.HEADROOM_HEALTH_URL.trim();
  }
  if (parsed.HEADROOM_SUBSCRIPTION_STATE_PATH !== undefined) {
    settings.HEADROOM_SUBSCRIPTION_STATE_PATH = parsed.HEADROOM_SUBSCRIPTION_STATE_PATH.trim();
  }
  if (parsed.PACE_ALERT_WARN_PCT !== undefined) {
    settings.PACE_ALERT_WARN_PCT = clampAlertPct(parsed.PACE_ALERT_WARN_PCT, settings.PACE_ALERT_WARN_PCT);
  }
  if (parsed.PACE_ALERT_OVER_PCT !== undefined) {
    settings.PACE_ALERT_OVER_PCT = clampAlertPct(parsed.PACE_ALERT_OVER_PCT, settings.PACE_ALERT_OVER_PCT);
  }
  if (Array.isArray(parsed.PRICING)) {
    settings.PRICING = parsed.PRICING;
  }
  if (parsed.CARD_LAYOUT && typeof parsed.CARD_LAYOUT === 'object') {
    settings.CARD_LAYOUT = parsed.CARD_LAYOUT;
  }
  if (parsed.ANALYSIS_LAYOUT && typeof parsed.ANALYSIS_LAYOUT === 'object') {
    settings.ANALYSIS_LAYOUT = parsed.ANALYSIS_LAYOUT;
  }
  saveSettings();
  return getSettings();
}

function priceFor(name) {
  const currentPricing = settings.PRICING || DEFAULT_PRICING;
  for (const [prefix, p] of currentPricing) {
    if (name.startsWith(prefix)) return p;
  }
  return null;
}

// Load settings immediately on import
loadSettings();

module.exports = {
  get settings() { return settings; },
  loadSettings,
  saveSettings,
  getSettings,
  updateSettings,
  priceFor,
  DEFAULT_PRICING
};
