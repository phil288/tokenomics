// ---- RTK daily chart + history trend charts (Chart.js) ----
import { tc, ht, usdFull } from './format.js';
import { state } from './state.js';

let rtkChart = null;

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
  rtkChart = new Chart(canvas.getContext('2d'), {
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
let histRangeMin = 360; // default 6h
try { const s = localStorage.getItem('ltm-range'); if (s !== null) histRangeMin = Number(s); } catch { }
const histCharts = {};

function filterHist() {
  if (!histRangeMin) return histData;
  const cutoff = Date.now() - histRangeMin * 60000;
  return histData.filter(r => r.t >= cutoff);
}

const hcBase = (extra) => ({
  type: 'line',
  options: {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: tc('muted'), font: { size: 11 }, boxWidth: 12, padding: 8 } },
      tooltip: { callbacks: extra.tooltip || {} },
    },
    elements: { point: { radius: 0, hitRadius: 8 }, line: { tension: 0.25, borderWidth: 2 } },
    scales: {
      x: { ticks: { color: tc('muted'), font: { size: 10 }, maxTicksLimit: 6 }, grid: { color: tc('grid') } },
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

function drawLine(id, labels, datasets, yfmt, tipfmt, y1fmt) {
  const cv = document.getElementById(id);
  if (!cv) return;
  if (histCharts[id]) {
    histCharts[id].data.labels = labels;
    histCharts[id].data.datasets = datasets;
    histCharts[id].update('none');
    return;
  }
  const cfg = hcBase({ yfmt, tooltip: { label: tipfmt }, y1fmt });
  cfg.data = { labels, datasets };
  histCharts[id] = new Chart(cv.getContext('2d'), cfg);
}

export function renderHistory() {
  const rows = filterHist();
  if (rows.length < 2) return;

  const labels = rows.map(r => new Date(r.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  const ds = (data, color, label) => ({ label, data, borderColor: color, backgroundColor: color + '22', fill: false });

  // 1. tokens saved — all three are genuine cumulative tokens-saved totals now
  // (Headroom from proxy_savings.json), so they share one axis and one unit.
  drawLine('hc-saved', labels, [
    ds(rows.map(r => r.rtk?.saved || 0), '#58a6ff', 'RTK'),
    ds(rows.map(r => r.cav?.saved || 0), '#d4a72c', 'Caveman'),
    ds(rows.map(r => r.hr?.savedTokens || 0), '#3fb950', 'Headroom'),
  ], ht, c => ` ${c.dataset.label}: ${ht(c.raw)}`);

  // 2. cost — raw/real are live window-telemetry usage cost; saved is the
  // authoritative Headroom compression savings (proxy_savings.json, USD).
  drawLine('hc-cost', labels, [
    ds(rows.map(r => r.hr?.rawUsd || 0), tc('muted'), 'raw'),
    ds(rows.map(r => r.hr?.usd || 0), '#d4a72c', 'real'),
    ds(rows.map(r => r.hr?.savedUsd || 0), '#3fb950', 'saved'),
  ], v => '$' + v.toFixed(0), c => ` ${c.dataset.label}: ${usdFull(c.raw)}`);
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
    btn.classList.toggle('active', Number(btn.dataset.min) === histRangeMin);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rng').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      histRangeMin = Number(btn.dataset.min);
      try { localStorage.setItem('ltm-range', String(histRangeMin)); } catch { }
      renderHistory();
    });
  });
}

// Tear down every chart and rebuild from the last snapshot — used on theme flips
// so axis/grid/label colors repaint against the new CSS variables.
export function redrawAllCharts() {
  if (rtkChart) { rtkChart.destroy(); rtkChart = null; }
  Object.values(histCharts).forEach(c => c && c.destroy());
  for (const k of Object.keys(histCharts)) delete histCharts[k];
  const ls = state.lastStats;
  if (ls && ls.rtk && (ls.rtk.daily || []).length) drawRTKChart(ls.rtk.daily);
  renderHistory();
}
