// Structural tests for the tabbed settings modal. The tabs are pure front-end
// DOM (no jsdom — zero-dependency rule), so these assert the HTML/JS contract
// that the tab nav stays wired: every tab has a panel, exactly one is active by
// default, each setting lives in the right panel, and the footer stays global.
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SETTINGS_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'settings.js'), 'utf8');

const TABS = ['sources', 'connections', 'pricing', 'data'];

// Inner HTML of one tab panel: from `data-panel="name">` to its `<!-- /Tab: -->`.
function panelBody(name) {
  const start = HTML.indexOf(`data-panel="${name}"`);
  assert.notEqual(start, -1, `panel ${name} missing`);
  const open = HTML.indexOf('>', start) + 1;
  const close = HTML.indexOf('<!-- /Tab:', open);
  assert.notEqual(close, -1, `panel ${name} not closed`);
  return HTML.slice(open, close);
}

test('every tab button has a matching panel and vice versa', () => {
  for (const name of TABS) {
    assert.match(HTML, new RegExp(`class="modal-tab[^"]*"[^>]*data-tab="${name}"`), `tab button ${name} missing`);
    assert.match(HTML, new RegExp(`class="tab-panel[^"]*"[^>]*data-panel="${name}"`), `panel ${name} missing`);
  }
  // No stray tabs/panels beyond the known set.
  const tabAttrs = [...HTML.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
  const panelAttrs = [...HTML.matchAll(/data-panel="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabAttrs.sort(), [...TABS].sort());
  assert.deepEqual(panelAttrs.sort(), [...TABS].sort());
});

test('exactly one tab and one panel are active by default (sources)', () => {
  const activeTabs = [...HTML.matchAll(/class="modal-tab active"[^>]*data-tab="([^"]+)"/g)].map((m) => m[1]);
  const activePanels = [...HTML.matchAll(/class="tab-panel active"[^>]*data-panel="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(activeTabs, ['sources']);
  assert.deepEqual(activePanels, ['sources']);
});

test('each setting field lives in its expected panel', () => {
  const inPanel = (name, id) => assert.ok(panelBody(name).includes(`id="${id}"`), `${id} should be in ${name} panel`);

  inPanel('sources', 'set-vis-rtk');
  inPanel('sources', 'set-vis-antigravity');
  inPanel('connections', 'set-cursor-token');
  inPanel('connections', 'set-rtk-home');
  inPanel('connections', 'set-headroom-health-url');
  inPanel('pricing', 'pricing-table-body');
  inPanel('pricing', 'btn-add-pricing-row');
  inPanel('data', 'reset-stats-btn');
});

test('save/cancel footer stays outside every tab panel', () => {
  const lastClose = HTML.lastIndexOf('<!-- /Tab:');
  const footer = HTML.indexOf('class="modal-footer"');
  assert.ok(footer > lastClose, 'modal-footer must come after the last tab panel closes');
});

test('settings.js wires tab switching and opens on the first tab', () => {
  assert.match(SETTINGS_JS, /#settings-tabs \.modal-tab/, 'tab buttons not queried');
  assert.match(SETTINGS_JS, /activateTab\(/, 'activateTab not defined/used');
  assert.match(SETTINGS_JS, /activateTab\('sources'\)/, 'modal should reset to the sources tab on open');
});
