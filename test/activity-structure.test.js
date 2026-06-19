// Structural tests for the Activity dashboard. The feed is a pure front-end view
// (no jsdom — zero-dependency rule), so we assert the HTML/JS contract directly:
// the Activity lives on its own tabbed view, the card/mount ids exist, the module
// exports its renderers, and main.js + state.js are wired to them.
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ACTIVITY_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'activity.js'), 'utf8');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'main.js'), 'utf8');
const STATE_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'state.js'), 'utf8');
const CARDS_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'cards.js'), 'utf8');

test('dashboard exposes Overview + Activity tabs, each tab has a matching view', () => {
  // tab buttons
  assert.match(HTML, /class="dash-tab active"[^>]*data-view="overview"/, 'overview tab (default active) missing');
  assert.match(HTML, /class="dash-tab"[^>]*data-view="activity"/, 'activity tab missing');
  // matching views
  assert.match(HTML, /class="view active"[^>]*id="view-overview"[^>]*data-view="overview"/, 'overview view missing');
  assert.match(HTML, /class="view"[^>]*id="view-activity"[^>]*data-view="activity"/, 'activity view missing');
  // exactly one view is active by default
  const activeViews = [...HTML.matchAll(/class="view active"/g)];
  assert.equal(activeViews.length, 1, 'exactly one view should be active by default');
});

test('Activity card + mount point live inside the activity view', () => {
  const start = HTML.indexOf('id="view-activity"');
  const end = HTML.indexOf('<!-- Settings Modal Overlay -->', start);
  assert.ok(start !== -1 && end !== -1 && end > start, 'activity view block not found');
  const view = HTML.slice(start, end);
  assert.match(view, /id="activity-card"/, 'activity-card not inside activity view');
  assert.match(view, /id="activity"/, 'activity mount not inside activity view');
});

test('activity.js exports the renderer, fetch, and init wiring', () => {
  for (const name of ['renderActivity', 'fetchActivity', 'initActivity', 'initDashboardTabs']) {
    assert.match(ACTIVITY_JS, new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`), `activity.js must export ${name}`);
  }
  assert.match(ACTIVITY_JS, /\/api\/activity/, 'activity.js must call the /api/activity endpoint');
});

test('RTK 0-saved rows are labeled passthrough, not a misleading saving', () => {
  // RTK passes unfilterable commands through unchanged (0 saved by design). The
  // feed must flag those as passthrough rather than rendering "saved 0".
  assert.match(ACTIVITY_JS, /source === 'rtk'/, 'must special-case rtk rows');
  assert.match(ACTIVITY_JS, /passthrough/, 'must label 0-saved rtk rows as passthrough');
});

test('Headroom proxy rows show cache reuse as "cached", not "saved"', () => {
  // Cache reuse recurs every turn and bills at the cache-read rate, so it must
  // not be presented as a dollar saving (phantom-savings guard).
  assert.match(ACTIVITY_JS, /headroom-proxy/, 'must special-case proxy rows');
  assert.match(ACTIVITY_JS, /cached \$\{ht\(saved\)\}/, 'proxy figure must read "cached", not "saved"');
});

test('dashboard tabs persist the active view in the URL hash', () => {
  assert.match(ACTIVITY_JS, /location\.hash/, 'tab clicks must drive/read location.hash');
  assert.match(ACTIVITY_JS, /hashchange/, 'must restore the view on hashchange (refresh / back-forward)');
});

test('main.js imports and bootstraps the activity view', () => {
  assert.match(MAIN_JS, /from '\.\/activity\.js'/, 'main.js must import from activity.js');
  for (const call of ['initDashboardTabs(', 'initActivity(', 'fetchActivity(']) {
    assert.ok(MAIN_JS.includes(call), `main.js must call ${call})`);
  }
});

test('state.js holds activity feed + filter state', () => {
  assert.match(STATE_JS, /\bactivity\b\s*:/, 'state.js must have an activity field');
  assert.match(STATE_JS, /\bactivityFilter\b\s*:/, 'state.js must have an activityFilter field');
});

test('cards.js exports the RTK-install + Headroom-health pill helpers', () => {
  assert.match(CARDS_JS, /export function rtkInstallPill\b/, 'rtkInstallPill must be exported for reuse');
  assert.match(CARDS_JS, /export function headroomHealthPill\b/, 'headroomHealthPill must be exported for reuse');
});

test('Activity view renders an RTK/Headroom status strip from the SSE snapshot', () => {
  // pills are imported from cards.js (single source of truth, no duplication)
  assert.match(ACTIVITY_JS, /import \{ rtkInstallPill, headroomHealthPill \} from '\.\/cards\.js'/, 'activity.js must import the pill helpers');
  // strip is built from the last SSE snapshot and emitted as .act-status
  assert.match(ACTIVITY_JS, /state\.lastStats/, 'status strip must read state.lastStats');
  assert.match(ACTIVITY_JS, /act-status/, 'status strip must render an .act-status container');
  assert.match(ACTIVITY_JS, /rtkInstallPill\(/, 'strip must render the RTK install pill');
  assert.match(ACTIVITY_JS, /headroomHealthPill\(/, 'strip must render the Headroom health pill');
});

test('main.js repaints the Activity strip live while that tab is active', () => {
  assert.match(MAIN_JS, /paintActivity/, 'main.js must repaint activity on new SSE frames');
  assert.match(MAIN_JS, /view-activity/, 'repaint must be gated on the activity view being active');
});

test('.act-status has a stylesheet rule', () => {
  const CSS = fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8');
  assert.match(CSS, /\.act-status\s*\{/, 'index.css must style .act-status');
});
