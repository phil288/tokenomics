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
  HEADROOM_SAVINGS_PATH: '',
  PRICING: DEFAULT_PRICING,
  // Free-drag card layout: { "<card-id>": { x, y, w } } in px. Empty = native grid.
  CARD_LAYOUT: {}
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

function updateSettings(parsed) {
  for (const key of ['RTK_ENABLED', 'CAVEMAN_ENABLED', 'CLAUDE_ENABLED', 'HEADROOM_ENABLED', 'CURSOR_ENABLED', 'ANTIGRAVITY_ENABLED']) {
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
  if (Array.isArray(parsed.PRICING)) {
    settings.PRICING = parsed.PRICING;
  }
  if (parsed.CARD_LAYOUT && typeof parsed.CARD_LAYOUT === 'object') {
    settings.CARD_LAYOUT = parsed.CARD_LAYOUT;
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
