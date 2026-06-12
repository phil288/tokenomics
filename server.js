const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

const PORT = Number(process.env.PORT) || 3000;
const HOME = process.env.HOME || os.homedir();
const REFRESH_MS = Number(process.env.REFRESH_MS) || 10000;
const HISTORY_INTERVAL_MS = Number(process.env.HISTORY_INTERVAL_MS) || 60000;
const HISTORY_MAX = Number(process.env.HISTORY_MAX) || 5000; // ~3.5 days at 60s
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');

// USD per million tokens; cache rates = read 0.1×, write-5m 1.25×, write-1h 2× of input.
const PRICING = [
  ['claude-opus-4',   { in: 5,  out: 25, cr: 0.50, cw5: 6.25,  cw1: 10 }],
  ['claude-sonnet-4', { in: 3,  out: 15, cr: 0.30, cw5: 3.75,  cw1: 6  }],
  ['claude-haiku-4',  { in: 1,  out: 5,  cr: 0.10, cw5: 1.25,  cw1: 2  }],
  ['claude-fable-5',  { in: 10, out: 50, cr: 1.00, cw5: 12.50, cw1: 20 }],
];
function priceFor(name) {
  for (const [prefix, p] of PRICING) if (name.startsWith(prefix)) return p;
  return null;
}
function mRaw(m) { return (m.input||0)+(m.output||0)+(m.cache_reads||0)+(m.cache_writes_total||0); }
function mWeighted(m) {
  const a = m.cache_writes_5m||0, b = m.cache_writes_1h||0;
  const w = (a||b) ? a*1.25 + b*2 : (m.cache_writes_total||0)*1.25;
  return Math.round((m.input||0) + (m.output||0)*5 + (m.cache_reads||0)*0.1 + w);
}
// real (weighted) cost: cache reads/writes billed at their discounted/premium rates
function mUsd(name, m) {
  const p = priceFor(name);
  if (!p) return 0;
  const a = m.cache_writes_5m||0, b = m.cache_writes_1h||0;
  const wu = (a||b) ? a*p.cw5 + b*p.cw1 : (m.cache_writes_total||0)*p.cw5;
  return ((m.input||0)*p.in + (m.output||0)*p.out + (m.cache_reads||0)*p.cr + wu) / 1e6;
}
// raw cost: every cache token billed at full input price (i.e. as if no caching)
function mUsdRaw(name, m) {
  const p = priceFor(name);
  if (!p) return 0;
  const cacheAll = (m.cache_reads||0) + (m.cache_writes_total||0);
  return ((m.input||0)*p.in + (m.output||0)*p.out + cacheAll*p.in) / 1e6;
}
const shortModel = n => n.replace('claude-', '').replace(/-\d{8}$/, '').replace(/-\d{8}T.*$/, '');

function execPromise(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 10000 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

function readFile(filePath) {
  return new Promise((resolve) => {
    fs.readFile(filePath, 'utf8', (err, data) => resolve(err ? null : data));
  });
}

async function collectRTK() {
  const out = await execPromise('rtk gain -f json -a');
  if (!out) return { error: 'no data' };
  try { return JSON.parse(out); } catch { return { error: 'parse error' }; }
}

async function collectCaveman() {
  const [modeRaw, historyRaw] = await Promise.all([
    readFile(path.join(HOME, '.claude', '.caveman-active')),
    readFile(path.join(HOME, '.claude', '.caveman-history.jsonl')),
  ]);

  const mode = (modeRaw || 'unknown').trim();

  // Re-running /caveman-stats appends a fresh line per call for the same
  // session_id. Match Caveman's own aggregation: keep only the latest line
  // per session_id, then sum across distinct sessions.
  const latest = new Map();
  if (historyRaw) {
    for (const line of historyRaw.split('\n').filter(l => l.trim())) {
      try {
        const e = JSON.parse(line);
        const key = e.session_id || `_${latest.size}`;
        const prev = latest.get(key);
        if (!prev || (e.ts || 0) >= (prev.ts || 0)) latest.set(key, e);
      } catch {}
    }
  }

  const sessions = [...latest.values()];
  let totalOutputTokens = 0, totalSavedTokens = 0, totalSavedUsd = 0;
  for (const e of sessions) {
    totalOutputTokens += e.output_tokens || 0;
    totalSavedTokens += e.est_saved_tokens || 0;
    totalSavedUsd += e.est_saved_usd || 0;
  }

  return { mode, session_count: sessions.length, total_output_tokens: totalOutputTokens,
    total_saved_tokens: totalSavedTokens, total_saved_usd: totalSavedUsd, sessions };
}

async function collectHeadroom() {
  const raw = await readFile(path.join(HOME, '.headroom', 'subscription_state.json'));
  if (!raw) return { error: 'no data' };
  try { return JSON.parse(raw); } catch { return { error: 'parse error' }; }
}

async function collectStats() {
  const [rtk, caveman, headroom] = await Promise.all([collectRTK(), collectCaveman(), collectHeadroom()]);
  return { rtk, caveman, headroom, timestamp: new Date().toISOString(), refresh_ms: REFRESH_MS };
}

// ---- history (time-series) ----
let history = [];

function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    history = raw.split('\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  } catch { history = []; }
}

function persistHistory() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, history.map(r => JSON.stringify(r)).join('\n') + '\n');
  } catch (e) { console.error('history persist failed:', e.message); }
}

