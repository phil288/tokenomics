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
  ['claude-opus-4', { in: 5, out: 25, cr: 0.50, cw5: 6.25, cw1: 10 }],
  ['claude-sonnet-4', { in: 3, out: 15, cr: 0.30, cw5: 3.75, cw1: 6 }],
  ['claude-haiku-4', { in: 1, out: 5, cr: 0.10, cw5: 1.25, cw1: 2 }],
  ['claude-fable-5', { in: 10, out: 50, cr: 1.00, cw5: 12.50, cw1: 20 }],
  ['antigravity-3.5-flash', { in: 1.5, out: 9, cr: 0.15, cw5: 1.875, cw1: 3.0 }],
  ['gemini-3.5-flash', { in: 1.5, out: 9, cr: 0.15, cw5: 1.875, cw1: 3.0 }],
  ['antigravity-3.1-pro', { in: 2, out: 12, cr: 0.20, cw5: 2.50, cw1: 4.0 }],
  ['gemini-3.1-pro', { in: 2, out: 12, cr: 0.20, cw5: 2.50, cw1: 4.0 }],
  ['cursor-opus', { in: 5, out: 25, cr: 0.50, cw5: 6.25, cw1: 10 }],
  ['cursor-sonnet', { in: 3, out: 15, cr: 0.30, cw5: 3.75, cw1: 6 }],
  ['cursor-haiku', { in: 1, out: 5, cr: 0.10, cw5: 1.25, cw1: 2 }],
  ['cursor-small', { in: 0.1, out: 0.5, cr: 0.01, cw5: 0.125, cw1: 0.2 }],
];
function priceFor(name) {
  for (const [prefix, p] of PRICING) if (name.startsWith(prefix)) return p;
  return null;
}
function mRaw(m) { return (m.input || 0) + (m.output || 0) + (m.cache_reads || 0) + (m.cache_writes_total || 0); }
function mWeighted(m) {
  const a = m.cache_writes_5m || 0, b = m.cache_writes_1h || 0;
  const w = (a || b) ? a * 1.25 + b * 2 : (m.cache_writes_total || 0) * 1.25;
  return Math.round((m.input || 0) + (m.output || 0) * 5 + (m.cache_reads || 0) * 0.1 + w);
}
// real (weighted) cost: cache reads/writes billed at their discounted/premium rates
function mUsd(name, m) {
  const p = priceFor(name);
  if (!p) return 0;
  const a = m.cache_writes_5m || 0, b = m.cache_writes_1h || 0;
  const wu = (a || b) ? a * p.cw5 + b * p.cw1 : (m.cache_writes_total || 0) * p.cw5;
  return ((m.input || 0) * p.in + (m.output || 0) * p.out + (m.cache_reads || 0) * p.cr + wu) / 1e6;
}
// raw cost: every cache token billed at full input price (i.e. as if no caching)
function mUsdRaw(name, m) {
  const p = priceFor(name);
  if (!p) return 0;
  const cacheAll = (m.cache_reads || 0) + (m.cache_writes_total || 0);
  return ((m.input || 0) * p.in + (m.output || 0) * p.out + cacheAll * p.in) / 1e6;
}
const shortModel = n => n.replace(/^(claude|gemini|antigravity|cursor)-/, '').replace(/-\d{8}$/, '').replace(/-\d{8}T.*$/, '');

// systemd user services run with a minimal PATH that omits ~/.local/bin and
// other common install dirs, so `rtk` (a binary on PATH) goes unfound and its
// card silently reads 0. Augment PATH so tools resolve regardless of launcher.
const EXEC_PATH = [
  path.join(HOME, '.local', 'bin'),
  path.join(HOME, 'bin'),
  '/usr/local/bin', '/usr/bin', '/bin',
  process.env.PATH || '',
].filter(Boolean).join(':');

function execPromise(cmd, extraEnv = {}) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 10000, env: { ...process.env, PATH: EXEC_PATH, ...extraEnv } }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

function readFile(filePath) {
  return new Promise((resolve) => {
    fs.readFile(filePath, 'utf8', (err, data) => resolve(err ? null : data));
  });
}

