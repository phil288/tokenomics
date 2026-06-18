const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');
const { settings } = require('./settings');

const HOME = process.env.HOME || os.homedir();
const REFRESH_MS = Number(process.env.REFRESH_MS) || 10000;

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

function rtkDataHomes() {
  const customHome = settings.RTK_DATA_HOME || process.env.RTK_DATA_HOME;
  if (customHome) return [customHome];
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
  const filePath = settings.HEADROOM_SAVINGS_PATH || path.join(HOME, '.headroom', 'subscription_state.json');
  const raw = await readFile(filePath);
  if (!raw) return { error: 'no data' };
  try { return JSON.parse(raw); } catch { return { error: 'parse error' }; }
}

async function collectCursor() {
  if (settings.CURSOR_ENABLED === false) {
    return { disabled: true };
  }
  let token = settings.CURSOR_ACCESS_TOKEN || process.env.CURSOR_ACCESS_TOKEN;

  if (!token) {
    try {
      const dbPath = path.join(HOME, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
      if (fs.existsSync(dbPath)) {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(dbPath);
        const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'").get();
        if (row && row.value) {
          token = row.value;
        }
      }
    } catch (e) {
      console.error('Failed to read Cursor token from DB:', e.message);
    }
  }

  if (!token) return { error: 'no token found' };


  try {
    const res = await fetch('https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    if (res.status !== 200) {
      const errText = await res.text().catch(() => '');
      let msg = `API returned status ${res.status}`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.message) msg = parsed.message;
      } catch {}
      return { error: msg };
    }
    const data = await res.json();
    return data;
  } catch (e) {
    return { error: e.message };
  }
}

// ---- Antigravity (`agy`) usage by model group ----
// `agy` is a bubbletea TUI whose `/usage` panel only renders inside a real
// terminal; src/agy-usage.py drives it over a PTY and prints the raw panel.
// Polling is heavy (~15-20s + spawns the ~171MB agy binary), so it runs on its
// own slow timer (pollAntigravity) and collectStats() just reads the cache.

const AGY_DRIVER = path.join(__dirname, 'agy-usage.py');
const AGY_TIMEOUT_MS = 30000;

let antigravityCache = { stale: true };  // last good (or empty) result
let agyPolling = false;                   // re-entry guard

// Parse the (ANSI-laden) `/usage` panel into structured per-group quota data.
// The gauge percentage is REMAINING quota (100% = "Quota available").
//
// We don't assume which limits exist — agy varies by tier (Starter Quota shows
// only a weekly limit; others may add a 5-hour or other window). Every "<X>
// Limit" header agy prints becomes an entry in the group's `limits` array, so
// the UI renders exactly what agy reports, no more, no less.
function parseAgyUsage(raw) {
  const t = String(raw)
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b[()=>][0-9A-Za-z]?/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  const lines = t.split(/\r?\n/);
  let account = null;
  const groups = [];
  let g = null, cur = null; // cur = limit currently being filled in

  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    let m;
    if ((m = s.match(/^Account:\s*(.+)$/))) { account = m[1].trim(); continue; }
    if ((m = s.match(/^([A-Z][A-Z &]*MODELS)$/))) {
      g = { name: m[1].trim(), models: null, limits: [] };
      groups.push(g); cur = null; continue;
    }
    if ((m = s.match(/^Models within this group:\s*(.+)$/))) { if (g) g.models = m[1].trim(); continue; }
    // any "<label> Limit" header opens a new limit section (e.g. "Weekly Limit",
    // "Five Hour Limit"). Anchored + capital "Limit" so the descriptive footer
    // ("…share a weekly limit.") doesn't match.
    if (g && (m = s.match(/^(.+?)\s+Limit$/))) {
      cur = { label: m[1].trim(), remainingPct: null, refresh: null, full: false };
      g.limits.push(cur); continue;
    }
    if (g && cur) {
      // gauge line: "[████…] 72.42%" — anchored on the bar bracket so the
      // "72% remaining" status line below doesn't clobber the precise value.
      if ((m = s.match(/\]\s*([\d.]+)%/))) { cur.remainingPct = parseFloat(m[1]); continue; }
      if (/Quota available/i.test(s)) { cur.full = true; cur = null; continue; }
      if ((m = s.match(/Refreshes in\s+(.+?)\s*$/))) { cur.refresh = m[1].trim(); cur = null; continue; }
    }
  }

  if (!account && !groups.length) return { error: 'could not parse usage panel' };
  return { account, groups };
}

function runAgyDriver() {
  return new Promise((resolve) => {
    let stdout = '';
    const child = spawn('python3', [AGY_DRIVER], {
      env: { ...process.env, PATH: EXEC_PATH },
    });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } }, AGY_TIMEOUT_MS);
    child.stdout.on('data', d => { stdout += d; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => { clearTimeout(timer); resolve(stdout || null); });
  });
}

