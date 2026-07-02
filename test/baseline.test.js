// Unit tests for the reset-baseline offset. A baseline is a non-destructive
// zero-point: captured from the raw absolute totals, then subtracted from every
// subsequent reading so the headline numbers restart at zero without touching
// the tools' own ledgers. Isolated to a temp data dir so the real baseline.json
// is never written.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.TOKENOMICS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-base-'));
const {
  snapshotTotals, captureBaseline, clearBaseline, applyBaseline, applyActivityBaseline,
  getBaseline, loadBaseline,
} = require('../src/baseline');

const BASELINE_FILE = path.join(process.env.TOKENOMICS_DATA_DIR, 'baseline.json');

// A representative raw (un-offset) stats payload. `today` lets a test place the
// reset-day bucket on whatever day "now" is when snapshotTotals runs.
function rawStats(today = new Date().toISOString().slice(0, 10)) {
  return {
    rtk: {
      summary: {
        total_saved: 800_000, total_commands: 100,
        total_input: 1_000_000, total_output: 4_000, avg_savings_pct: 80,
      },
      daily: [
        { date: '2026-06-30', saved_tokens: 10, commands: 1, input_tokens: 10, output_tokens: 1, total_time_ms: 1 },
        { date: today, saved_tokens: 157_200_000, commands: 500, input_tokens: 157_500_000, output_tokens: 300_000, total_time_ms: 500 },
      ],
    },
    caveman: {
      total_saved_tokens: 12_000, total_output_tokens: 5_000,
      total_saved_usd: 3.5, session_count: 9,
    },
    headroom: {
      window_tokens: {
        input: 111, output: 22, cache_reads: 222, cache_writes_5m: 0, cache_writes_1h: 0,
        cache_writes_total: 0, total_raw: 355, weighted_token_equivalent: 140,
        by_model: {
          'claude-sonnet-5': { input: 100, output: 20, cache_reads: 200, cache_writes_total: 0 },
        },
      },
      savings: {
        lifetime: { tokens_saved: 47_000_000, compression_savings_usd: 220.5, requests: 10_000 },
        display_session: { savings_percent: 17 },
      },
    },
  };
}

test('snapshotTotals extracts cumulative totals, the reset-day bucket and window telemetry', () => {
  const today = new Date().toISOString().slice(0, 10);
  const snap = snapshotTotals(rawStats(today));
  assert.equal(typeof snap.t, 'number');
  assert.equal(snap.rtk.total_saved, 800_000);
  assert.equal(snap.rtk.day.date, today);
  assert.equal(snap.rtk.day.saved_tokens, 157_200_000);
  assert.deepEqual(snap.caveman, { total_saved_tokens: 12_000, total_output_tokens: 5_000, total_saved_usd: 3.5, session_count: 9 });
  assert.equal(snap.headroom.tokens_saved, 47_000_000);
  assert.equal(snap.headroom.window.total_raw, 355);
  assert.equal(snap.headroom.window.by_model['claude-sonnet-5'].cache_reads, 200);
});

test('snapshotTotals tolerates an empty payload', () => {
  const snap = snapshotTotals({});
  assert.equal(snap.rtk.total_saved, 0);
  assert.equal(snap.caveman.total_saved_tokens, 0);
  assert.equal(snap.headroom.tokens_saved, 0);
});

test('applyBaseline is a no-op when no baseline is set', () => {
  clearBaseline();
  const s = rawStats();
  applyBaseline(s);
  assert.equal(s.rtk.summary.total_saved, 800_000);
  assert.equal(s.headroom.savings.lifetime.tokens_saved, 47_000_000);
});

test('capture then apply on the SAME totals zeroes every headline figure', () => {
  const today = new Date().toISOString().slice(0, 10);
  captureBaseline(rawStats(today));
  const s = applyBaseline(rawStats(today));
  assert.equal(s.rtk.summary.total_saved, 0);
  assert.equal(s.rtk.summary.total_commands, 0);
  assert.equal(s.rtk.summary.total_input, 0);
  assert.equal(s.rtk.summary.total_output, 0);
  assert.equal(s.rtk.summary.avg_savings_pct, 0); // recomputed from zeroed totals
  // reset-day chart bucket subtracts its value-at-reset → bar starts at zero
  const todayRow = s.rtk.daily.find(r => r.date === today);
  assert.equal(todayRow.saved_tokens, 0);
  assert.equal(todayRow.commands, 0);
  assert.equal(s.caveman.total_saved_tokens, 0);
  assert.equal(s.caveman.session_count, 0);
  assert.equal(s.headroom.savings.lifetime.tokens_saved, 0);
  assert.equal(s.headroom.savings.lifetime.compression_savings_usd, 0);
  assert.equal(s.headroom.savings.lifetime.requests, 0);
  // live window telemetry (top-level + per-model) also zeroes out
  assert.equal(s.headroom.window_tokens.total_raw, 0);
  assert.equal(s.headroom.window_tokens.input, 0);
  assert.equal(s.headroom.window_tokens.by_model['claude-sonnet-5'].cache_reads, 0);
  clearBaseline();
});

