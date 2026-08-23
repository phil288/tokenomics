const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseClaudeUsage, parseResetAt, getClaudeCache, pollClaude } = require('../src/collectors-claude');

// Real `claude -p "/usage"` output, verbatim.
const SAMPLE = `You are currently using your subscription to power your Claude Code usage

Current session: 5% used · resets Aug 23, 1:59pm (Europe/Paris)
Current week (all models): 49% used · resets Aug 26, 10:59pm (Europe/Paris)
Current week (Fable): 14% used · resets Aug 26, 10:59pm (Europe/Paris)

What's contributing to your limits usage?
Approximate, based on local sessions on this machine — does not include other devices or claude.ai.

Last 24h · 953 requests · 26 sessions
  86% of your usage was while 4+ sessions ran in parallel
  Top subagents: Explore 6%, Plan 2%
`;

const NOW = Date.parse('2026-08-23T09:00:00Z');

test('parses the quota windows into the card shape', () => {
  const out = parseClaudeUsage(SAMPLE, NOW);
  assert.equal(out.error, undefined);
  const lt = out.latest;
  assert.deepEqual(Object.keys(lt).sort(), ['five_hour', 'seven_day', 'seven_day_fable']);
  assert.equal(lt.five_hour.utilization_pct, 5);
  assert.equal(lt.seven_day.utilization_pct, 49);
  assert.equal(lt.seven_day_fable.utilization_pct, 14);
});

test('reset times resolve in the printed timezone, not local/UTC', () => {
  const lt = parseClaudeUsage(SAMPLE, NOW).latest;
  // 10:59pm Paris in August = CEST (UTC+2) -> 20:59Z
  assert.equal(lt.seven_day.resets_at, '2026-08-26T20:59:00.000Z');
  assert.equal(lt.five_hour.resets_at, '2026-08-23T11:59:00.000Z');
  // and it round-trips back to the printed wall-clock
  const back = new Date(lt.seven_day.resets_at)
    .toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  assert.equal(back.trim(), '22:59');
});

test('the contributor stats block is ignored (quota bars only)', () => {
  const out = parseClaudeUsage(SAMPLE, NOW);
  const s = JSON.stringify(out);
  for (const noise of ['953', 'requests', 'subagent', 'Explore', 'parallel']) {
    assert.ok(!s.includes(noise), `leaked "${noise}" into quota data`);
  }
});

test('no year in the source: a January reset seen in December rolls forward', () => {
  const dec = Date.parse('2026-12-28T00:00:00Z');
  const iso = parseResetAt('Jan 2, 10:00am (Europe/Paris)', dec);
  assert.equal(new Date(iso).getUTCFullYear(), 2027);
  assert.ok(Date.parse(iso) > dec, 'reset must be in the future');
});

test('DST is honoured across the boundary', () => {
  // Paris springs forward 2026-03-29; Mar 30 is CEST (UTC+2), Mar 20 is CET (UTC+1)
  const base = Date.parse('2026-03-15T00:00:00Z');
  assert.equal(parseResetAt('Mar 30, 2:30am (Europe/Paris)', base), '2026-03-30T00:30:00.000Z');
  assert.equal(parseResetAt('Mar 20, 2:30am (Europe/Paris)', base), '2026-03-20T01:30:00.000Z');
});

test('12-hour edge cases: 12am is midnight, 12pm is noon', () => {
  assert.equal(parseResetAt('Aug 26, 12:00am (UTC)', NOW), '2026-08-26T00:00:00.000Z');
  assert.equal(parseResetAt('Aug 26, 12:00pm (UTC)', NOW), '2026-08-26T12:00:00.000Z');
});

test('a window with no parseable reset still yields its percentage', () => {
  const out = parseClaudeUsage('Current session: 7% used', NOW);
  assert.equal(out.latest.five_hour.utilization_pct, 7);
  assert.equal(out.latest.five_hour.resets_at, undefined);
});

test('unparseable output is an error, not empty quota', () => {
  assert.ok(parseClaudeUsage('Login required', NOW).error);
  assert.ok(parseClaudeUsage('', NOW).error);
});

test('the disabled setting empties the cache without spawning the CLI', async () => {
  const { settings } = require('../src/settings');
  const prev = settings.CLAUDE_ENABLED;
  settings.CLAUDE_ENABLED = false;
  try {
    await pollClaude();  // must not shell out
    assert.deepEqual(getClaudeCache(), { disabled: true });
  } finally {
    settings.CLAUDE_ENABLED = prev;
  }
});
