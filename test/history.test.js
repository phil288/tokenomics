// Functional test for the history snapshot compactor — the function that turns
// a full stats payload into the compact per-minute row stored in history.jsonl
// and charted by the Trends card. Isolated to a temp data dir so the real
// settings.json (which feeds pricing) can't skew the cost math.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Point data dir at an empty temp dir BEFORE requiring → settings load defaults.
process.env.TOKENOMICS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-hist-'));
const { compactSnapshot } = require('../src/history');

const STATS = {
  rtk: { summary: { total_saved: 550_000, total_commands: 52 } },
  caveman: { total_saved_tokens: 12_345, session_count: 7 },
  headroom: {
    window_tokens: {
      cache_reads: 1_000_000,
      by_model: {
        // dated suffix is stripped to "opus-4" by shortModel
        'claude-opus-4-20250101': {
          input: 1_000_000, output: 200_000, cache_reads: 1_000_000, cache_writes_total: 0,
        },
        // synthetic rows are excluded from the snapshot
        '<synthetic>': { input: 999_999 },
      },
    },
    // Authoritative savings ledger (proxy_savings.json) — cumulative, monotonic.
    savings: {
      lifetime: { tokens_saved: 900_000, compression_savings_usd: 4.5, requests: 33 },
      display_session: { savings_percent: 62 },
    },
    latest: {
      five_hour: { utilization_pct: 42 },
      seven_day: { utilization_pct: 13 },
    },
  },
};

test('compactSnapshot stamps a timestamp and copies RTK/Caveman totals', () => {
  const row = compactSnapshot(STATS);
  assert.equal(typeof row.t, 'number');
  assert.deepEqual(row.rtk, { saved: 550_000, cmds: 52 });
  assert.deepEqual(row.cav, { saved: 12_345, sessions: 7 });
});

test('compactSnapshot copies the authoritative savings ledger and quota carry-over', () => {
  const row = compactSnapshot(STATS);
  // From proxy_savings.json — not derived from rolling window_tokens.
  assert.equal(row.hr.savedTokens, 900_000);
  assert.equal(row.hr.savedUsd, 4.5);
  assert.equal(row.hr.requests, 33);
  assert.equal(row.hr.savingsPct, 62);
  assert.equal(row.hr.q5, 42);
  assert.equal(row.hr.q7, 13);
});

test('compactSnapshot derives weighted/raw/real cost per model', () => {
  const { hr } = compactSnapshot(STATS);

  // synthetic row dropped, dated suffix shortened
  assert.deepEqual(Object.keys(hr.models), ['opus-4']);

  const m = hr.models['opus-4'];
  assert.equal(m.raw, 2_200_000);   // input+output+cache_reads+cache_writes
  assert.equal(m.wtd, 2_100_000);   // input + output*5 + cache_reads*0.1
  assert.equal(m.usd, 10.5);        // weighted $ (cache reads cheap)
  assert.equal(m.rawUsd, 15);       // every token at full input/output price
  assert.equal(m.saved, 4.5);       // rawUsd - usd

  // card-level totals mirror the single model
  assert.equal(hr.raw, 2_200_000);
  assert.equal(hr.usd, 10.5);
  assert.equal(hr.rawUsd, 15);
  assert.equal(hr.saved, 4.5);
});

test('compactSnapshot tolerates an empty/absent stats payload', () => {
  const row = compactSnapshot({});
  assert.equal(row.rtk.saved, 0);
  assert.equal(row.cav.saved, 0);
  assert.equal(row.hr.savedTokens, 0);
  assert.equal(row.hr.savedUsd, 0);
  assert.deepEqual(row.hr.models, {});
});
