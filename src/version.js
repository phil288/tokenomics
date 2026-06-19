// ---- self-update check: compare running version to latest GitHub tag ----
// The app advertises new versions by git tags. This module resolves the
// version the running checkout is at, fetches the newest semver tag from the
// repo on GitHub, and reports whether an update is available. Polled on a slow
// timer (tags change rarely + unauthenticated GitHub API = 60 req/hr/IP), so
// collectStats only reads the cached result — never blocks the SSE loop.
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
// Static repo the dashboard checks for new release tags.
const REPO = 'phil288/tokenomics';
const POLL_TIMEOUT_MS = 4000;

// Strip a leading "v"/"V" and any +build / -pre suffix, returning [major,minor,patch]
// as numbers, or null when the string isn't a recognizable semver-ish tag.
function normalizeVersion(tag) {
  if (tag == null) return null;
  const m = String(tag).trim().replace(/^[vV]/, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]) || 0, Number(m[2]) || 0, Number(m[3]) || 0];
}

// -1 if a<b, 0 if equal, 1 if a>b. Non-semver inputs sort as lowest.
function compareVersions(a, b) {
  const pa = normalizeVersion(a), pb = normalizeVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

// GitHub /tags is NOT guaranteed in semver order, so pick the max ourselves.
// Accepts the parsed JSON array (or {name} list); ignores non-semver tags.
function pickLatestTag(tags) {
  if (!Array.isArray(tags)) return null;
  let best = null;
  for (const t of tags) {
    const name = typeof t === 'string' ? t : (t && t.name);
    if (!name || !normalizeVersion(name)) continue;
    if (best === null || compareVersions(name, best) > 0) best = name;
  }
  return best;
}

function execText(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd: REPO_ROOT, timeout: 5000 }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

// Version the running checkout is at: prefer the nearest git tag (so it tracks
// the same scheme GitHub advertises), fall back to package.json version.
async function getCurrentVersion() {
  const described = await execText('git describe --tags --abbrev=0');
  if (described) return described;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    if (pkg && pkg.version) return pkg.version;
  } catch { /* ignore */ }
  return null;
}

// Fetch tags from GitHub and return the newest semver tag name, or throws.
async function fetchLatestTag(slug) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), POLL_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/tags?per_page=100`, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'tokenomics-dashboard' },
    });
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
    const tags = await res.json();
    return pickLatestTag(tags);
  } finally {
    clearTimeout(timer);
  }
}

let versionCache = { update_available: false, current: null, latest: null };

// One refresh of the cache. Keeps the last good result and only flags an error
// on failure (mirrors the Antigravity/Headroom collectors' stale-on-error policy).
async function pollVersion() {
  try {
    const [current, latest] = await Promise.all([getCurrentVersion(), fetchLatestTag(REPO)]);
    versionCache = {
      current,
      latest,
      repo: REPO,
      url: `https://github.com/${REPO}/releases`,
      update_available: !!(current && latest && compareVersions(current, latest) < 0),
      checked_at: new Date().toISOString(),
      stale: false,
      error: null,
    };
  } catch (e) {
    versionCache = { ...versionCache, stale: true, error: e.message };
  }
  return versionCache;
}

// Synchronous read of the cache for collectStats (never does I/O).
function collectVersion() {
  return versionCache;
}

module.exports = {
  REPO,
  normalizeVersion,
  compareVersions,
  pickLatestTag,
  getCurrentVersion,
  fetchLatestTag,
  pollVersion,
  collectVersion,
};