async function pollAntigravity() {
  if (settings.ANTIGRAVITY_ENABLED === false) {
    antigravityCache = { disabled: true };
    return;
  }
  if (agyPolling) return;
  agyPolling = true;
  try {
    const raw = await runAgyDriver();
    const parsed = raw ? parseAgyUsage(raw) : { error: 'no output from agy driver' };
    if (parsed.error) {
      // keep the last good value, just flag it
      antigravityCache = { ...antigravityCache, disabled: false, stale: true, error: parsed.error };
    } else {
      antigravityCache = { ...parsed, polled_at: new Date().toISOString(), stale: false };
    }
  } catch (e) {
    antigravityCache = { ...antigravityCache, disabled: false, stale: true, error: e.message };
  } finally {
    agyPolling = false;
  }
}

// ---- "last used" timestamps per tool ----
// RTK: newest row in any active history.db. Caveman/Claude: newest entry in
// their respective JSONL history logs. Returns ISO strings (or null when no data).

function maxRtkLastUsed() {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return null; }

  let max = null;
  for (const home of rtkDataHomes()) {
    const dbPath = path.join(home, 'rtk', 'history.db');
    try {
      if (!fs.existsSync(dbPath)) continue;
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const row = db.prepare('SELECT MAX(timestamp) AS ts FROM commands').get();
      db.close();
      if (row && row.ts) {
        const t = Date.parse(row.ts);
        if (!Number.isNaN(t) && (max === null || t > max)) max = t;
      }
    } catch { }
  }
  return max === null ? null : new Date(max).toISOString();
}

function fileMtimeISO(filePath) {
  try { return fs.statSync(filePath).mtime.toISOString(); } catch { return null; }
}

function maxIso(...isos) {
  let max = null;
  for (const iso of isos) {
    if (!iso) continue;
    const t = Date.parse(iso);
    if (!Number.isNaN(t) && (max === null || t > max)) max = t;
  }
  return max === null ? null : new Date(max).toISOString();
}

async function maxJsonlLastUsed(filePath, tsField) {
  const raw = await readFile(filePath);
  if (!raw) return null;
  let max = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed);
      const ts = e[tsField];
      if (typeof ts === 'number' && (max === null || ts > max)) max = ts;
    } catch { }
  }
  return max === null ? null : new Date(max).toISOString();
}

// Headroom "last used" = last proxied request (last_active_at) or most recent
// quota poll (latest.polled_at); falls back to the state file's mtime, which is
// rewritten on every poll/cache update.
function headroomLastUsed(headroom) {
  const candidate = (headroom && !headroom.error)
    ? (headroom.last_active_at || (headroom.latest && headroom.latest.polled_at))
    : null;
  const statePath = settings.HEADROOM_SAVINGS_PATH || path.join(HOME, '.headroom', 'subscription_state.json');
  return maxIso(candidate, fileMtimeISO(statePath));
}

// Caveman writes its JSONL log only at session end, so it lags during an active
// session. The .caveman-active / statusline files are touched live, so take the
// most recent signal across all three.
async function cavemanLastUsed() {
  const histTs = await maxJsonlLastUsed(path.join(HOME, '.claude', '.caveman-history.jsonl'), 'ts');
  return maxIso(
    histTs,
    fileMtimeISO(path.join(HOME, '.claude', '.caveman-active')),
    fileMtimeISO(path.join(HOME, '.claude', '.caveman-statusline-suffix')),
  );
}

async function collectLastUsed(headroom) {
  const [caveman, claude] = await Promise.all([
    cavemanLastUsed(),
    maxJsonlLastUsed(path.join(HOME, '.claude', 'history.jsonl'), 'timestamp'),
  ]);
  return { rtk: maxRtkLastUsed(), caveman, claude, headroom: headroomLastUsed(headroom) };
}

async function collectStats() {
  const [rtk, caveman, headroom, cursor] = await Promise.all([
    collectRTK(), collectCaveman(), collectHeadroom(), collectCursor()
  ]);
  const lastUsed = await collectLastUsed(headroom);
  const visibility = {
    rtk: settings.RTK_ENABLED !== false,
    caveman: settings.CAVEMAN_ENABLED !== false,
    claude: settings.CLAUDE_ENABLED !== false,
    headroom: settings.HEADROOM_ENABLED !== false,
    cursor: settings.CURSOR_ENABLED !== false,
    antigravity: settings.ANTIGRAVITY_ENABLED !== false,
  };
  return {
    rtk, caveman, headroom, cursor, antigravity: antigravityCache,
    visibility, last_used: lastUsed,
    timestamp: new Date().toISOString(), refresh_ms: REFRESH_MS,
  };
}

module.exports = {
  collectRTK,
  collectCaveman,
  collectHeadroom,
  collectCursor,
  pollAntigravity,
  parseAgyUsage,
  parseTextRTK,
  parseRtkVal,
  collectLastUsed,
  collectStats
};