test('applyBaseline subtracts the baseline from later (grown) readings', () => {
  captureBaseline(rawStats());
  const grown = rawStats();
  grown.rtk.summary.total_saved = 800_500;      // +500 since reset
  grown.rtk.summary.total_input = 1_000_500;
  grown.caveman.total_saved_tokens = 12_050;    // +50
  grown.headroom.savings.lifetime.tokens_saved = 47_100_000; // +100k
  const s = applyBaseline(grown);
  assert.equal(s.rtk.summary.total_saved, 500);
  assert.equal(s.rtk.summary.total_input, 500);
  assert.equal(s.caveman.total_saved_tokens, 50);
  assert.equal(s.headroom.savings.lifetime.tokens_saved, 100_000);
  clearBaseline();
});

test('applyBaseline clamps at zero (never shows negative on a shrunk reading)', () => {
  captureBaseline(rawStats());
  const shrunk = rawStats();
  shrunk.rtk.summary.total_saved = 1_000;       // below baseline (e.g. tool DB reset)
  shrunk.headroom.savings.lifetime.tokens_saved = 5;
  const s = applyBaseline(shrunk);
  assert.equal(s.rtk.summary.total_saved, 0);
  assert.equal(s.headroom.savings.lifetime.tokens_saved, 0);
  clearBaseline();
});

test('applyBaseline offsets window telemetry to "since reset" but keeps ratios', () => {
  const today = new Date().toISOString().slice(0, 10);
  captureBaseline(rawStats(today));
  const grown = rawStats(today);
  grown.headroom.window_tokens.input = 161;                         // +50 since reset
  grown.headroom.window_tokens.by_model['claude-sonnet-5'].input = 130; // +30
  const s = applyBaseline(grown);
  assert.equal(s.headroom.window_tokens.input, 50);
  assert.equal(s.headroom.window_tokens.by_model['claude-sonnet-5'].input, 30);
  assert.equal(s.headroom.savings.display_session.savings_percent, 17); // ratio kept
  clearBaseline();
});

test('applyBaseline trims the RTK daily chart to buckets on/after the reset day', () => {
  // Baseline captured "today" with only the 06-30 + today buckets present.
  const today = new Date().toISOString().slice(0, 10);
  captureBaseline(rawStats(today));
  const s = applyBaseline(rawStats(today));
  assert.deepEqual(s.rtk.daily.map(r => r.date), [today]); // pre-reset day dropped
  clearBaseline();
});

test('applyActivityBaseline is a no-op with no baseline set', () => {
  clearBaseline();
  const payload = { rows: [{ ts: 1 }, { ts: null }], rtk: { gain: 9, loss: 4, net: 5, gainCmds: 3, lossCmds: 1 } };
  const out = applyActivityBaseline(payload);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rtk.gain, 9);
});

test('applyActivityBaseline drops pre-reset rows and offsets lifetime gain/loss', () => {
  captureBaseline(rawStats(), { gain: 100, loss: 30, gainCmds: 10, lossCmds: 4 });
  const cut = getBaseline().t;
  const payload = {
    rows: [
      { ts: cut - 1000, label: 'old' },  // before reset → dropped
      { ts: cut + 1000, label: 'new' },  // after reset → kept
      { ts: null, label: 'no-ts' },      // unknown time → dropped while baseline active
    ],
    rtk: { gain: 150, loss: 45, net: 105, gainCmds: 16, lossCmds: 6 },
  };
  const out = applyActivityBaseline(payload);
  assert.deepEqual(out.rows.map(r => r.label), ['new']);
  assert.equal(out.rtk.gain, 50);      // 150 - 100
  assert.equal(out.rtk.loss, 15);      // 45 - 30
  assert.equal(out.rtk.gainCmds, 6);   // 16 - 10
  assert.equal(out.rtk.lossCmds, 2);   // 6 - 4
  assert.equal(out.rtk.net, 35);       // recomputed gain - loss
  clearBaseline();
});

test('applyActivityBaseline clamps lifetime totals at zero', () => {
  captureBaseline(rawStats(), { gain: 100, loss: 30, gainCmds: 10, lossCmds: 4 });
  const cut = getBaseline().t;
  const out = applyActivityBaseline({ rows: [], rtk: { gain: 5, loss: 1, net: 4, gainCmds: 1, lossCmds: 0 } });
  assert.equal(out.rtk.gain, 0);
  assert.equal(out.rtk.loss, 0);
  assert.equal(out.rtk.net, 0);
  clearBaseline();
});

test('captureBaseline persists to disk and loadBaseline restores it', () => {
  captureBaseline(rawStats());
  assert.ok(fs.existsSync(BASELINE_FILE));
  const onDisk = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  assert.equal(onDisk.rtk.total_saved, 800_000);
  clearBaseline();
  assert.equal(getBaseline(), null);
  assert.ok(!fs.existsSync(BASELINE_FILE));
});
