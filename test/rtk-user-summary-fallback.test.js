const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.TOKENOMICS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-rtk-fallback-'));

const { applyBaseline, captureBaseline, clearBaseline } = require('../src/baseline');
const { applyUserRtkFallback, mergeUserRtkResults } = require('../src/collectors');

function rtkResult(saved, commands, date = '2026-08-25') {
  return {
    summary: {
      total_commands: commands,
      total_input: saved * 2,
      total_output: saved,
      total_saved: saved,
      total_time_ms: commands * 2,
    },
    daily: [{
      date,
      commands,
      input_tokens: saved * 2,
      output_tokens: saved,
      saved_tokens: saved,
      total_time_ms: commands * 2,
    }],
    weekly: [{
      week_start: '2026-08-24',
      week_end: '2026-08-30',
      commands,
      input_tokens: saved * 2,
      output_tokens: saved,
      saved_tokens: saved,
      total_time_ms: commands * 2,
    }],
    monthly: [{
      month: '2026-08',
      commands,
      input_tokens: saved * 2,
      output_tokens: saved,
      saved_tokens: saved,
      total_time_ms: commands * 2,
    }],
  };
}

test('RTK aggregate falls back to merged per-user results in shared installs', () => {
  const rtk = {
    summary: {
      total_commands: 18,
      total_input: 0,
      total_output: 0,
      total_saved: 0,
      total_time_ms: 36,
    },
    daily: [],
    weekly: [],
    monthly: [],
  };
  const fixed = applyUserRtkFallback(rtk, [
    rtkResult(11800000, 2480),
    rtkResult(8600000, 19655),
  ]);

  assert.equal(fixed.summary_source, 'users');
  assert.equal(fixed.summary.total_saved, 20400000);
  assert.equal(fixed.summary.total_input, 40800000);
  assert.equal(fixed.summary.total_output, 20400000);
  assert.equal(fixed.summary.total_commands, 22135);
  assert.equal(fixed.daily[0].saved_tokens, 20400000);
  assert.equal(fixed.weekly[0].saved_tokens, 20400000);
  assert.equal(fixed.monthly[0].saved_tokens, 20400000);
});

test('RTK aggregate keeps collector summary when it is already higher', () => {
  const rtk = {
    summary: {
      total_commands: 1,
      total_input: 100,
      total_output: 10,
      total_saved: 90,
      total_time_ms: 4,
    },
  };
  const fixed = applyUserRtkFallback(rtk, [rtkResult(40, 1)]);

  assert.equal(fixed, rtk);
});

test('RTK per-user merge computes ratios and period buckets once on backend', () => {
  const merged = mergeUserRtkResults([
    rtkResult(100, 2),
    rtkResult(50, 1),
  ]);

  assert.equal(merged.summary.total_saved, 150);
  assert.equal(merged.summary.avg_savings_pct, 50);
  assert.equal(merged.daily.length, 1);
  assert.equal(merged.daily[0].commands, 3);
  assert.equal(merged.daily[0].savings_pct, 50);
});

test('baseline is applied after raw RTK fallback without reintroducing all-time user totals', () => {
  const resetAt = Date.parse('2026-08-25T08:00:00Z');
  const rawAtReset = {
    rtk: applyUserRtkFallback({ summary: { total_saved: 0 } }, [rtkResult(1000, 10)]),
  };
  captureBaseline(rawAtReset, undefined, resetAt);

  const rawAfterReset = {
    rtk: applyUserRtkFallback({ summary: { total_saved: 0 } }, [rtkResult(1300, 13)]),
  };
  const stats = applyBaseline(rawAfterReset);

  assert.equal(stats.rtk.summary.total_saved, 300);
  assert.equal(stats.rtk.summary.total_commands, 3);
  assert.equal(stats.rtk.daily[0].saved_tokens, 300);
  assert.equal(stats.rtk.weekly[0].saved_tokens, 300);
  assert.equal(stats.rtk.monthly[0].saved_tokens, 300);
  clearBaseline();
});
