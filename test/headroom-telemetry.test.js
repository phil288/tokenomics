const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.TOKENOMICS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-hr-telemetry-'));

const {
  TELEMETRY_FILE,
  accumulateWindowTelemetry,
  clearTelemetryState,
} = require('../src/headroom-telemetry');

function sample(overrides = {}) {
  return {
    input: 100,
    output: 20,
    cache_reads: 500,
    cache_writes_5m: 10,
    cache_writes_1h: 30,
    cache_writes_total: 40,
    total_raw: 660,
    weighted_token_equivalent: 210,
    by_model: {
      'claude-sonnet-5': {
        input: 100,
        output: 20,
        cache_reads: 500,
        cache_writes_5m: 10,
        cache_writes_1h: 30,
        cache_writes_total: 40,
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  clearTelemetryState();
});

test('accumulateWindowTelemetry returns first observed Headroom window totals', () => {
  const out = accumulateWindowTelemetry(sample());
  assert.equal(out.total_raw, 660);
  assert.equal(out.weighted_token_equivalent, 210);
  assert.equal(out.by_model['claude-sonnet-5'].cache_reads, 500);
  assert.ok(fs.existsSync(TELEMETRY_FILE), 'telemetry accumulator should persist');
});

test('accumulateWindowTelemetry adds only growth within the same raw window', () => {
  accumulateWindowTelemetry(sample());
  const out = accumulateWindowTelemetry(sample({
    input: 125,
    cache_reads: 550,
    total_raw: 735,
    by_model: {
      'claude-sonnet-5': {
        input: 125,
        output: 20,
        cache_reads: 550,
        cache_writes_5m: 10,
        cache_writes_1h: 30,
        cache_writes_total: 40,
      },
    },
  }));

  assert.equal(out.input, 125);
  assert.equal(out.cache_reads, 550);
  assert.equal(out.total_raw, 735);
  assert.equal(out.by_model['claude-sonnet-5'].input, 125);
});

test('accumulateWindowTelemetry preserves totals when Headroom reports a restart reset to zero', () => {
  accumulateWindowTelemetry(sample());
  const out = accumulateWindowTelemetry(sample({
    input: 0,
    output: 0,
    cache_reads: 0,
    cache_writes_5m: 0,
    cache_writes_1h: 0,
    cache_writes_total: 0,
    total_raw: 0,
    weighted_token_equivalent: 0,
    by_model: {},
  }));

  assert.equal(out.total_raw, 660);
  assert.equal(out.cache_reads, 500);
  assert.equal(out.by_model['claude-sonnet-5'].cache_reads, 500);
});

test('accumulateWindowTelemetry returns persisted totals when the raw source is missing, without double-counting later', () => {
  accumulateWindowTelemetry(sample());
  // Source unreadable (e.g. subscription_state.json briefly missing) → keep
  // showing the accumulated totals…
  const during = accumulateWindowTelemetry(null);
  assert.equal(during.total_raw, 660);
  assert.equal(during.by_model['claude-sonnet-5'].cache_reads, 500);
  // …and when the SAME still-growing raw counters come back, only the growth
  // is added (a null read must not reset the `last` snapshot to zero).
  const after = accumulateWindowTelemetry(sample({ input: 110, total_raw: 670 }));
  assert.equal(after.input, 110);
  assert.equal(after.total_raw, 670);
});

test('accumulateWindowTelemetry counts new usage after a raw counter reset', () => {
  accumulateWindowTelemetry(sample());
  accumulateWindowTelemetry(sample({
    input: 0,
    output: 0,
    cache_reads: 0,
    cache_writes_5m: 0,
    cache_writes_1h: 0,
    cache_writes_total: 0,
    total_raw: 0,
    weighted_token_equivalent: 0,
    by_model: {},
  }));
  const out = accumulateWindowTelemetry(sample({
    input: 7,
    output: 3,
    cache_reads: 50,
    cache_writes_5m: 0,
    cache_writes_1h: 0,
    cache_writes_total: 0,
    total_raw: 60,
    weighted_token_equivalent: 15,
    by_model: {
      'claude-fable-5': {
        input: 7,
        output: 3,
        cache_reads: 50,
        cache_writes_5m: 0,
        cache_writes_1h: 0,
        cache_writes_total: 0,
      },
    },
  }));

  assert.equal(out.total_raw, 720);
  assert.equal(out.cache_reads, 550);
  assert.equal(out.by_model['claude-fable-5'].cache_reads, 50);
});

// ---- collectHeadroom wiring: the card's telemetry must survive a PC/proxy
// restart (raw window_tokens reset to zero) and a missing state file. ----

test('collectHeadroom serves the persisted accumulator across a Headroom restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-hr-collect-'));
  const subPath = path.join(dir, 'subscription_state.json');
  const savPath = path.join(dir, 'proxy_savings.json');
  fs.writeFileSync(savPath, JSON.stringify({ lifetime: { tokens_saved: 1, requests: 1 } }));

  const { updateSettings } = require('../src/settings');
  updateSettings({
    HEADROOM_SUBSCRIPTION_STATE_PATH: subPath,
    HEADROOM_SAVINGS_PATH: savPath,
    HEADROOM_HEALTH_URL: '', // disable the live health probe in tests
  });
  const { collectHeadroom } = require('../src/collectors');

  fs.writeFileSync(subPath, JSON.stringify({ window_tokens: sample() }));
  let out = await collectHeadroom();
  assert.equal(out.window_tokens.total_raw, 660);

  // Headroom (or the whole PC) restarts → raw counters drop to zero, but the
  // dashboard telemetry must keep the accumulated totals.
  fs.writeFileSync(subPath, JSON.stringify({ window_tokens: {} }));
  out = await collectHeadroom();
  assert.equal(out.window_tokens.total_raw, 660);
  assert.equal(out.window_tokens.cache_reads, 500);

  // State file missing entirely → still serve the accumulator.
  fs.rmSync(subPath);
  out = await collectHeadroom();
  assert.equal(out.window_tokens.total_raw, 660);

  // New usage after the restart adds on top.
  fs.writeFileSync(subPath, JSON.stringify({
    window_tokens: sample({
      input: 7, output: 0, cache_reads: 0, cache_writes_5m: 0, cache_writes_1h: 0,
      cache_writes_total: 0, total_raw: 7, weighted_token_equivalent: 7, by_model: {},
    }),
  }));
  out = await collectHeadroom();
  assert.equal(out.window_tokens.total_raw, 667);
  assert.equal(out.window_tokens.input, 107);
});