// RTK stores its history.db under $XDG_DATA_HOME/rtk. Different launchers set
// XDG_DATA_HOME differently — notably Claude Code in a VSCode *snap* points it
// at ~/snap/code/<rev>/.local/share, while a plain systemd service has none and
// falls back to ~/.local/share. That mismatch makes the dashboard read an empty
// DB ("RTK reset to 0"). Resolve the *live* DB by scanning candidate share dirs
// and picking the rtk/history.db with the newest mtime. Override with RTK_DATA_HOME.
function listSnapShareDirs() {
  const dirs = [];
  const snapCode = path.join(HOME, 'snap', 'code');
  try {
    for (const rev of fs.readdirSync(snapCode)) {
      dirs.push(path.join(snapCode, rev, '.local', 'share'));
    }
  } catch { }
  return dirs;
}

// Every distinct share dir that actually holds an rtk/history.db, deduped by the
// real DB path (so an XDG_DATA_HOME pointing at one of the snap dirs isn't counted
// twice). RTK_DATA_HOME forces a single location.
function rtkDataHomes() {
  if (process.env.RTK_DATA_HOME) return [process.env.RTK_DATA_HOME];
  const candidates = [
    process.env.XDG_DATA_HOME,
    path.join(HOME, '.local', 'share'),
    ...listSnapShareDirs(),
  ].filter(Boolean);

  const seen = new Set(), homes = [];
  for (const share of candidates) {
    try {
      const real = fs.realpathSync(path.join(share, 'rtk', 'history.db'));
      if (!seen.has(real)) { seen.add(real); homes.push(share); }
    } catch { }
  }
  return homes;
}

// Sum summaries and merge per-period breakdowns across multiple RTK databases.
function mergeRTK(list) {
  const sum = { total_commands: 0, total_input: 0, total_output: 0, total_saved: 0, total_time_ms: 0 };
  const byKey = { daily: new Map(), weekly: new Map(), monthly: new Map() };
  const keyOf = { daily: r => r.date, weekly: r => r.week_start, monthly: r => r.month };

  for (const g of list) {
    const s = g.summary || {};
    sum.total_commands += s.total_commands || 0;
    sum.total_input += s.total_input || 0;
    sum.total_output += s.total_output || 0;
    sum.total_saved += s.total_saved || 0;
    sum.total_time_ms += s.total_time_ms || 0;
    for (const period of ['daily', 'weekly', 'monthly']) {
      for (const r of g[period] || []) {
        const k = keyOf[period](r);
        const m = byKey[period];
        const cur = m.get(k) || { ...r, commands: 0, input_tokens: 0, output_tokens: 0, saved_tokens: 0, total_time_ms: 0 };
        cur.commands += r.commands || 0;
        cur.input_tokens += r.input_tokens || 0;
        cur.output_tokens += r.output_tokens || 0;
        cur.saved_tokens += r.saved_tokens || 0;
        cur.total_time_ms += r.total_time_ms || 0;
        m.set(k, cur);
      }
    }
  }

  const pct = (saved, input) => input ? (saved / input) * 100 : 0;
  const finalizePeriod = (m, dateKey) => [...m.values()]
    .map(r => ({
      ...r, savings_pct: pct(r.saved_tokens, r.input_tokens),
      avg_time_ms: r.commands ? Math.round(r.total_time_ms / r.commands) : 0
    }))
    .sort((a, b) => String(a[dateKey]).localeCompare(String(b[dateKey])));

  return {
    summary: {
      ...sum,
      avg_savings_pct: pct(sum.total_saved, sum.total_input),
      avg_time_ms: sum.total_commands ? Math.round(sum.total_time_ms / sum.total_commands) : 0,
    },
    daily: finalizePeriod(byKey.daily, 'date'),
    weekly: finalizePeriod(byKey.weekly, 'week_start'),
    monthly: finalizePeriod(byKey.monthly, 'month'),
    sources: list.length,
  };
}

function parseRtkVal(str) {
  str = str.trim().toUpperCase();
  if (str.endsWith('K')) return parseFloat(str) * 1000;
  if (str.endsWith('M')) return parseFloat(str) * 1000000;
  if (str.endsWith('B')) return parseFloat(str) * 1000000000;
  return parseFloat(str) || 0;
}

