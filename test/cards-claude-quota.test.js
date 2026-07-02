// Claude quota card is pure front-end DOM (no jsdom — zero-dependency rule),
// so structure is asserted by reading src/web/cards.js. renderClaude() must
// discover per-model 7-day windows generically (seven_day_<model>) instead of
// hardcoding "seven_day_sonnet", since which models get their own weekly
// window depends on the account's plan (e.g. Fable now gets one alongside
// Sonnet/Opus).
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const CARDS_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'cards.js'), 'utf8');

test('renderClaude discovers per-model 7-day windows generically, not just Sonnet', () => {
  assert.doesNotMatch(CARDS_JS, /lt\.seven_day_sonnet/);
  assert.match(CARDS_JS, /startsWith\(['"]seven_day_['"]\)/);
});

test('modelWindowLabel is exported/defined and title-cases model slugs', () => {
  const match = CARDS_JS.match(/function modelWindowLabel\(slug\)\s*{\s*return ([\s\S]*?);\s*}/);
  assert.ok(match, 'modelWindowLabel function not found in cards.js');
  // eslint-disable-next-line no-new-func
  const modelWindowLabel = new Function('slug', `return ${match[1]};`);
  assert.equal(modelWindowLabel('fable'), 'Fable');
  assert.equal(modelWindowLabel('sonnet'), 'Sonnet');
  assert.equal(modelWindowLabel('opus'), 'Opus');
  assert.equal(modelWindowLabel('gpt-5'), 'Gpt 5');
});

test('renderClaude renders one bar per discovered model window, labeled from the key', () => {
  assert.match(CARDS_JS, /modelWindows\.map\(m => quotaBar\(`Weekly · \$\{m\.label\} \(7d\)`/);
});
