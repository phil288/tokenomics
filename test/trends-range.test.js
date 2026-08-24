const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chartsSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'web', 'charts.js'),
  'utf8',
);

async function loadCharts(suffix) {
  const transformed = chartsSource
    .replace(
      "import { tc, ht, usdFull } from './format.js';",
      () => "const tc = () => '#888'; const ht = String; const usdFull = String;",
    )
    .replace(
      "import { state } from './state.js';",
      'const state = { lastStats: null };',
    );
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}#${suffix}`);
}

test('trend ranges reject stale or malformed saved values', async () => {
  const charts = await loadCharts('normalize');

  assert.equal(charts.normalizeHistoryRange('60'), 60);
  assert.equal(charts.normalizeHistoryRange('0'), 0);
  assert.equal(charts.normalizeHistoryRange('bogus'), 360);
  assert.equal(charts.normalizeHistoryRange('120'), 360);
});

test('finite trend ranges use exact wall-clock bounds and carry the cutoff value', async () => {
  const charts = await loadCharts('filter');
  const now = Date.UTC(2026, 6, 28, 20, 0);
  const rows = [
    { t: now - 90 * 60000, rtk: { saved: 10 } },
    { t: now - 30 * 60000, rtk: { saved: 20 } },
    { t: now - 5 * 60000, rtk: { saved: 30 } },
    { t: now + 60000, rtk: { saved: 999 } },
  ];

  const filtered = charts.filterHistoryRows(rows, 60, now);
  assert.deepEqual(filtered.map(row => row.t), [
    now - 60 * 60000,
    now - 30 * 60000,
    now - 5 * 60000,
  ]);
  assert.deepEqual(filtered.map(row => row.rtk.saved), [10, 20, 30]);
  assert.notStrictEqual(filtered[0], rows[0], 'the carried boundary must not mutate history');
  assert.deepEqual(charts.historyTimeBounds(filtered, 60, now), {
    min: now - 60 * 60000,
    max: now,
    span: 60 * 60000,
  });
});

test('trend charts use real timestamps on a linear x-axis', () => {
  assert.match(chartsSource, /x:\s*\{\s*type: 'linear'/);
  assert.match(chartsSource, /data: dataset\.data\.map\(\(y, index\) => \(\{ x: timestamps\[index\], y \}\)\)/);
  assert.match(chartsSource, /spanMs >= 24 \* 60 \* 60000/);
  assert.match(chartsSource, /month: 'short', day: 'numeric'/);
});

test('Chart.js receives timestamped points and the selected range bounds', async () => {
  const charts = await loadCharts('chart-config');
  const originalDocument = globalThis.document;
  const originalChart = globalThis.Chart;
  let config;

  globalThis.document = {
    getElementById() {
      return { getContext: () => ({}) };
    },
  };
  globalThis.Chart = class {
    constructor(_context, nextConfig) {
      config = nextConfig;
    }
  };

  const now = Date.UTC(2026, 6, 28, 20, 0);
  const bounds = { min: now - 3600000, max: now, span: 3600000 };
  try {
    charts.drawLine(
      'range-config',
      [now - 3600000, now],
      [{ label: 'RTK', data: [10, 20], borderColor: '#58a6ff' }],
      String,
      context => String(context.raw),
      undefined,
      bounds,
    );
  } finally {
    globalThis.document = originalDocument;
    if (originalChart === undefined) delete globalThis.Chart;
    else globalThis.Chart = originalChart;
  }

  assert.equal(config.options.scales.x.type, 'linear');
  assert.equal(config.options.scales.x.min, bounds.min);
  assert.equal(config.options.scales.x.max, bounds.max);
  assert.deepEqual(config.data.datasets[0].data, [
    { x: now - 3600000, y: 10 },
    { x: now, y: 20 },
  ]);
});

test('range controls keep visual and pressed states synchronized', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  for (const minutes of ['60', '360', '1440', '0']) {
    assert.match(
      html,
      new RegExp(`<button type="button" class="rbtn rng(?: active)?" data-min="${minutes}" aria-pressed="(?:true|false)">`),
    );
  }
  assert.match(chartsSource, /btn\.setAttribute\('aria-pressed', String\(active\)\)/);
  assert.match(chartsSource, /b\.setAttribute\('aria-pressed', 'false'\)/);
  assert.match(chartsSource, /btn\.setAttribute\('aria-pressed', 'true'\)/);
});
