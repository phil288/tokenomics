// Functional tests for the data-collection parsers. These are the pure,
// deterministic cores of the (otherwise process-spawning) collectors — they
// turn raw tool output into the structured shapes the dashboard renders.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAgyUsage, parseTextRTK, parseRtkVal } = require('../src/collectors');

// ---- parseRtkVal: human-readable token counts → numbers ----
test('parseRtkVal expands k/M/B suffixes and plain numbers', () => {
  assert.equal(parseRtkVal('2.5k'), 2500);
  assert.equal(parseRtkVal('1.2M'), 1_200_000);
  assert.equal(parseRtkVal('3B'), 3_000_000_000);
  assert.equal(parseRtkVal('550K'), 550_000); // case-insensitive
  assert.equal(parseRtkVal('100'), 100);
  assert.equal(parseRtkVal('  42  '), 42);    // whitespace tolerant
});

test('parseRtkVal returns 0 for non-numeric input', () => {
  assert.equal(parseRtkVal('abc'), 0);
  assert.equal(parseRtkVal(''), 0);
});

// ---- parseTextRTK: `rtk gain` table → summary + daily rows ----
const RTK_TABLE = `
D Daily Breakdown
Date        Cmds  In     Out    Saved  Pct   Time
────────────────────────────────────────────────
2026-06-17  10    500k   300k   150k   30.0  100
2026-06-18  42    1.2M   800k   400k   35.5  120
TOTAL       52    1.7M   1.1M   550k   33.0  110
`;

test('parseTextRTK extracts daily rows with correct token math', () => {
  const r = parseTextRTK(RTK_TABLE);
  assert.equal(r.daily.length, 2);

  const today = r.daily[1];
  assert.equal(today.date, '2026-06-18');
  assert.equal(today.commands, 42);
  assert.equal(today.input_tokens, 1_200_000);
  assert.equal(today.output_tokens, 800_000);
  assert.equal(today.saved_tokens, 400_000);
  assert.equal(today.savings_pct, 35.5);
  assert.equal(today.avg_time_ms, 120);
  assert.equal(today.total_time_ms, 42 * 120);
});

test('parseTextRTK rolls the TOTAL row into the summary', () => {
  const { summary } = parseTextRTK(RTK_TABLE);
  assert.equal(summary.total_commands, 52);
  assert.equal(summary.total_input, 1_700_000);
  assert.equal(summary.total_output, 1_100_000);
  assert.equal(summary.total_saved, 550_000);
  assert.equal(summary.avg_savings_pct, 33.0);
  assert.equal(summary.avg_time_ms, 110);
});

test('parseTextRTK on empty input yields empty structures', () => {
  const r = parseTextRTK('');
  assert.deepEqual(r.daily, []);
  assert.deepEqual(r.weekly, []);
  assert.deepEqual(r.monthly, []);
  assert.equal(r.summary.total_saved, 0);
});

// ---- parseAgyUsage: agy /usage TUI panel → per-group quota ----
// Includes ANSI escape codes to prove the stripper handles real TUI output.
const AGY_PANEL = `
Account: user@example.com

GEMINI MODELS
Models within this group: gemini-3.1-pro, gemini-3.5-flash
Weekly Limit
\x1b[32m[████████░░]\x1b[0m 72.42%
Refreshes in 3d 4h
Five Hour Limit
[██████████] 100%
Quota available

CLAUDE AND GPT MODELS
Models within this group: claude-opus-4, gpt-5
Weekly Limit
[█████░░░░░] 50%
Refreshes in 5d
Five Hour Limit
[██░░░░░░░░] 20%
Refreshes in 2h
`;

test('parseAgyUsage parses account and both model groups', () => {
  const r = parseAgyUsage(AGY_PANEL);
  assert.equal(r.account, 'user@example.com');
  assert.equal(r.groups.length, 2);
  assert.equal(r.groups[0].name, 'GEMINI MODELS');
  assert.equal(r.groups[1].name, 'CLAUDE AND GPT MODELS');
});

test('parseAgyUsage reads remaining-quota gauge through ANSI codes', () => {
  const [gemini, claude] = parseAgyUsage(AGY_PANEL).groups;

  assert.equal(gemini.weekly.remainingPct, 72.42);
  assert.equal(gemini.weekly.refresh, '3d 4h');
  // "Quota available" overrides the gauge → full quota
  assert.equal(gemini.fiveHour.full, true);

  assert.equal(claude.weekly.remainingPct, 50);
  assert.equal(claude.weekly.refresh, '5d');
  assert.equal(claude.fiveHour.remainingPct, 20);
  assert.equal(claude.fiveHour.refresh, '2h');
});

test('parseAgyUsage returns an error object for unparseable input', () => {
  const r = parseAgyUsage('not a usage panel at all');
  assert.ok(r.error, 'expected an error field');
  assert.equal(r.groups, undefined);
});
