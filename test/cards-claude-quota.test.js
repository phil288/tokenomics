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
  assert.match(MAIN_JS, /renderClaude\(state\.lastStats\.claude\)/);
  assert.match(MAIN_JS, /setInterval\(clockTick, 1000\)/);
});

// The card shows when the quota numbers were last read by the `claude /usage`
// poll (`polled_at`), not when the dashboard last refreshed — otherwise a
// failing poll leaves stale bars looking live.
const CSS = fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8');

// Load the real polledFreshness (+ its thresholds) by stripping ES module
// syntax, same trick the pace tests use — the package is CommonJS.
function loadFreshness() {
  const src = CLAUDE_CARDS_JS
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '');
  const factory = new Function('timeAgo', `${src}\nreturn { polledFreshness, POLL_WARN_SECS, POLL_STALE_SECS };`);
  return factory(() => 'X ago');
}

test('polledFreshness reports the claude /usage poll time, tiered by staleness', () => {
  const { polledFreshness, POLL_WARN_SECS, POLL_STALE_SECS } = loadFreshness();
  assert.equal(POLL_WARN_SECS, 5 * 60);
  assert.equal(POLL_STALE_SECS, 30 * 60);

  const at = secs => new Date(Date.now() - secs * 1000).toISOString();

  assert.match(polledFreshness(at(10)), /class="poll-age fresh"/);
  assert.match(polledFreshness(at(POLL_WARN_SECS - 5)), /class="poll-age fresh"/);
  assert.match(polledFreshness(at(POLL_WARN_SECS + 5)), /class="poll-age warn"/);
  assert.match(polledFreshness(at(POLL_STALE_SECS + 5)), /class="poll-age stale"/);

  // Text carries the relative age plus an absolute timestamp on hover.
  assert.match(polledFreshness(at(10)), /Updated X ago/);
  assert.match(polledFreshness(at(10)), /title="Last polled via claude \/usage: /);
});

test('polledFreshness degrades safely when the poll sent no timestamp', () => {
  const { polledFreshness } = loadFreshness();
  for (const bad of [undefined, null, '', 'not-a-date']) {
    const html = polledFreshness(bad);
    assert.match(html, /class="poll-age unknown"/);
    assert.match(html, /Quota age unknown/);
    assert.doesNotMatch(html, /NaN|Invalid Date/);
  }
});

test('both Claude render paths show the poll age, sourced from the poll cache', () => {
  // Quota bars present...
  assert.match(CLAUDE_CARDS_JS, /\$\{polledFreshness\(d\.polled_at, quotaSource\(d\)\)\}\s*\n\s*\$\{quotaBar\('Current session \(5h\)'/);
  // ...and the "poll pending / poll failed" fallback.
  assert.match(CLAUDE_CARDS_JS, /class="\$\{d\.error \? 'err' : 'note'\}">\$\{msg\}<\/div>\s*\n\s*\$\{polledFreshness\(d\.polled_at, quotaSource\(d\)\)\}/);
});

test('poll-age styling is theme-aware and flags staleness', () => {
  assert.match(CSS, /\.poll-age\s*{[^}]*var\(--muted\)/);
  assert.match(CSS, /\.poll-age\.warn\s*{[^}]*var\(--warn\)/);
  assert.match(CSS, /\.poll-age\.stale[\s\S]{0,40}\.poll-age\.unknown\s*{[^}]*var\(--danger\)/);
});

// ---- quota source: `claude /usage`, not Headroom ----

test('the Claude card renders from the claude /usage poll, not Headroom state', () => {
  // both render paths (SSE frame + 1s clock tick) read stats.claude
  assert.match(MAIN_JS, /renderClaude\(stats\.claude\)/);
  assert.doesNotMatch(MAIN_JS, /renderClaude\((?:stats|state\.lastStats)\.headroom\)/);
});

test('polled_at is read from the poll cache, not from latest.*', () => {
  assert.match(CLAUDE_CARDS_JS, /polledFreshness\(d\.polled_at, quotaSource\(d\)\)/);
  assert.doesNotMatch(CLAUDE_CARDS_JS, /polledFreshness\(lt\.polled_at\)/);
});

test('a stale poll error still renders the last good bars', () => {
  // an error alone must not short-circuit the whole card — the poller keeps
  // the previous `latest`, and the freshness line reports the age.
  assert.doesNotMatch(CLAUDE_CARDS_JS, /if \(!d \|\| d\.error\) return/);
  assert.match(CLAUDE_CARDS_JS, /if \(!d\) return/);
});

test('server polls claude on its own slow timer, out of the SSE loop', () => {
  const SERVER_JS = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(SERVER_JS, /CLAUDE_POLL_MS/);
  assert.match(SERVER_JS, /setInterval\(\(\) => pollClaude\(\)[\s\S]*?CLAUDE_POLL_MS\)/);
  // and an initial poll at boot so the card fills without waiting a full tick
  assert.match(SERVER_JS, /pollClaude\(\)\.catch\(err => console\.error\('Initial Claude poll failed/);
});

test('history quota carry-over reads the claude poll', () => {
  const HISTORY_JS = fs.readFileSync(path.join(ROOT, 'src', 'history.js'), 'utf8');
  assert.match(HISTORY_JS, /stats\.claude && stats\.claude\.latest/);
  assert.doesNotMatch(HISTORY_JS, /stats\.headroom && stats\.headroom\.latest/);
});

test('the card subtitle names the real quota source', () => {
  const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const card = HTML.slice(HTML.indexOf('id="claude-card"'));
  const head = card.slice(0, card.indexOf('</span></span>') + 14);
  assert.match(head, /Claude quota <span class="card-sub">via claude \/usage<\/span>/);
  assert.doesNotMatch(head, /via Headroom/);
});
