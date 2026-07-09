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
  inPanel('connections', 'test-cursor-token');
  inPanel('connections', 'cursor-token-status');
  inPanel('connections', 'set-rtk-home');
  inPanel('connections', 'set-headroom-health-url');
  inPanel('pricing', 'pricing-table-body');
  inPanel('pricing', 'btn-add-pricing-row');
  inPanel('data', 'reset-stats-btn');
  inPanel('data', 'restore-baseline-btn');
});

test('the restore-baseline control is present and wired to DELETE /api/baseline', () => {
  assert.ok(HTML.includes('id="restore-baseline-btn"'), 'restore button missing from HTML');
  assert.match(SETTINGS_JS, /restore-baseline-btn/, 'restore button not queried in settings.js');
  assert.match(SETTINGS_JS, /fetch\('\/api\/baseline',\s*\{\s*method:\s*'DELETE'\s*\}\)/, 'restore not wired to DELETE /api/baseline');
});

test('reset-stats is wired to POST /api/history/reset with the confirm header', () => {
  // The server rejects unconfirmed resets; the client must send the header.
  assert.match(SETTINGS_JS, /X-Tokenomics-Reset-Confirm['"]:\s*['"]manual['"]/, 'reset fetch missing confirm header');
});

test('the cursor token field is re-masked every time the settings modal opens', () => {
  // Opening the modal must reset the field to hidden (password) so a token
  // revealed in a prior open never reappears in plain text.
  assert.match(SETTINGS_JS, /function resetCursorTokenReveal\(\)/, 'resetCursorTokenReveal helper missing');
  assert.match(SETTINGS_JS, /input\.type\s*=\s*'password'/, 'reset must force the field back to password type');
  // …and it must be invoked from the modal-open/populate path.
  assert.match(SETTINGS_JS, /resetCursorTokenReveal\(\);/, 'reset not called on open');
});

test('the cursor-token reveal button fetches the effective token from /api/cursor/token', () => {
  // Revealing an empty token field pulls the stored (settings/env/DB) token so
  // the user can view a token they never typed in — but must not clobber text
  // they are editing (only fill when blank).
  assert.match(SETTINGS_JS, /fetch\('\/api\/cursor\/token'\)/, 'reveal not wired to GET /api/cursor/token');
  assert.match(SETTINGS_JS, /if\s*\(!cursorTokenInput\.value\)/, 'must guard against clobbering a non-empty field');
});

test('the Test-token button POSTs the field value to /api/cursor/test', () => {
  assert.ok(HTML.includes('id="test-cursor-token"'), 'Test token button missing from HTML');
  assert.ok(HTML.includes('id="cursor-token-status"'), 'token status span missing from HTML');
  assert.match(SETTINGS_JS, /fetch\('\/api\/cursor\/test'/, 'Test button not wired to POST /api/cursor/test');
  assert.match(SETTINGS_JS, /method:\s*'POST'/, 'cursor test must be a POST');
  // Must read the body as text and JSON.parse defensively — a stale server
  // returns non-JSON ("Not found"), which would otherwise throw a SyntaxError.
  assert.match(SETTINGS_JS, /res\.text\(\)[\s\S]*JSON\.parse/, 'cursor test must parse the response defensively');
});

test('pricing prefix values are attribute-escaped before templating', () => {
  // User-editable prefixes are re-rendered into value="…" — must go through escAttr.
  assert.match(SETTINGS_JS, /value="\$\{escAttr\(prefix\)\}"/, 'px-prefix must interpolate escAttr(prefix), not raw prefix');
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
