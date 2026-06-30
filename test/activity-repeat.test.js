// Structural tests for the Activity "seen before" repeat-comparison feature.
// The Activity feed is pure front-end DOM (no jsdom — zero-dependency rule), so
// these assert the HTML/JS + CSS contract: activity.js reads r.repeat, renders
// the prev→now figure inside an .act-repeat element, and index.css styles it.
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const ACTIVITY_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'activity.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8');

test('activity.js has a repeatHtml helper gated on r.repeat', () => {
  assert.match(ACTIVITY_JS, /function repeatHtml\s*\(/, 'repeatHtml helper missing');
  assert.match(ACTIVITY_JS, /if\s*\(\s*!\s*r\.repeat\s*\)\s*return\s*''/, 'repeatHtml must no-op when r.repeat absent');
  assert.match(ACTIVITY_JS, /r\.repeat\.prevAfter/, 'must read prevAfter');
  assert.match(ACTIVITY_JS, /r\.repeat\.delta/, 'must read delta');
});

test('repeat line is emitted with the act-repeat class and prev→now figure', () => {
  assert.match(ACTIVITY_JS, /class="act-repeat /, 'act-repeat class not emitted');
  // up/down modifier reflects whether more or fewer tokens were consumed now.
  assert.match(ACTIVITY_JS, /delta > 0 \? 'up' : 'down'/, 'up/down direction modifier missing');
  assert.match(ACTIVITY_JS, /seen before/, 'prev→now label missing');
});

test('repeatHtml is wired into the row template', () => {
  assert.match(ACTIVITY_JS, /\$\{repeatHtml\(r, after\)\}/, 'repeatHtml not rendered in rowHtml');
});

test('index.css defines .act-repeat with up/down color modifiers', () => {
  assert.match(CSS, /\.act-repeat\s*\{/, '.act-repeat rule missing');
  assert.match(CSS, /\.act-repeat\.up\s*\{/, '.act-repeat.up modifier missing');
  assert.match(CSS, /\.act-repeat\.down\s*\{/, '.act-repeat.down modifier missing');
});
