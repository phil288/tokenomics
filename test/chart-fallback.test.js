const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const charts = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'charts.js'), 'utf8');

test('chart rendering has a Canvas fallback when the CDN global is unavailable', () => {
  assert.match(charts, /const chartAvailable = \(\) => typeof globalThis\.Chart === 'function'/);
  assert.match(charts, /if \(!chartAvailable\(\)\) \{\s*drawBarFallback\(canvas, labels, vals\);\s*return;/);
  assert.match(charts, /if \(!chartAvailable\(\)\) \{\s*drawLineFallback\(cv, timestamps, datasets, yfmt, bounds\);\s*return;/);
  assert.match(charts, /new globalThis\.Chart/g);
  assert.doesNotMatch(charts, /new Chart\(/, 'unguarded Chart globals can escape into settings saves');
});

test('fallback chart renderers draw axes, labels, lines, bars, and an empty state', () => {
  for (const contract of [
    /function canvasSurface\(/,
    /function drawFallbackAxes\(/,
    /function drawFallbackXLabels\(/,
    /function drawLineFallback\(/,
    /function drawBarFallback\(/,
    /No enabled sources/,
    /ctx\.lineTo\(/,
    /ctx\.fillRect\(/,
    /ctx\.clearRect\(0, 0, canvas\.width, canvas\.height\)/,
  ]) {
    assert.match(charts, contract);
  }
});

test('fresh SSE snapshots extend stale persisted chart history', async () => {
  const transformed = charts
    .replace(
      "import { tc, ht, usdFull } from './format.js';",
      () => "const tc = () => '#888'; const ht = value => String(Math.round(value)); const usdFull = value => '$' + Number(value).toFixed(2);",
    )
    .replace(
      "import { state } from './state.js';",
      'const state = { lastStats: null };',
    );
  const module = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}#live`);
  const first = Date.now() - 10_000;
  const second = first + 10_000;
  let live = [];

  live = module.upsertLiveHistory(live, {
    timestamp: new Date(first).toISOString(),
    rtk: { summary: { total_saved: 100, total_commands: 2 } },
    headroom: { latest: { five_hour: { utilization_pct: 91 }, seven_day: { utilization_pct: 92 } } },
    claude: { latest: { five_hour: { utilization_pct: 11 }, seven_day: { utilization_pct: 12 } } },
  });
  live = module.upsertLiveHistory(live, {
    timestamp: new Date(second).toISOString(),
    rtk: { summary: { total_saved: 175, total_commands: 3 } },
  });
  // Repeating the same SSE timestamp updates the point rather than duplicating it.
  live = module.upsertLiveHistory(live, {
    timestamp: new Date(second).toISOString(),
    rtk: { summary: { total_saved: 180, total_commands: 3 } },
  });

  assert.equal(live.length, 2);
  assert.deepEqual(live.map(row => row.rtk.saved), [100, 180]);
  assert.equal(live[0].hr.q5, 11);
  assert.equal(live[0].hr.q7, 12);
  assert.deepEqual(
    module.mergeHistoryRows([{ t: 1, rtk: { saved: 50 } }], live)
      .map(row => row.rtk.saved),
    [50, 100, 180],
  );
});

test('fallback renderers execute without a Chart global', async () => {
  const transformed = charts
    .replace(
      "import { tc, ht, usdFull } from './format.js';",
      () => "const tc = () => '#888'; const ht = value => String(Math.round(value)); const usdFull = value => '$' + Number(value).toFixed(2);",
    )
    .replace(
      "import { state } from './state.js';",
      'const state = { lastStats: null };',
    );
  const module = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`);

  const calls = [];
  const context = {
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {},
    lineTo() { calls.push('line'); }, stroke() {}, fillText() {},
    fillRect() { calls.push('bar'); },
    measureText(text) { return { width: String(text).length * 6 }; },
  };
  const canvas = {
    style: {},
    clientWidth: 600,
    clientHeight: 200,
    getBoundingClientRect() { return { width: 600, height: 200 }; },
    getContext() { return context; },
  };
  const wrap = { style: {} };
  const costWrap = { style: { display: 'none' } };
  const sourceLabel = { textContent: '' };
  const originalDocument = globalThis.document;
  const originalChart = globalThis.Chart;
  const originalFetch = globalThis.fetch;
  globalThis.document = {
    getElementById(id) {
      if (id === 'rtk-chart-wrap') {
        return wrap;
      }
      if (id === 'headroom-cost-trend') {
        return costWrap;
      }
      if (id === 'history-saved-sources') {
        return sourceLabel;
      }

      return canvas;
    },
  };

  globalThis.fetch = async () => ({
    json: async () => [
      { t: 1, rtk: { saved: 10 }, cav: { saved: 5 }, hr: { savedTokens: 4, rawUsd: 3, usd: 2, savedUsd: 1 } },
      { t: 2, rtk: { saved: 20 }, cav: { saved: 8 }, hr: { savedTokens: 7, rawUsd: 4, usd: 3, savedUsd: 1 } },
    ],
  });
  delete globalThis.Chart;

  try {
    module.drawLine(
      'hc-saved',
      [Date.now() - 10_000, Date.now()],
      [{ label: 'RTK', data: [10, 20], borderColor: '#58a6ff' }],
      value => String(value),
    );
    module.drawRTKChart([
      { date: '2026-07-24', saved_tokens: 10 },
      { date: '2026-07-25', saved_tokens: 20 },
    ]);
    await module.fetchHistory();
    costWrap.style.display = 'none';
    module.renderHistory({ rtk: true, caveman: false, headroom: false });
  } finally {
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    if (originalChart === undefined) {
      delete globalThis.Chart;
    }
    else {
      globalThis.Chart = originalChart;
    }
  }

  assert.ok(calls.includes('line'), 'line fallback should paint a trend');
  assert.ok(calls.includes('bar'), 'bar fallback should paint RTK bars');
  assert.equal(costWrap.style.display, '', 'cost history stays visible when the Headroom card is disabled');
});
