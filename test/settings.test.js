// Functional tests for settings load/coerce/persist. Isolated to a temp data
// dir so the real data/settings.json is never touched.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-set-'));
process.env.TOKENOMICS_DATA_DIR = DATA_DIR;
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const { getSettings, updateSettings } = require('../src/settings');
const readPersisted = () => JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));

test('getSettings returns defaults before any update', () => {
  const s = getSettings();
  assert.equal(s.RTK_ENABLED, true);
  assert.equal(s.CURSOR_ACCESS_TOKEN, '');
  assert.ok(Array.isArray(s.PRICING) && s.PRICING.length >= 12);
  assert.deepEqual(s.CARD_LAYOUT, {});
});

test('updateSettings coerces booleans from strings and numbers', () => {
  const s = updateSettings({
    RTK_ENABLED: false,
    CURSOR_ENABLED: 'true',
    CLAUDE_ENABLED: 1,
    HEADROOM_ENABLED: 'false',
    ANTIGRAVITY_ENABLED: 0,
  });
  assert.equal(s.RTK_ENABLED, false);
  assert.equal(s.CURSOR_ENABLED, true);
  assert.equal(s.CLAUDE_ENABLED, true);
  assert.equal(s.HEADROOM_ENABLED, false);
  assert.equal(s.ANTIGRAVITY_ENABLED, false);
});

test('updateSettings trims string paths and tokens', () => {
  const s = updateSettings({
    CURSOR_ACCESS_TOKEN: '  secret-token  ',
    RTK_DATA_HOME: '  /tmp/rtk  ',
    HEADROOM_SAVINGS_PATH: ' /tmp/hr.json ',
  });
  assert.equal(s.CURSOR_ACCESS_TOKEN, 'secret-token');
  assert.equal(s.RTK_DATA_HOME, '/tmp/rtk');
  assert.equal(s.HEADROOM_SAVINGS_PATH, '/tmp/hr.json');
});

test('updateSettings replaces PRICING only when given an array', () => {
  const custom = [['claude-opus-4', { in: 9, out: 9, cr: 9, cw5: 9, cw1: 9 }]];
  assert.deepEqual(updateSettings({ PRICING: custom }).PRICING, custom);

  // a non-array PRICING is ignored, leaving the prior value intact
  assert.deepEqual(updateSettings({ PRICING: 'nope' }).PRICING, custom);
});

test('updateSettings stores a CARD_LAYOUT object, ignores non-objects', () => {
  const layout = { 'rtk-card': { x: 10, y: 20, w: 300 } };
  assert.deepEqual(updateSettings({ CARD_LAYOUT: layout }).CARD_LAYOUT, layout);
  assert.deepEqual(updateSettings({ CARD_LAYOUT: 'nope' }).CARD_LAYOUT, layout);
});

test('updateSettings persists to disk', () => {
  updateSettings({ RTK_ENABLED: false, CURSOR_ACCESS_TOKEN: 'persisted' });
  const onDisk = readPersisted();
  assert.equal(onDisk.RTK_ENABLED, false);
  assert.equal(onDisk.CURSOR_ACCESS_TOKEN, 'persisted');
});

test('settings reload picks up the persisted file', () => {
  updateSettings({ CLAUDE_ENABLED: false });
  // Fresh module instance in a child reads the same temp file back.
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, ['-e',
    'process.stdout.write(String(require(process.argv[1]).getSettings().CLAUDE_ENABLED))',
    path.join(__dirname, '..', 'src', 'settings.js'),
  ], { env: { ...process.env, TOKENOMICS_DATA_DIR: DATA_DIR }, encoding: 'utf8' });
  assert.equal(out.trim(), 'false');
});