// compact one snapshot to a small time-series row
function compactSnapshot(stats) {
  const row = { t: Date.now() };

  const rs = (stats.rtk && stats.rtk.summary) || {};
  row.rtk = { saved: rs.total_saved || 0, cmds: rs.total_commands || 0 };

  const c = stats.caveman || {};
  row.cav = { saved: c.total_saved_tokens || 0, sessions: c.session_count || 0 };

  const wt = (stats.headroom && stats.headroom.window_tokens) || {};
  const lt = (stats.headroom && stats.headroom.latest) || {};
  const models = {};
  let totalUsd = 0, totalRawUsd = 0, totalWtd = 0, totalRaw = 0;
  for (const [name, m] of Object.entries(wt.by_model || {})) {
    const raw = mRaw(m);
    if (!raw || name === '<synthetic>') continue;
    const usd = mUsd(name, m), rawUsd = mUsdRaw(name, m), wtd = mWeighted(m);
    models[shortModel(name)] = {
      raw, wtd,
      usd: +usd.toFixed(4),          // real (weighted) cost
      rawUsd: +rawUsd.toFixed(4),    // cost without caching
      saved: +(rawUsd - usd).toFixed(4), // money caching saved
    };
    totalUsd += usd; totalRawUsd += rawUsd; totalWtd += wtd; totalRaw += raw;
  }
  row.hr = {
    cacheSave: Math.round((wt.cache_reads || 0) * 0.9),
    raw: totalRaw,
    wtd: totalWtd,
    usd: +totalUsd.toFixed(4),          // real cost
    rawUsd: +totalRawUsd.toFixed(4),    // raw cost (no caching)
    saved: +(totalRawUsd - totalUsd).toFixed(4), // saved cost
    q5: (lt.five_hour && lt.five_hour.utilization_pct) || 0,
    q7: (lt.seven_day && lt.seven_day.utilization_pct) || 0,
    models,
  };
  return row;
}

async function recordHistory() {
  const stats = await collectStats();
  const row = compactSnapshot(stats);
  history.push(row);
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  persistHistory();
}

const clients = new Set();

async function pushStats() {
  if (clients.size === 0) return;
  const stats = await collectStats();
  const data = `data: ${JSON.stringify(stats)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { clients.delete(res); }
  }
}

setInterval(pushStats, REFRESH_MS);

loadHistory();
recordHistory();
setInterval(recordHistory, HISTORY_INTERVAL_MS);

const server = http.createServer(async (req, res) => {
  if (req.url === '/') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('index.html not found');
    }
  } else if (req.url === '/api/stats') {
    const stats = await collectStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } else if (req.url === '/api/history') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(history));
  } else if (req.url === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(':ok\n\n');
    clients.add(res);

    const stats = await collectStats();
    res.write(`data: ${JSON.stringify(stats)}\n\n`);

    const ping = setInterval(() => {
      try { res.write(':ping\n\n'); } catch { clearInterval(ping); clients.delete(res); }
    }, 15000);

    req.on('close', () => { clearInterval(ping); clients.delete(res); });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`LLM Token Monitor → http://localhost:${PORT}`);
});
