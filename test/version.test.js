const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  REPO, normalizeVersion, compareVersions, pickLatestTag, collectVersion,
} = require('../src/version');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('REPO is the static phil288/tokenomics slug', () => {
  assert.equal(REPO, 'phil288/tokenomics');
});

test('normalizeVersion strips leading v and parses parts', () => {
  assert.deepEqual(normalizeVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(normalizeVersion('1.2.3'), [1, 2, 3]);
  assert.deepEqual(normalizeVersion('V2'), [2, 0, 0]);
  assert.deepEqual(normalizeVersion('1.4'), [1, 4, 0]);
  assert.deepEqual(normalizeVersion('v1.2.3-beta.1'), [1, 2, 3]);
});

test('normalizeVersion rejects non-semver', () => {
  assert.equal(normalizeVersion('latest'), null);
  assert.equal(normalizeVersion(''), null);
  assert.equal(normalizeVersion(null), null);
  assert.equal(normalizeVersion(undefined), null);
});

test('compareVersions orders semver correctly', () => {
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('v2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.0', 'v1.0.0'), 0);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
});

test('compareVersions: non-semver sorts lowest', () => {
  assert.equal(compareVersions('garbage', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', 'garbage'), 1);
  assert.equal(compareVersions('garbage', 'junk'), 0);
});

test('pickLatestTag returns the max semver tag regardless of input order', () => {
  // GitHub /tags is not guaranteed to be in semver order.
  const tags = [{ name: 'v1.0.0' }, { name: 'v1.10.0' }, { name: 'v1.2.0' }, { name: 'nightly' }];
  assert.equal(pickLatestTag(tags), 'v1.10.0');
});

test('pickLatestTag accepts plain-string arrays and ignores junk', () => {
  assert.equal(pickLatestTag(['v0.9.0', 'v1.0.0', 'wip']), 'v1.0.0');
  assert.equal(pickLatestTag([]), null);
  assert.equal(pickLatestTag(null), null);
  assert.equal(pickLatestTag([{ name: 'beta' }]), null);
});

test('collectVersion returns a safe default before any poll', () => {
  const v = collectVersion();
  assert.equal(typeof v, 'object');
  assert.equal(v.update_available, false);
});

// ---- structural contract: banner is wired end-to-end ----

test('collectStats attaches a version field', () => {
  const src = read('src/collectors.js');
  assert.match(src, /version:\s*collectVersion\(\)/);
  assert.match(src, /require\(['"]\.\/version['"]\)/);
});

test('server polls the version on a slow timer + at startup', () => {
  const src = read('server.js');
  assert.match(src, /pollVersion/);
  assert.match(src, /VERSION_POLL_MS/);
});

test('index.html has the update-banner element', () => {
  const html = read('index.html');
  assert.match(html, /id="update-banner"/);
});

test('cards.js exports renderUpdateBanner and gates on update_available', () => {
  const src = read('src/web/cards.js');
  assert.match(src, /export function renderUpdateBanner/);
  assert.match(src, /update_available/);
});

test('main.js imports renderUpdateBanner and renders it', () => {
  const src = read('src/web/main.js');
  assert.match(src, /renderUpdateBanner/);
  assert.match(src, /renderUpdate\(stats\.version\)/);
  // dismissal keyed by latest version so a newer release re-shows
  assert.match(src, /update-dismissed/);
});

test('index.css styles the update banner', () => {
  const css = read('index.css');
  assert.match(css, /\.update-banner/);
});

test('header shows an app-version element and main.js fills it from version.current', () => {
  assert.match(read('index.html'), /id="app-version"/);
  const main = read('src/web/main.js');
  assert.match(main, /renderVersion\(stats\.version\)/);
  assert.match(main, /version\.current/);
  assert.match(read('index.css'), /\.app-version/);
});
