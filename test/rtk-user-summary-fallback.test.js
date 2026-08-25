const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { applyUserRtkFallback } = require('../src/collectors');

const CARDS_CORE = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'cards-core.js'), 'utf8');

test('RTK aggregate falls back to per-user summaries in shared installs', () => {
  const rtk = {
    summary: {
      total_commands: 18,
      total_input: 0,
      total_output: 0,
      total_saved: 0,
      total_time_ms: 36,
    },
  };
  const users = [
    {
      user: 'mitch',
      rtk: {
        total_commands: 2480,
        total_input: 13100000,
        total_output: 1300000,
        total_saved: 11800000,
        total_time_ms: 2480,
      },
    },
    {
      user: 'michelmatta',
      rtk: {
        total_commands: 19655,
        total_input: 30000000,
        total_output: 21600000,
        total_saved: 8600000,
        total_time_ms: 39310,
      },
    },
  ];

  const fixed = applyUserRtkFallback(rtk, users);
  assert.equal(fixed.summary_source, 'users');
  assert.equal(fixed.summary.total_saved, 20400000);
  assert.equal(fixed.summary.total_input, 43100000);
  assert.equal(fixed.summary.total_output, 22900000);
  assert.equal(fixed.summary.total_commands, 22135);
  assert.equal(fixed.summary.avg_time_ms, 2);
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
  const fixed = applyUserRtkFallback(rtk, [
    { user: 'mitch', rtk: { total_saved: 40, total_input: 50 } },
  ]);

  assert.equal(fixed, rtk);
});

test('RTK card and hero render from per-user fallback summary', () => {
  assert.match(CARDS_CORE, /function rtkSummary\(d\)/);
  assert.match(CARDS_CORE, /const s = rtkSummary\(d\)/);
  assert.match(CARDS_CORE, /rtkSummary\(stats\.rtk\)\.total_saved/);
});

test('collectStats reapplies RTK fallback after baseline normalization', () => {
  const collectors = fs.readFileSync(path.join(__dirname, '..', 'src', 'collectors.js'), 'utf8');
  assert.match(collectors, /const stats = applyBaseline\(await collectStatsRaw\(\)\)/);
  assert.match(collectors, /applyUserRtkFallback\(stats\.rtk, stats\.users\)/);
});
