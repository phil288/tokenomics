// Structural (DOM-contract) tests for the Analysis view. No jsdom (zero-dep
// rule), so we assert the HTML/JS contract by reading the files: the tab+view
// exist and pair, every element the frontend paints into is present, main.js
// bootstraps the module, analysis.js hits the four endpoints, and the activity
// feed learned the caveman source. Mirrors test/settings-tabs.test.js.
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'main.js'), 'utf8');
const ANALYSIS_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'analysis.js'), 'utf8');
const ACTIVITY_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'activity.js'), 'utf8');
const CHARTS_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'charts.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8');

test('an Analysis tab button pairs with a #view-analysis view container', () => {
  assert.match(HTML, /class="dash-tab"[^>]*data-view="analysis"/);
  assert.match(HTML, /class="view"[^>]*id="view-analysis"[^>]*data-view="analysis"/);
});

test('every element analysis.js paints into exists in the HTML', () => {
  const ids = [
    // RTK
    'an-rtk-since', 'an-rtk-period', 'an-rtk-pct', 'an-rtk-exec',
    'an-rtk-projects', 'an-rtk-types', 'an-rtk-losses',
    // Caveman
    'an-cav-since', 'an-cav-sessions', 'an-cav-models', 'an-cav-modes', 'an-cav-growth',
    // Headroom
    'an-hr-since', 'an-hr-spend', 'an-hr-models', 'an-hr-quota', 'an-hr-cache',
    'an-hr-strategies', 'an-hr-transforms', 'an-hr-window-note',
    // toggles
    'an-rtk-period-toggle', 'an-hr-unit-toggle',
  ];
  for (const id of ids) assert.ok(HTML.includes(`id="${id}"`), `missing #${id}`);
});

test('period + unit toggles expose the options analysis.js reads', () => {
  for (const p of ['daily', 'weekly', 'monthly']) {
    assert.ok(HTML.includes(`data-period="${p}"`), `missing period ${p}`);
  }
  for (const u of ['tokens', 'usd']) {
    assert.ok(HTML.includes(`data-unit="${u}"`), `missing unit ${u}`);
  }
});

test('main.js imports and bootstraps the analysis module', () => {
  assert.match(MAIN_JS, /import\s*\{[^}]*initAnalysis[^}]*\}\s*from\s*'\.\/analysis\.js'/);
  assert.match(MAIN_JS, /initAnalysis\(\)/);
});

test('analysis.js fetches all four on-demand endpoints', () => {
  for (const ep of [
    '/api/analysis/rtk/projects',
    '/api/analysis/rtk/commands',
    '/api/analysis/rtk/losses',
    '/api/analysis/caveman',
    '/api/analysis/headroom/models',
    '/api/analysis/headroom/ops',
  ]) {
    assert.ok(ANALYSIS_JS.includes(ep), `analysis.js should fetch ${ep}`);
  }
});

test('analysis.js registers a redraw hook so theme flips repaint its charts', () => {
  assert.match(CHARTS_JS, /export function registerRedraw/);
  assert.match(ANALYSIS_JS, /registerRedraw\(/);
});

test('activity feed knows the caveman source (SOURCE_META + FILTERS + matchFilter)', () => {
  assert.match(ACTIVITY_JS, /'caveman':\s*\{[^}]*name:\s*'Caveman'/);
  assert.match(ACTIVITY_JS, /key:\s*'caveman'/);
  assert.match(ACTIVITY_JS, /row\.source === 'caveman'/);
});

test('index.css styles the analysis blocks and tables', () => {
  for (const sel of ['.an-grid', '.an-block', '.an-table', '.an-tile', '.an-tgl']) {
    assert.ok(CSS.includes(sel), `missing CSS ${sel}`);
  }
});

test('analysis tables avoid horizontal scroll and reserve the scrollbar gutter', () => {
  // fixed table layout keeps content inside the block (no x-scroll); the wrap
  // scrolls only vertically with a stable gutter so text is never covered.
  assert.match(CSS, /\.an-table\s*\{[^}]*table-layout:\s*fixed/);
  assert.match(CSS, /\.an-table-wrap\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(CSS, /\.an-table-wrap\s*\{[^}]*scrollbar-gutter:\s*stable/);
});

test('tables are click-to-sort: sortable headers, per-mount state, CSS affordance', () => {
  assert.match(ANALYSIS_JS, /function mountTable/);
  assert.match(ANALYSIS_JS, /data-col=/);          // headers carry a column index
  assert.match(ANALYSIS_JS, /aria-sort=/);          // and expose sort direction
  assert.match(ANALYSIS_JS, /tableSort\b/);         // per-mount sort state
  // every table is rendered through mountTable (no direct innerHTML = tableHtml)
  assert.ok(!/tableHtml\s*\(/.test(ANALYSIS_JS), 'old tableHtml renderer should be gone');
  for (const mount of ['an-rtk-projects', 'an-rtk-types', 'an-rtk-losses', 'an-cav-sessions', 'an-hr-strategies', 'an-hr-transforms']) {
    assert.ok(ANALYSIS_JS.includes(`mountTable('${mount}'`), `${mount} not mounted sortable`);
  }
  assert.match(CSS, /\.an-th\s*\{/);
});

test('analysis panels are free-draggable via the shared arrange mode (layout.js)', () => {
  const LAYOUT_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'layout.js'), 'utf8');
  // layout.js treats each analysis grid as a board and persists ANALYSIS_LAYOUT
  assert.match(LAYOUT_JS, /#view-analysis \.an-grid/);
  assert.match(LAYOUT_JS, /ANALYSIS_LAYOUT/);
  assert.match(LAYOUT_JS, /export function setAnalysisLayout/);
  assert.match(LAYOUT_JS, /export const isArranging/);
  // every analysis panel has a stable id to key its saved position
  for (const id of [
    'anb-rtk-period', 'anb-rtk-projects', 'anb-rtk-losses',
    'anb-cav-sessions', 'anb-cav-growth', 'anb-hr-models', 'anb-hr-strategies',
  ]) assert.ok(HTML.includes(`id="${id}"`), `missing panel id ${id}`);
  // arrange CSS mirrors the overview board
  assert.match(CSS, /\.an-grid\.arranged/);
  assert.match(CSS, /\.an-grid\.editing/);
  // settings.js loads saved positions back through layout's setter
  const SETTINGS_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'settings.js'), 'utf8');
  assert.match(SETTINGS_JS, /setAnalysisLayout/);
  // arrange mode suppresses table sorting during a drag
  assert.match(ANALYSIS_JS, /isArranging\(\)/);
});
