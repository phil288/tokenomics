// ---- RTK daily chart + history trend charts (Chart.js) ----
import { tc, ht, usdFull } from './format.js';
import { state } from './state.js';

let rtkChart = null;

const chartAvailable = () => typeof globalThis.Chart === 'function';

function canvasSurface(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.round(rect.width || canvas.clientWidth || 600));
  const height = Math.max(150, Math.round(rect.height || canvas.clientHeight || 200));
  const scale = Math.min(globalThis.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);

  return { ctx, width, height };
}

function drawFallbackAxes(ctx, width, height, maxValue, yfmt) {
  const plot = { left: 52, top: 34, right: width - 14, bottom: height - 25 };
  const muted = tc('muted');
  const grid = tc('grid');
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = plot.bottom - ((plot.bottom - plot.top) * i / 4);
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.textAlign = 'right';
    ctx.fillText(yfmt(maxValue * i / 4), plot.left - 7, y);
  }

  return plot;
}

function drawFallbackXLabels(ctx, labels, plot) {
  if (!labels.length) return;
  const indexes = [...new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1])];
  ctx.fillStyle = tc('muted');
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const index of indexes) {
    const x = labels.length === 1
      ? (plot.left + plot.right) / 2
      : plot.left + ((plot.right - plot.left) * index / (labels.length - 1));
    ctx.fillText(labels[index], x, plot.bottom + 7);
  }
}

function drawFallbackTimeLabels(ctx, plot, xBounds) {
  const timestamps = [xBounds.min, xBounds.min + xBounds.span / 2, xBounds.max];
  ctx.fillStyle = tc('muted');
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  timestamps.forEach((timestamp, index) => {
    const x = plot.left + (plot.right - plot.left) * index / 2;
    ctx.fillText(formatHistoryTime(timestamp, xBounds.span), x, plot.bottom + 7);
  });
}

