// ---- external tool update check: RTK + Headroom ----
// Mirrors the self-update pattern in src/version.js (same normalize/compare
// helpers) but for the two CLI tools Tokenomics depends on. Both are polled
// on a slow timer (release cadence is low; RTK hits GitHub's tags API,
// Headroom hits PyPI's JSON API) so collectStats only ever reads the cache.
const { exec } = require('child_process');
const { normalizeVersion, compareVersions, pickLatestTag } = require('./version');
const { settings } = require('./settings');

const POLL_TIMEOUT_MS = 4000;

function execText(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 5000 }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

// `rtk --version` -> "rtk 0.49.0"
async function getRtkCurrentVersion() {
  const out = await execText('rtk --version');
  if (!out) return null;
  const m = out.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

// `headroom --version` -> "headroom, version 0.37.0"
async function getHeadroomCurrentVersion() {
  const out = await execText('headroom --version');
  if (!out) return null;
  const m = out.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

async function fetchJson(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), POLL_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRtkLatest() {
  const tags = await fetchJson('https://api.github.com/repos/rtk-ai/rtk/tags?per_page=100', {
    Accept: 'application/vnd.github+json', 'User-Agent': 'tokenomics-dashboard',
  });
  return pickLatestTag(tags);
}

// PyPI JSON API: info.version is always the latest released version.
async function fetchHeadroomLatest() {
  const data = await fetchJson('https://pypi.org/pypi/headroom-ai/json', { 'User-Agent': 'tokenomics-dashboard' });
  return data && data.info ? data.info.version : null;
}

const TOOLS = [
  {
    key: 'rtk', label: 'RTK', url: 'https://github.com/rtk-ai/rtk/releases',
    getCurrent: getRtkCurrentVersion, fetchLatest: fetchRtkLatest,
    enabled: () => settings.RTK_ENABLED !== false,
  },
  {
    key: 'headroom', label: 'Headroom', url: 'https://pypi.org/project/headroom-ai/#history',
    getCurrent: getHeadroomCurrentVersion, fetchLatest: fetchHeadroomLatest,
    enabled: () => settings.HEADROOM_ENABLED !== false,
  },
];

let cache = Object.fromEntries(TOOLS.map((t) => [t.key, { update_available: false, current: null, latest: null }]));

async function pollOne(tool) {
  if (!tool.enabled()) return { ...cache[tool.key], update_available: false };
  try {
    const [current, latest] = await Promise.all([tool.getCurrent(), tool.fetchLatest()]);
    return {
      label: tool.label,
      current,
      latest,
      url: tool.url,
      update_available: !!(current && latest && normalizeVersion(current) && compareVersions(current, latest) < 0),
      checked_at: new Date().toISOString(),
      stale: false,
      error: null,
    };
  } catch (e) {
    return { ...cache[tool.key], label: tool.label, stale: true, error: e.message };
  }
}

async function pollToolVersions() {
  const results = await Promise.all(TOOLS.map(pollOne));
  cache = Object.fromEntries(TOOLS.map((t, i) => [t.key, results[i]]));
  return cache;
}

function collectToolVersions() {
  return cache;
}

module.exports = { TOOLS, pollToolVersions, collectToolVersions };
