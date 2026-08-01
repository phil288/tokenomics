// Claude quota card is pure front-end DOM (no jsdom — zero-dependency rule),
// so structure is asserted by reading src/web/cards-claude.js. renderClaude() must
// discover per-model 7-day windows generically (seven_day_<model>) instead of
// hardcoding "seven_day_sonnet", since which models get their own weekly
// window depends on the account's plan (e.g. Fable now gets one alongside
// Sonnet/Opus).
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const CLAUDE_CARDS_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'cards-claude.js'), 'utf8');
const FORMAT_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'format.js'), 'utf8');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'main.js'), 'utf8');

test('renderClaude discovers per-model 7-day windows generically, not just Sonnet', () => {
  assert.doesNotMatch(CLAUDE_CARDS_JS, /lt\.seven_day_sonnet/);
  assert.match(CLAUDE_CARDS_JS, /startsWith\(['"]seven_day_['"]\)/);
});

test('modelWindowLabel is exported/defined and title-cases model slugs', () => {
  const match = CLAUDE_CARDS_JS.match(/function modelWindowLabel\(slug\)\s*{\s*return ([\s\S]*?);\s*}/);
  assert.ok(match, 'modelWindowLabel function not found in cards-claude.js');
  // eslint-disable-next-line no-new-func
  const modelWindowLabel = new Function('slug', `return ${match[1]};`);
  assert.equal(modelWindowLabel('fable'), 'Fable');
  assert.equal(modelWindowLabel('sonnet'), 'Sonnet');
  assert.equal(modelWindowLabel('opus'), 'Opus');
  assert.equal(modelWindowLabel('gpt-5'), 'Gpt 5');
});

test('renderClaude renders one bar per discovered model window, labeled from the key', () => {
  assert.match(CLAUDE_CARDS_JS, /modelWindows\.map\(m => quotaBar\(`Weekly · \$\{m\.label\} \(7d\)`/);
});

test('renderClaude shows current-session remaining time inline', () => {
  assert.match(CLAUDE_CARDS_JS, /import \{[^}]*remainingTime[^}]*\} from '\.\/format\.js'/);
  assert.match(CLAUDE_CARDS_JS, /const sessionSecs = sessionResetSecs\(fh\)/);
  assert.match(CLAUDE_CARDS_JS, /quotaBar\('Current session \(5h\)', fh\.utilization_pct, sessionSecs, remainingTime\(sessionSecs\)/);
});

test('quota reset timing accepts timestamp and seconds_to_reset window fields', () => {
  assert.match(CLAUDE_CARDS_JS, /function quotaResetSecs\(win\)/);
  assert.match(CLAUDE_CARDS_JS, /const resetAt = win\.resets_at \|\| win\.reset_at \|\| win\.resetAt/);
  assert.match(CLAUDE_CARDS_JS, /secsUntil\(resetAt\)/);
  assert.match(CLAUDE_CARDS_JS, /Number\.isFinite\(win\.seconds_to_reset\)/);
  assert.match(CLAUDE_CARDS_JS, /quotaBar\('Weekly · all models \(7d\)', sd\.utilization_pct, quotaResetSecs\(sd\)/);
});

test('current session only shows a countdown from valid Headroom timing', () => {
  const helper = CLAUDE_CARDS_JS.slice(
    CLAUDE_CARDS_JS.indexOf('function sessionResetSecs(win)'),
    CLAUDE_CARDS_JS.indexOf('// "seven_day_sonnet"')
  );
  assert.match(CLAUDE_CARDS_JS, /function sessionResetSecs\(win\)/);
  assert.match(helper, /const fromTimestamp = secsUntil\(resetAt\)/);
  assert.match(helper, /if \(fromTimestamp && fromTimestamp > 0\) return fromTimestamp/);
  assert.match(CLAUDE_CARDS_JS, /win\.seconds_to_reset > 0/);
  assert.match(helper, /return null/);
  assert.doesNotMatch(helper, /setUTCHours|hourly/);
  assert.doesNotMatch(helper, /utilization_pct|remainingPct|windowSecs/);
  assert.doesNotMatch(CLAUDE_CARDS_JS, /signedSecsUntil/);
  assert.doesNotMatch(CLAUDE_CARDS_JS, /rolloverSecs/);
  assert.doesNotMatch(FORMAT_JS, /reset \$\{.*ago/);
});

test('clock-derived Claude quota text refreshes once per second between SSE frames', () => {
  assert.match(MAIN_JS, /function clockTick\(\)/);
  assert.match(MAIN_JS, /renderClaude\(state\.lastStats\.headroom\)/);
  assert.match(MAIN_JS, /setInterval\(clockTick, 1000\)/);
});