function drawLineFallback(canvas, timestamps, datasets, yfmt, xBounds) {
  const { ctx, width, height } = canvasSurface(canvas);
  if (!datasets.length) {
    ctx.fillStyle = tc('muted');
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No enabled sources', width / 2, height / 2);

    return;
  }

  const values = datasets.flatMap(dataset => dataset.data).map(Number).filter(Number.isFinite);
  const maxValue = Math.max(1, ...values);
  const plot = drawFallbackAxes(ctx, width, height, maxValue, yfmt);
  drawFallbackTimeLabels(ctx, plot, xBounds);
  const xSpan = Math.max(1, xBounds.max - xBounds.min);

  let legendX = plot.left;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const dataset of datasets) {
    ctx.strokeStyle = dataset.borderColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    dataset.data.forEach((raw, index) => {
      const timestamp = Number(timestamps[index]);
      const x = plot.left + (plot.right - plot.left)
        * (timestamp - xBounds.min) / xSpan;
      const y = plot.bottom - ((plot.bottom - plot.top) * (Number(raw) || 0) / maxValue);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    ctx.fillStyle = dataset.borderColor;
    ctx.fillRect(legendX, 10, 12, 3);
    ctx.fillStyle = tc('muted');
    ctx.textAlign = 'left';
    ctx.fillText(dataset.label, legendX + 17, 12);
    legendX += 22 + ctx.measureText(dataset.label).width;
  }
}

function drawBarFallback(canvas, labels, values) {
  const { ctx, width, height } = canvasSurface(canvas);
  const maxValue = Math.max(1, ...values.map(Number).filter(Number.isFinite));
  const plot = drawFallbackAxes(ctx, width, height, maxValue, ht);
  drawFallbackXLabels(ctx, labels, plot);
  const slot = (plot.right - plot.left) / Math.max(1, values.length);
  const barWidth = Math.max(3, slot * 0.62);
  values.forEach((raw, index) => {
    const value = Number(raw) || 0;
    const barHeight = (plot.bottom - plot.top) * value / maxValue;
    const x = plot.left + slot * index + (slot - barWidth) / 2;
    ctx.fillStyle = 'rgba(88,166,255,0.55)';
    ctx.fillRect(x, plot.bottom - barHeight, barWidth, barHeight);
  });
}

export function drawRTKChart(daily) {
  const wrap = document.getElementById('rtk-chart-wrap');
  const canvas = document.getElementById('rtk-chart');
  if (!canvas) return;

  if (!daily || !daily.length) {
    if (wrap) wrap.style.display = 'none';
    return;
  }
  if (wrap) wrap.style.display = 'block';

  const data14 = daily.slice(-14);
  const labels = data14.map(d => d.date.slice(5));
  const vals = data14.map(d => d.saved_tokens || 0);

  if (rtkChart) {
    rtkChart.data.labels = labels;
    rtkChart.data.datasets[0].data = vals;
    rtkChart.update('none');
    return;
  }
  if (!chartAvailable()) {
    drawBarFallback(canvas, labels, vals);
    return;
  }

  const barLabels = {
    id: 'rtkBarLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.fillStyle = tc('muted');
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      meta.data.forEach((bar, i) => {
        const v = chart.data.datasets[0].data[i];
        if (!v) return;
        ctx.fillText(ht(v), bar.x, bar.y - 2);
      });
      ctx.restore();
    },
  };
  rtkChart = new globalThis.Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: vals,
        backgroundColor: 'rgba(88,166,255,0.45)',
        borderColor: '#58a6ff',
        borderWidth: 1,
        borderRadius: 2,
      }],
    },
    plugins: [barLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 14 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${ht(c.raw)} saved` } },
      },
      scales: {
        x: { ticks: { color: tc('muted'), font: { size: 10 } }, grid: { color: tc('grid') } },
        y: { ticks: { color: tc('muted'), font: { size: 10 }, callback: v => ht(v) }, grid: { color: tc('grid') } },
      },
    },
  });
}

// ============ HISTORY CHARTS ============
let histData = [];
let liveHistData = [];
export const HISTORY_RANGES = [60, 360, 1440, 0];

export function normalizeHistoryRange(value, fallback = 360) {
  const range = Number(value);

  return HISTORY_RANGES.includes(range) ? range : fallback;
}

let histRangeMin = 360; // default 6h
try {
  const savedRange = localStorage.getItem('ltm-range');
  if (savedRange !== null) {
    histRangeMin = normalizeHistoryRange(savedRange);
  }
} catch { }
const histCharts = {};

function liveHistoryRow(stats, previousHr = {}) {
  if (!stats) return null;
  const t = Date.parse(stats.timestamp);
  if (!Number.isFinite(t)) {
    return null;
  }

  const rtk = stats.rtk?.summary || {};
  const cav = stats.caveman || {};
  const headroom = stats.headroom || {};
  const savings = headroom.savings || {};
  const life = savings.lifetime || {};
  const session = savings.display_session || {};
  const latest = stats.claude?.latest || {};

  return {
    t,
    rtk: {
      saved: rtk.total_saved || 0,
      cmds: rtk.total_commands || 0,
    },
    cav: {
      saved: cav.total_saved_tokens || 0,
      sessions: cav.session_count || 0,
    },
    hr: {
      ...previousHr,
      savedTokens: life.tokens_saved || 0,
      savedUsd: life.compression_savings_usd || 0,
      requests: life.requests || 0,
      savingsPct: session.savings_percent || 0,
      q5: latest.five_hour?.utilization_pct || 0,
      q7: latest.seven_day?.utilization_pct || 0,
    },
  };
}

export function upsertLiveHistory(rows, stats, previousHr = {}) {
  const row = liveHistoryRow(stats, previousHr);
  if (!row) {
    return rows;
  }

  const next = rows.filter(existing => existing.t !== row.t);
  next.push(row);
  next.sort((a, b) => a.t - b.t);
  // The SSE cadence is 10s by default: retain roughly one hour of live points.
  return next.slice(-360);
}

export function mergeHistoryRows(persisted, live) {
  const persistedLast = persisted.at(-1)?.t || 0;

  return [...persisted, ...live.filter(row => row.t > persistedLast)];
}

function captureLiveHistory() {
  const previousHr = liveHistData.at(-1)?.hr || histData.at(-1)?.hr || {};
  liveHistData = upsertLiveHistory(liveHistData, state.lastStats, previousHr);
}

export function filterHistoryRows(rows, rangeMin, now = Date.now()) {
  const end = Number(now);
  const ordered = rows
    .filter(row => Number.isFinite(row?.t) && row.t <= end)
    .sort((a, b) => a.t - b.t);
  if (!rangeMin) {
    return ordered;
  }

  const cutoff = end - rangeMin * 60000;
  const firstInside = ordered.findIndex(row => row.t >= cutoff);
  if (firstInside < 0) {
    return [];
  }

  const selected = ordered.slice(firstInside);
  // These series are cumulative. If recording paused across the cutoff (for
  // example while the PC slept), carry the last known reading to the exact
  // window boundary instead of making a 24h selection appear only 16h wide.
  if (firstInside > 0 && selected[0].t > cutoff) {
    selected.unshift({ ...ordered[firstInside - 1], t: cutoff });
  }

  return selected;
}

export function historyTimeBounds(rows, rangeMin, now = Date.now()) {
  if (rangeMin) {
    return { min: now - rangeMin * 60000, max: now, span: rangeMin * 60000 };
  }
  const min = rows[0]?.t ?? now;
  const max = rows.at(-1)?.t ?? now;

  return { min, max, span: Math.max(0, max - min) };
}

export function formatHistoryTime(timestamp, spanMs, full = false) {
  const options = spanMs >= 24 * 60 * 60000 || full
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' };

  return new Date(timestamp).toLocaleString([], options);
}

function filterHist(now) {
  return filterHistoryRows(
    mergeHistoryRows(histData, liveHistData),
    histRangeMin,
    now,
  );
}

export const hcBase = (extra) => ({
  type: 'line',
  options: {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: tc('muted'), font: { size: 11 }, boxWidth: 12, padding: 8 } },
      tooltip: {
        callbacks: {
          ...(extra.tooltip || {}),
          title: items => items.length
            ? formatHistoryTime(items[0].parsed.x, extra.xSpan, true)
            : '',
        },
      },
    },
    elements: { point: { radius: 0, hitRadius: 8 }, line: { tension: 0.25, borderWidth: 2 } },
    scales: {
      x: {
        type: 'linear',
        min: extra.xMin,
        max: extra.xMax,
        ticks: {
          color: tc('muted'),
          font: { size: 10 },
          maxTicksLimit: 6,
          callback: value => formatHistoryTime(value, extra.xSpan),
        },
        grid: { color: tc('grid') },
      },
      y: { ticks: { color: tc('muted'), font: { size: 10 }, callback: extra.yfmt }, grid: { color: tc('grid') }, beginAtZero: true },
      ...(extra.y1fmt ? {
        y1: {
          position: 'right', beginAtZero: true,
          ticks: { color: tc('muted'), font: { size: 10 }, callback: extra.y1fmt },
          grid: { drawOnChartArea: false },
        }
      } : {}),
    },
  },
});

function timestampedDatasets(timestamps, datasets) {
  return datasets.map(dataset => ({
    ...dataset,
    data: dataset.data.map((y, index) => ({ x: timestamps[index], y })),
  }));
}

export function drawLine(id, timestamps, datasets, yfmt, tipfmt, y1fmt, xBounds) {
  const cv = document.getElementById(id);
  if (!cv) {
    return;
  }

  const finiteTimestamps = timestamps.map(Number).filter(Number.isFinite);
  const firstTimestamp = finiteTimestamps[0] ?? Date.now();
  const lastTimestamp = finiteTimestamps.at(-1) ?? firstTimestamp;
  const bounds = xBounds || {
    min: firstTimestamp,
    max: lastTimestamp,
    span: Math.max(0, lastTimestamp - firstTimestamp),
  };
  const plotted = timestampedDatasets(timestamps, datasets);
  if (histCharts[id]) {
    histCharts[id].data.datasets = plotted;
    histCharts[id].options.scales.x.min = bounds.min;
    histCharts[id].options.scales.x.max = bounds.max;
    histCharts[id].options.scales.x.ticks.callback =
      value => formatHistoryTime(value, bounds.span);
    histCharts[id].options.plugins.tooltip.callbacks.title =
      items => items.length ? formatHistoryTime(items[0].parsed.x, bounds.span, true) : '';
    histCharts[id].update('none');

    return;
  }
  if (!chartAvailable()) {
    drawLineFallback(cv, timestamps, datasets, yfmt, bounds);

    return;
  }

  const cfg = hcBase({
    yfmt,
    tooltip: {
      label: context => tipfmt({
        ...context,
        raw: context.parsed?.y ?? context.raw,
      }),
    },
    y1fmt,
    xMin: bounds.min,
    xMax: bounds.max,
    xSpan: bounds.span,
  });
  cfg.data = { datasets: plotted };
  histCharts[id] = new globalThis.Chart(cv.getContext('2d'), cfg);
}

export function renderHistory(visibilityOverride) {
  captureLiveHistory();
  const now = Date.now();
  const rows = filterHist(now);
  const xBounds = historyTimeBounds(rows, histRangeMin, now);
  const visibility = visibilityOverride || (state.lastStats && state.lastStats.visibility) || {};
  const enabledSavedSources = [
    { key: 'rtk', label: 'RTK', color: '#58a6ff' },
    { key: 'caveman', label: 'Caveman', color: '#d4a72c' },
    { key: 'headroom', label: 'Headroom', color: '#3fb950' },
  ].filter(source => visibility[source.key] !== false);
  const savedSourceLabel = document.getElementById('history-saved-sources');
  if (savedSourceLabel) {
    savedSourceLabel.textContent = enabledSavedSources.length
      ? enabledSavedSources.map(source => source.label).join(' · ')
      : 'no enabled sources';
  }
  const headroomCostTrend = document.getElementById('headroom-cost-trend');
  // Cost is a dashboard-level historical trend, not the Headroom source card.
  // Keep it visible even when that provider widget is disabled.
  if (headroomCostTrend) headroomCostTrend.style.display = '';

  if (rows.length < 2) {
    // Do not leave a pre-reset or pre-toggle chart painted with stale provider
    // datasets while there are too few current points to redraw it.
    for (const id of ['hc-saved', 'hc-cost']) {
      if (histCharts[id]) {
        histCharts[id].destroy();
        delete histCharts[id];
      }
      const canvas = document.getElementById(id);
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    }

    return;
  }

  const timestamps = rows.map(r => r.t);
  const ds = (data, color, label) => ({ label, data, borderColor: color, backgroundColor: color + '22', fill: false });
  const savedSources = enabledSavedSources.map(source => ({
    ...source,
    data: source.key === 'rtk'
      ? rows.map(r => r.rtk?.saved || 0)
      : source.key === 'caveman'
        ? rows.map(r => r.cav?.saved || 0)
        : rows.map(r => r.hr?.savedTokens || 0),
  }));

  // 1. tokens saved — all three are genuine cumulative tokens-saved totals now
  // (Headroom from proxy_savings.json), so they share one axis and one unit.
  drawLine(
    'hc-saved',
    timestamps,
    savedSources.map(source => ds(source.data, source.color, source.label)),
    ht,
    c => ` ${c.dataset.label}: ${ht(c.raw)}`,
    undefined,
    xBounds,
  );

  // 2. cost — raw/real are live window-telemetry usage cost; saved is the
  // authoritative Headroom compression savings (proxy_savings.json, USD).
  drawLine('hc-cost', timestamps, [
    ds(rows.map(r => r.hr?.rawUsd || 0), tc('muted'), 'raw'),
    ds(rows.map(r => r.hr?.usd || 0), '#d4a72c', 'real'),
    ds(rows.map(r => r.hr?.savedUsd || 0), '#3fb950', 'saved'),
  ], v => '$' + v.toFixed(0), c => ` ${c.dataset.label}: ${usdFull(c.raw)}`, undefined, xBounds);
}

export async function fetchHistory() {
  try {
    const r = await fetch('/api/history');
    histData = await r.json();
    renderHistory();
  } catch (err) { console.error(err); }
}

// Wire the range buttons (6h/24h/etc.) and restore the saved active range.
export function initHistoryControls() {
  document.querySelectorAll('.rng').forEach(btn => {
    // restore active state from saved range
    const active = normalizeHistoryRange(btn.dataset.min, -1) === histRangeMin;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rng').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      histRangeMin = normalizeHistoryRange(btn.dataset.min);
      try { localStorage.setItem('ltm-range', String(histRangeMin)); } catch { }
      renderHistory();
    });
  });
}

// Other modules (analysis.js) own charts on canvases outside this file's
// registry. They register a redraw callback here so a theme flip rebuilds them
// too, instead of leaving stale axis/grid colors. Avoids a charts↔analysis
// import cycle — charts.js never imports the consumer.
const redrawHooks = [];
export function registerRedraw(fn) { if (typeof fn === 'function') redrawHooks.push(fn); }

// Tear down every chart and rebuild from the last snapshot — used on theme flips
// so axis/grid/label colors repaint against the new CSS variables.
export function redrawAllCharts() {
  if (rtkChart) { rtkChart.destroy(); rtkChart = null; }
  Object.values(histCharts).forEach(c => c && c.destroy());
  for (const k of Object.keys(histCharts)) delete histCharts[k];
  const ls = state.lastStats;
  if (ls && ls.rtk && (ls.rtk.daily || []).length) drawRTKChart(ls.rtk.daily);
  renderHistory();
  for (const fn of redrawHooks) { try { fn(); } catch (e) { console.error(e); } }
}
