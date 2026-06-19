const fs = require('fs');
const path = require('path');
const { priceFor } = require('./settings');

// Overridable via env (see settings.js) so tests isolate to a temp dir.
const DATA_DIR = process.env.TOKENOMICS_DATA_DIR || path.join(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
const HISTORY_MAX = Number(process.env.HISTORY_MAX) || 5000;

let history = [];

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
      history = raw.split('\n').filter(l => l.trim()).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
    }
  } catch (err) {
    console.error('Failed to load history:', err.message);
    history = [];
  }
}

function persistHistory() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, history.map(r => JSON.stringify(r)).join('\n') + '\n');
  } catch (e) {
    console.error('history persist failed:', e.message);
  }
}

function mRaw(m) {
  return (m.input || 0) + (m.output || 0) + (m.cache_reads || 0) + (m.cache_writes_total || 0);
}

function mWeighted(m) {
  const a = m.cache_writes_5m || 0, b = m.cache_writes_1h || 0;
  const w = (a || b) ? a * 1.25 + b * 2 : (m.cache_writes_total || 0) * 1.25;
  return Math.round((m.input || 0) + (m.output || 0) * 5 + (m.cache_reads || 0) * 0.1 + w);
}

function mUsd(name, m) {
  const p = priceFor(name);
  if (!p) return 0;
  const a = m.cache_writes_5m || 0, b = m.cache_writes_1h || 0;
  const wu = (a || b) ? a * p.cw5 + b * p.cw1 : (m.cache_writes_total || 0) * p.cw5;
  return ((m.input || 0) * p.in + (m.output || 0) * p.out + (m.cache_reads || 0) * p.cr + wu) / 1e6;
}

function mUsdRaw(name, m) {
  const p = priceFor(name);
  if (!p) return 0;
  const cacheAll = (m.cache_reads || 0) + (m.cache_writes_total || 0);
  return ((m.input || 0) * p.in + (m.output || 0) * p.out + cacheAll * p.in) / 1e6;
}

const shortModel = n => n.replace(/^(claude|gemini|antigravity|cursor)-/, '').replace(/-\d{8}$/, '').replace(/-\d{8}T.*$/, '');

function compactSnapshot(stats) {
  const row = { t: Date.now() };

  const rs = (stats.rtk && stats.rtk.summary) || {};
  row.rtk = { saved: rs.total_saved || 0, cmds: rs.total_commands || 0 };

  const c = stats.caveman || {};
  row.cav = { saved: c.total_saved_tokens || 0, sessions: c.session_count || 0 };

  const wt = (stats.headroom && stats.headroom.window_tokens) || {};
  const lt = (stats.headroom && stats.headroom.latest) || {};
  // Authoritative Headroom savings ledger (proxy_savings.json) — cumulative.
  const sav = (stats.headroom && stats.headroom.savings) || {};
  const life = sav.lifetime || {};
  const sess = sav.display_session || {};
  const models = {};
  let totalUsd = 0, totalRawUsd = 0, totalWtd = 0, totalRaw = 0;

  for (const [name, m] of Object.entries(wt.by_model || {})) {
    const raw = mRaw(m);
    if (!raw || name === '<synthetic>') continue;
    const usd = mUsd(name, m), rawUsd = mUsdRaw(name, m), wtd = mWeighted(m);
    models[shortModel(name)] = {
      raw, wtd,
      usd: +usd.toFixed(4),
      rawUsd: +rawUsd.toFixed(4),
      saved: +(rawUsd - usd).toFixed(4),
    };
    totalUsd += usd; totalRawUsd += rawUsd; totalWtd += wtd; totalRaw += raw;
  }

  row.hr = {
    // authoritative savings (monotonic — what `headroom perf` reports)
    savedTokens: life.tokens_saved || 0,
    savedUsd: +(life.compression_savings_usd || 0).toFixed(4),
    requests: life.requests || 0,
    savingsPct: sess.savings_percent || 0,
    // live window telemetry (usage cost, not savings)
    raw: totalRaw,
    wtd: totalWtd,
    usd: +totalUsd.toFixed(4),
    rawUsd: +totalRawUsd.toFixed(4),
    q5: (lt.five_hour && lt.five_hour.utilization_pct) || 0,
    q7: (lt.seven_day && lt.seven_day.utilization_pct) || 0,
    models,
  };

  return row;
}

function recordSnapshot(stats) {
  const row = compactSnapshot(stats);
  history.push(row);
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  persistHistory();
}

// Wipe all recorded trend history (in-memory + on-disk). Mutates the array in
// place so any reference captured by importers (server.js) stays valid.
function clearHistory() {
  history.length = 0;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, '');
  } catch (e) {
    console.error('history clear failed:', e.message);
  }
}

// Load history immediately on import
loadHistory();

module.exports = {
  get history() { return history; },
  loadHistory,
  persistHistory,
  compactSnapshot,
  recordSnapshot,
  clearHistory
};
