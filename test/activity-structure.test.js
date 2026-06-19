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
