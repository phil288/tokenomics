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

test('parseProxyPerfLine extracts tokens + per-request metadata from a PERF line', () => {
  const line = '2026-06-19 14:29:19,130 - headroom.proxy - INFO - [hr_1781872157_000134] PERF '
    + 'model=claude-opus-4-8 msgs=2 tok_before=6490 tok_after=1490 tok_saved=5000 cache_read=24713 '
    + 'cache_write=517 cache_hit_pct=98 opt_ms=20 transforms=router:noop client=claude-code';
  const r = parseProxyPerfLine(line);
  assert.equal(r.model, 'claude-opus-4-8');
  assert.equal(r.before, 6490);
  assert.equal(r.after, 1490);
  assert.equal(r.saved, 5000);
  assert.equal(typeof r.ts, 'number');
  assert.equal(r.requestId, 'hr_1781872157_000134');
  assert.equal(r.msgs, 2);
  assert.equal(r.cacheRead, 24713);
  assert.equal(r.cacheWrite, 517);
  assert.equal(r.cacheHitPct, 98);
  assert.equal(r.transforms, 'router:noop');
  assert.equal(r.client, 'claude-code');
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
      + 'rtk_cmd TEXT, input_tokens INTEGER, output_tokens INTEGER, saved_tokens INTEGER, savings_pct REAL, exec_time_ms INTEGER)');
    db.prepare('INSERT INTO commands (timestamp, original_cmd, rtk_cmd, input_tokens, output_tokens, saved_tokens, savings_pct, exec_time_ms) '
      + 'VALUES (?,?,?,?,?,?,?,?)').run('2026-06-19T14:00:00Z', 'git status', 'rtk git status', 1000, 200, 800, 80, 12);
    db.close();

    // Headroom session_stats.jsonl fixture (one compress + one retrieve)
    const stats = path.join(dir, 'session_stats.jsonl');
    fs.writeFileSync(stats, [
      JSON.stringify({ type: 'compress', input_tokens: 400, output_tokens: 180, savings_percent: 55, strategy: 'router:dedup', timestamp: 1781870000 }),
      JSON.stringify({ type: 'retrieve', hash: 'abc', timestamp: 1781870001 }),
    ].join('\n') + '\n');

    // Headroom proxy.log fixture: an outbound_request (carries body_bytes) + the PERF line
    const log = path.join(dir, 'proxy.log');
    fs.writeFileSync(log, [
      '2026-06-19 14:29:18,000 - headroom.proxy - INFO - event=outbound_request forwarder=anthropic_messages method=POST path=/v1/messages body_bytes=73666 body_mutated=false request_id=hr_test_1',
      '2026-06-19 14:29:19,130 - headroom.proxy - INFO - [hr_test_1] PERF '
        + 'model=claude-opus-4-8 msgs=2 tok_before=6490 tok_after=1490 tok_saved=5000 cache_read=6000 '
        + 'cache_write=130 cache_hit_pct=98 transforms=router:noop client=claude-code',
    ].join('\n') + '\n');

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

    // per-operation metadata surfaced for expandable rows
    const infoMap = arr => Object.fromEntries((arr || []).map(([k, v]) => [k, v]));
    const rtkInfo = infoMap(rtk.info);
    assert.equal(rtkInfo['rewritten'], 'rtk git status');
    assert.equal(rtkInfo['exec time'], '12 ms');

    // per-instant fresh usage: context 6490, cache_read 6000 → uncached remainder
    // 490 (> cache_write 130), so fresh = max(6490-6000, 130) = 490
    const proxyRow = by('headroom-proxy')[0];
    assert.equal(proxyRow.before, 6490);  // full context resent this turn
    assert.equal(proxyRow.after, 490);    // fresh = max(ctx - cache_read, cache_write)
    assert.equal(proxyRow.saved, 6000);   // served from cache this instant
    const proxy = infoMap(proxyRow.info);
    assert.equal(proxy['messages'], '2');
    assert.equal(proxy['context resent'], '6490');
    assert.equal(proxy['fresh processed'], '490');
    assert.equal(proxy['cache hit'], '98%');
    assert.equal(proxy['transform'], 'router:noop');
    assert.equal(proxy['client'], 'claude-code');
    assert.equal(proxy['request size'], '71.9 KB'); // 73666 bytes correlated from outbound_request
    assert.equal(proxy['request id'], 'hr_test_1');

    assert.equal(infoMap(by('headroom-compress')[0].info)['strategy'], 'router:dedup');

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

// ---- Regression guard: Headroom proxy "fresh tokens at each instant" ----
// Bug history: fresh-per-turn was first derived from the integer-rounded
// cache_hit_pct, so a 100%-cache-hit request rendered fresh=0 even though the
// turn really processed new tokens. Truth source is cache_write (exact). These
// tests lock that contract so the spurious-0 cannot come back.

// Build a proxy.log-only fixture, run collectActivity, return rows keyed by the
// `before` (context) value for easy lookup. Isolates RTK/compress to empty.
async function activityFromPerfLines(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-fresh-'));
  const log = path.join(dir, 'proxy.log');
  fs.writeFileSync(log, lines.join('\n') + '\n');
  process.env.RTK_DATA_HOME = path.join(dir, 'no-rtk');          // nonexistent → no rtk rows
  process.env.HEADROOM_SESSION_STATS_PATH = path.join(dir, 'none.jsonl');
  process.env.HEADROOM_PROXY_LOG_PATH = log;
  try {
    const rows = await collectActivity({ limit: 50 });
    const byCtx = {};
    for (const r of rows) if (r.source === 'headroom-proxy') byCtx[r.before] = r;
    return { rows: rows.filter(r => r.source === 'headroom-proxy'), byCtx };
  } finally {
    delete process.env.RTK_DATA_HOME;
    delete process.env.HEADROOM_SESSION_STATS_PATH;
    delete process.env.HEADROOM_PROXY_LOG_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function perf(reqId, { ctx, after = ctx, saved = 0, cacheRead, cacheWrite, hit }) {
  return `2026-06-19 14:29:19,130 - headroom.proxy - INFO - [${reqId}] PERF `
    + `model=claude-opus-4-8 msgs=2 tok_before=${ctx} tok_after=${after} tok_saved=${saved} `
    + `cache_read=${cacheRead} cache_write=${cacheWrite} cache_hit_pct=${hit} `
    + `opt_ms=20 transforms=router:noop client=claude-code`;
}

test('proxy fresh usage = cache_write, NOT zero, at 100% cache hit (regression)', async () => {
  // The exact shape that produced the bug: tok_before huge, cache_hit_pct=100,
  // but cache_write is nonzero → fresh must equal cache_write, never 0.
  const { byCtx } = await activityFromPerfLines([
    perf('hr_a', { ctx: 141141, cacheRead: 176089, cacheWrite: 168, hit: 100 }),
  ]);
  const row = byCtx[141141];
  assert.ok(row, 'proxy row present');
  assert.notEqual(row.after, 0, 'fresh must not be 0 when cache_write > 0');
  assert.equal(row.after, 168, 'fresh equals cache_write');
  assert.equal(row.saved, 141141 - 168, 'cache-served = context - fresh');
});

test('proxy fresh ignores rounded cache_hit_pct, tracks cache_write exactly', async () => {
  // Two requests with IDENTICAL rounded hit% (100) but different cache_write must
  // yield different fresh — proving fresh is NOT a function of cache_hit_pct.
  const { byCtx } = await activityFromPerfLines([
    perf('hr_a', { ctx: 130644, cacheRead: 175310, cacheWrite: 779, hit: 100 }),
    perf('hr_b', { ctx: 140714, cacheRead: 176089, cacheWrite: 168, hit: 100 }),
  ]);
  assert.equal(byCtx[130644].after, 779);
  assert.equal(byCtx[140714].after, 168);
});

test('proxy fresh = uncached remainder when cache_write=0 but context not fully cached (regression)', async () => {
  // Real-data shape that produced live zeros: a turn whose new input went
  // uncached (cache_write=0) while cache_read covers only part of the context.
  // fresh must be the uncached remainder (ctx - cache_read), never 0.
  const { byCtx } = await activityFromPerfLines([
    perf('hr_cw0', { ctx: 146661, after: 121198, saved: 25463, cacheRead: 33780, cacheWrite: 0, hit: 100 }),
  ]);
  const row = byCtx[146661];
  assert.equal(row.after, 146661 - 33780, 'fresh = context - cache_read');
  assert.ok(row.after > 0, 'must not be 0 when cache_write=0 and context not fully cached');
});

test('proxy fresh = full context on an uncached first turn (no cache activity)', async () => {
  const { byCtx } = await activityFromPerfLines([
    perf('hr_first', { ctx: 79, cacheRead: 0, cacheWrite: 0, hit: 0 }),
  ]);
  assert.equal(byCtx[79].after, 79, 'all tokens fresh when nothing is cached');
  assert.equal(byCtx[79].saved, 0);
});

test('proxy fresh is capped at the context size', async () => {
  // Defensive: a cache_write larger than tok_before must not exceed context.
  const { byCtx } = await activityFromPerfLines([
    perf('hr_cap', { ctx: 500, cacheRead: 100, cacheWrite: 9999, hit: 80 }),
  ]);
  assert.equal(byCtx[500].after, 500, 'fresh clamped to context');
  assert.equal(byCtx[500].saved, 0);
});

test('proxy rows never report 0 fresh while showing a large context (the symptom)', async () => {
  // End-to-end shape of the reported screenshot: several big-context, high-hit
  // requests. None may render fresh=0 — that was the visible bug.
  const { rows } = await activityFromPerfLines([
    perf('hr_1', { ctx: 127400, cacheRead: 176000, cacheWrite: 437, hit: 100 }),
    perf('hr_2', { ctx: 127200, cacheRead: 175000, cacheWrite: 285, hit: 100 }),
    perf('hr_3', { ctx: 126100, cacheRead: 174000, cacheWrite: 196, hit: 100 }),
    perf('hr_4', { ctx: 125300, cacheRead: 173000, cacheWrite: 779, hit: 100 }),
  ]);
  assert.equal(rows.length, 4);
  for (const r of rows) {
    assert.ok(r.before > 1000, 'large context');
    assert.ok(r.after > 0, `fresh must be > 0 (got ${r.after} for ctx ${r.before})`);
    assert.ok(r.after < r.before, 'fresh is a sliver of the resent context');
  }
});
