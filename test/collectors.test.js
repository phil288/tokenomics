// Functional tests for the data-collection parsers. These are the pure,
// deterministic cores of the (otherwise process-spawning) collectors — they
// turn raw tool output into the structured shapes the dashboard renders.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAgyUsage, parseTextRTK, parseRtkVal,
  parseProxyPerfLine, parseSessionStatLine, collectActivity,
} = require('../src/collectors');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

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

test('parseAgyUsage captures each reported limit generically', () => {
  const [gemini, claude] = parseAgyUsage(AGY_PANEL).groups;

  // labels come straight from agy (" Limit" suffix stripped), in panel order
  assert.deepEqual(gemini.limits.map(l => l.label), ['Weekly', 'Five Hour']);

  const gWeekly = gemini.limits[0];
  assert.equal(gWeekly.remainingPct, 72.42); // read through ANSI codes
  assert.equal(gWeekly.refresh, '3d 4h');
  // "Quota available" overrides the gauge → full quota
  assert.equal(gemini.limits[1].full, true);

  assert.deepEqual(claude.limits.map(l => l.label), ['Weekly', 'Five Hour']);
  assert.equal(claude.limits[0].remainingPct, 50);
  assert.equal(claude.limits[0].refresh, '5d');
  assert.equal(claude.limits[1].remainingPct, 20);
  assert.equal(claude.limits[1].refresh, '2h');
});

test('parseAgyUsage adapts to a group with only a weekly limit', () => {
  const panel = `
Account: solo@example.com

GEMINI MODELS
Models within this group: Gemini Flash, Gemini Pro
Weekly Limit
[██████████] 100.00%
Quota available
`;
  const [g] = parseAgyUsage(panel).groups;
  assert.equal(g.limits.length, 1);
  assert.equal(g.limits[0].label, 'Weekly');
  assert.equal(g.limits[0].full, true);
});

test('parseAgyUsage ignores the descriptive footer, not just headers', () => {
  // a line ending in lowercase "limit." must not open a phantom limit section
  const panel = `
Account: a@b.com

GEMINI MODELS
Weekly Limit
[██████████] 100.00%
Quota available
Within each group, models share a weekly limit.
`;
  const [g] = parseAgyUsage(panel).groups;
  assert.equal(g.limits.length, 1);
});

test('parseAgyUsage returns an error object for unparseable input', () => {
  const r = parseAgyUsage('not a usage panel at all');
  assert.ok(r.error, 'expected an error field');
  assert.equal(r.groups, undefined);
});

// ---- Activity feed: per-operation before→after records ----

test('parseProxyPerfLine extracts before/after/saved/model/ts from a PERF line', () => {
  const line = '2026-06-19 14:29:19,130 - headroom.proxy - INFO - [hr_x] PERF '
    + 'model=claude-opus-4-8 msgs=2 tok_before=6490 tok_after=1490 tok_saved=5000 cache_read=24713 cache_hit_pct=98';
  const r = parseProxyPerfLine(line);
  assert.equal(r.model, 'claude-opus-4-8');
  assert.equal(r.before, 6490);
  assert.equal(r.after, 1490);
  assert.equal(r.saved, 5000);
  assert.equal(typeof r.ts, 'number');
});

test('parseProxyPerfLine falls back to before-after when tok_saved missing', () => {
  const r = parseProxyPerfLine('... PERF model=m tok_before=100 tok_after=40');
  assert.equal(r.saved, 60);
});

test('parseProxyPerfLine returns null for non-PERF / malformed lines', () => {
  assert.equal(parseProxyPerfLine('2026-06-19 - headroom.proxy - INFO - event=outbound_request'), null);
  assert.equal(parseProxyPerfLine('garbage PERF without tokens'), null);
  assert.equal(parseProxyPerfLine(''), null);
});

test('parseSessionStatLine parses compress events and skips retrieve', () => {
  const c = parseSessionStatLine(JSON.stringify({
    type: 'compress', input_tokens: 400, output_tokens: 180, savings_percent: 55, strategy: 'router:dedup', timestamp: 1781870000,
  }));
  assert.equal(c.before, 400);
  assert.equal(c.after, 180);
  assert.equal(c.saved, 220);
  assert.equal(c.savedPct, 55);
  assert.equal(c.strategy, 'router:dedup');
  assert.equal(c.ts, 1781870000 * 1000);
  assert.equal(parseSessionStatLine(JSON.stringify({ type: 'retrieve', hash: 'abc', timestamp: 1 })), null);
  assert.equal(parseSessionStatLine('not json'), null);
});

test('collectActivity merges RTK + Headroom sources, sorts newest-first, caps', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-act-'));
  try {
    // RTK history.db fixture
    fs.mkdirSync(path.join(dir, 'rtk'));
    const db = new DatabaseSync(path.join(dir, 'rtk', 'history.db'));
    db.exec('CREATE TABLE commands (id INTEGER PRIMARY KEY, timestamp TEXT, original_cmd TEXT, '
      + 'rtk_cmd TEXT, input_tokens INTEGER, output_tokens INTEGER, saved_tokens INTEGER, savings_pct REAL)');
    db.prepare('INSERT INTO commands (timestamp, original_cmd, rtk_cmd, input_tokens, output_tokens, saved_tokens, savings_pct) '
      + 'VALUES (?,?,?,?,?,?,?)').run('2026-06-19T14:00:00Z', 'git status', 'rtk git status', 1000, 200, 800, 80);
    db.close();

    // Headroom session_stats.jsonl fixture (one compress + one retrieve)
    const stats = path.join(dir, 'session_stats.jsonl');
    fs.writeFileSync(stats, [
      JSON.stringify({ type: 'compress', input_tokens: 400, output_tokens: 180, savings_percent: 55, strategy: 'router:dedup', timestamp: 1781870000 }),
      JSON.stringify({ type: 'retrieve', hash: 'abc', timestamp: 1781870001 }),
    ].join('\n') + '\n');

    // Headroom proxy.log fixture (one PERF line)
    const log = path.join(dir, 'proxy.log');
    fs.writeFileSync(log, '2026-06-19 14:29:19,130 - headroom.proxy - INFO - [hr_x] PERF '
      + 'model=claude-opus-4-8 msgs=2 tok_before=6490 tok_after=1490 tok_saved=5000 cache_read=1 cache_hit_pct=98\n');

    process.env.RTK_DATA_HOME = dir;
    process.env.HEADROOM_SESSION_STATS_PATH = stats;
    process.env.HEADROOM_PROXY_LOG_PATH = log;

    const rows = await collectActivity({ limit: 50 });
    const by = src => rows.filter(r => r.source === src);
    assert.equal(by('rtk').length, 1, 'one rtk row');
    assert.equal(by('headroom-compress').length, 1, 'compress kept, retrieve skipped');
    assert.equal(by('headroom-proxy').length, 1, 'one proxy row');

    const rtk = by('rtk')[0];
    assert.equal(rtk.label, 'git status');
    assert.equal(rtk.detail, 'rtk git status');
    assert.equal(rtk.before, 1000);
    assert.equal(rtk.after, 200);
    assert.equal(rtk.saved, 800);

    // newest-first by ts
    for (let i = 1; i < rows.length; i++) {
      assert.ok((rows[i - 1].ts || 0) >= (rows[i].ts || 0), 'rows sorted newest-first');
    }
    // limit cap honored
    const capped = await collectActivity({ limit: 2 });
    assert.ok(capped.length <= 2);
  } finally {
    delete process.env.RTK_DATA_HOME;
    delete process.env.HEADROOM_SESSION_STATS_PATH;
    delete process.env.HEADROOM_PROXY_LOG_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