function parseTextRTK(text) {
  const lines = text.split('\n');
  const summary = { total_commands: 0, total_input: 0, total_output: 0, total_saved: 0, total_time_ms: 0, avg_savings_pct: 0, avg_time_ms: 0 };
  const daily = [];
  const weekly = [];
  const monthly = [];

  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('D Daily Breakdown')) {
      currentSection = 'daily';
      continue;
    } else if (trimmed.startsWith('W Weekly Breakdown')) {
      currentSection = 'weekly';
      continue;
    } else if (trimmed.startsWith('M Monthly Breakdown')) {
      currentSection = 'monthly';
      continue;
    }

    if (trimmed.startsWith('Date') || trimmed.startsWith('Week') || trimmed.startsWith('Month') || trimmed.startsWith('──') || trimmed.startsWith('══')) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 7) continue;

    const key = parts[0];
    if (key === 'TOTAL') {
      if (currentSection === 'daily') {
        summary.total_commands = parseInt(parts[1]) || 0;
        summary.total_input = parseRtkVal(parts[2]);
        summary.total_output = parseRtkVal(parts[3]);
        summary.total_saved = parseRtkVal(parts[4]);
        summary.avg_savings_pct = parseFloat(parts[5]) || 0;
        summary.total_time_ms = (parseInt(parts[1]) || 0) * (parseInt(parts[6]) || 0);
        summary.avg_time_ms = parseInt(parts[6]) || 0;
      }
      continue;
    }

    let keyEndIdx = 0;
    if (trimmed.includes('→')) {
      const arrowIdx = parts.indexOf('→');
      if (arrowIdx !== -1) {
        keyEndIdx = arrowIdx + 1;
      }
    }

    const name = parts.slice(0, keyEndIdx + 1).join(' ');
    const rest = parts.slice(keyEndIdx + 1);

    if (rest.length < 6) continue;

    const cmds = parseInt(rest[0]) || 0;
    const input = parseRtkVal(rest[1]);
    const output = parseRtkVal(rest[2]);
    const saved = parseRtkVal(rest[3]);
    const pct = parseFloat(rest[4]) || 0;
    const time = parseInt(rest[5]) || 0;

    const row = {
      commands: cmds,
      input_tokens: input,
      output_tokens: output,
      saved_tokens: saved,
      savings_pct: pct,
      total_time_ms: cmds * time,
      avg_time_ms: time
    };

    if (currentSection === 'daily') {
      row.date = name;
      daily.push(row);
    } else if (currentSection === 'weekly') {
      row.week_start = name.split(' ')[0];
      row.week_end = name.split(' ').pop();
      weekly.push(row);
    } else if (currentSection === 'monthly') {
      row.month = name;
      monthly.push(row);
    }
  }

  return { summary, daily, weekly, monthly };
}

async function collectRTK() {
  const homes = rtkDataHomes();
  // No DB found in any candidate → let rtk pick its own default.
  const envs = homes.length ? homes.map(h => ({ XDG_DATA_HOME: h })) : [{}];

  const results = (await Promise.all(
    envs.map(env => execPromise('rtk gain -g -a', env).then(o => {
      if (!o) return null;
      try {
        return JSON.parse(o);
      } catch {
        return parseTextRTK(o);
      }
    }))
  )).filter(Boolean);

  if (!results.length) return { error: 'no data' };
  return results.length === 1 ? results[0] : mergeRTK(results);
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
      } catch { }
    }
  }

  const sessions = [...latest.values()];
  let totalOutputTokens = 0, totalSavedTokens = 0, totalSavedUsd = 0;
  for (const e of sessions) {
    totalOutputTokens += e.output_tokens || 0;
    totalSavedTokens += e.est_saved_tokens || 0;
    totalSavedUsd += e.est_saved_usd || 0;
  }

  return {
    mode, session_count: sessions.length, total_output_tokens: totalOutputTokens,
    total_saved_tokens: totalSavedTokens, total_saved_usd: totalSavedUsd, sessions
  };
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
  console.log(`Tokenomics → http://localhost:${PORT}`);
});
