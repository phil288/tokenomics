const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { TOOLS, collectToolVersions } = require('../src/tool-versions');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('TOOLS declares rtk and headroom with a repo/registry-backed latest fetcher', () => {
  const keys = TOOLS.map((t) => t.key);
  assert.deepEqual(keys.sort(), ['headroom', 'rtk']);
  for (const t of TOOLS) {
    assert.equal(typeof t.getCurrent, 'function');
    assert.equal(typeof t.fetchLatest, 'function');
    assert.equal(typeof t.enabled, 'function');
    assert.equal(typeof t.url, 'string');
  }
});

test('collectToolVersions returns a safe default before any poll', () => {
  const v = collectToolVersions();
  assert.equal(typeof v, 'object');
  assert.equal(v.rtk.update_available, false);
  assert.equal(v.headroom.update_available, false);
});

// ---- structural contract: tool-update banner is wired end-to-end ----

test('collectStats attaches a tool_versions field', () => {
  const src = read('src/collectors.js');
  assert.match(src, /tool_versions:\s*collectToolVersions\(\)/);
  assert.match(src, /require\(['"]\.\/tool-versions['"]\)/);
});

test('server polls tool versions on a slow timer + at startup', () => {
  const src = read('server.js');
  assert.match(src, /pollToolVersions/);
  assert.match(src, /TOOL_VERSIONS_POLL_MS/);
  // Default every 2h — release cadence is low, keeps the check well clear of
  // GitHub's/PyPI's unauthenticated rate limits.
  assert.match(src, /TOOL_VERSIONS_POLL_MS\s*=\s*Number\(process\.env\.TOOL_VERSIONS_POLL_MS\)\s*\|\|\s*7200000/);
});

test('index.html has the tool-update-banner element', () => {
  const html = read('index.html');
  assert.match(html, /id="tool-update-banner"/);
});

test('cards.js exports renderToolUpdatesBanner and toolUpdatesDismissKey', () => {
  const facade = read('src/web/cards.js');
  const src = read('src/web/cards-version.js');
  assert.match(facade, /export \{ renderToolUpdatesBanner, toolUpdatesDismissKey \} from '\.\/cards-version\.js'/);
  assert.match(src, /export function renderToolUpdatesBanner/);
  assert.match(src, /export function toolUpdatesDismissKey/);
});

test('main.js imports renderToolUpdatesBanner and renders it', () => {
  const src = read('src/web/main.js');
  assert.match(src, /renderToolUpdatesBanner/);
  assert.match(src, /renderToolUpdates\(stats\.tool_versions\)/);
  assert.match(src, /tool-update-dismissed/);
});

test('index.css styles the tool-update banner rows', () => {
  const css = read('index.css');
  assert.match(css, /\.ub-rows/);
  assert.match(css, /\.ub-row/);
});

// ---- renderToolUpdatesBanner / toolUpdatesDismissKey logic ----
// cards-version.js is an ES module; load it via a small transform so the CJS
// test runner can require it without a bundler (mirrors no other loader in
// this repo needing this — its sibling module cards.js is DOM-shape-tested
// only, but these two functions are pure enough to unit test directly).
function loadCardsVersion() {
  const src = read('src/web/cards-version.js')
    .replace(/^import.*$/m, "const { esc, escUrl } = require('./format.cjs');")
    .replace(/export function/g, 'function');
  const format = read('src/web/format.js').replace(/export function/g, 'function');
  const wrapped = `${format}\nmodule.exports = { esc, escUrl };`;
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tv-test-'));
  fs.writeFileSync(path.join(tmpDir, 'format.cjs'), wrapped);
  fs.writeFileSync(path.join(tmpDir, 'cards-version.cjs'), `${src}\nmodule.exports = { renderUpdateBanner, renderToolUpdatesBanner, toolUpdatesDismissKey };`);
  return require(path.join(tmpDir, 'cards-version.cjs'));
}

test('renderToolUpdatesBanner renders one row per tool with an update, empty otherwise', () => {
  const { renderToolUpdatesBanner } = loadCardsVersion();
  assert.equal(renderToolUpdatesBanner(null), '');
  assert.equal(renderToolUpdatesBanner({ rtk: { update_available: false } }), '');
  const html = renderToolUpdatesBanner({
    rtk: { label: 'RTK', current: '0.49.0', latest: '0.50.0', update_available: true, url: 'https://x/rtk' },
    headroom: { label: 'Headroom', current: '0.37.0', latest: '0.37.0', update_available: false, url: 'https://x/hr' },
  });
  assert.match(html, /RTK/);
  assert.match(html, /0\.50\.0/);
  assert.doesNotMatch(html, /Headroom/);
});

test('toolUpdatesDismissKey is stable and changes when a new release appears', () => {
  const { toolUpdatesDismissKey } = loadCardsVersion();
  const a = { rtk: { update_available: true, latest: '0.50.0' }, headroom: { update_available: false } };
  const b = { rtk: { update_available: true, latest: '0.51.0' }, headroom: { update_available: false } };
  assert.equal(toolUpdatesDismissKey(a), 'rtk:0.50.0');
  assert.notEqual(toolUpdatesDismissKey(a), toolUpdatesDismissKey(b));
});
