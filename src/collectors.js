const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');
const { settings } = require('./settings');
const { collectVersion } = require('./version');

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

// Detect whether the `rtk` CLI is installed/on PATH. `rtk --version` prints
// "rtk X.Y.Z"; a null result means the binary isn't found (or errored), so the
// card shows a "not installed" pill instead of a phantom "installed".
async function probeRtkInstalled() {
  const out = await execPromise('rtk --version');
  if (!out) return { installed: false };
  const m = String(out).match(/(\d+\.\d+\.\d+\S*)/);
  return { installed: true, version: m ? m[1] : null };
}

async function collectRTK() {
  const homes = rtkDataHomes();
  const envs = homes.length ? homes.map(h => ({ XDG_DATA_HOME: h })) : [{}];

  const [results, install] = await Promise.all([
    Promise.all(
      envs.map(env => execPromise('rtk gain -g -a', env).then(o => {
        if (!o) return null;
        try {
          return JSON.parse(o);
        } catch {
          return parseTextRTK(o);
        }
      }))
    ).then(r => r.filter(Boolean)),
    probeRtkInstalled(),
  ]);

  const base = results.length
    ? (results.length === 1 ? results[0] : mergeRTK(results))
    : { error: 'no data' };
  return { ...base, install };
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

// Headroom keeps TWO files (see its filesystem-contract):
//   proxy_savings.json      → authoritative savings ledger (what `headroom
//                             perf` reports: lifetime.tokens_saved / USD).
//   subscription_state.json → quota windows (latest.*) + raw window-token
//                             telemetry (window_tokens.*). NOT savings — its
//                             window_tokens reset every quota window, so it
//                             must never be treated as a cumulative saving.
// We read both and return the subscription object (so the Claude quota card +
// telemetry keep working) with the savings ledger attached as `.savings`.
function headroomSubPath() {
  return settings.HEADROOM_SUBSCRIPTION_STATE_PATH || path.join(HOME, '.headroom', 'subscription_state.json');
}
function headroomSavingsPath() {
  return settings.HEADROOM_SAVINGS_PATH || path.join(HOME, '.headroom', 'proxy_savings.json');
}

function headroomHealthUrl() {
  return settings.HEADROOM_HEALTH_URL !== undefined
    ? settings.HEADROOM_HEALTH_URL
    : 'http://127.0.0.1:8787/health';
}

// Probe the Headroom proxy's /health endpoint to show a live up/down pill on
// the card. ECONNREFUSED = proxy not running; a non-2xx or unhealthy body =
// running but degraded. Empty URL disables the probe (returns null).
async function probeHeadroomHealth() {
  const url = headroomHealthUrl();
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, reachable: true, http_status: res.status, error: `HTTP ${res.status}` };
    }
    const healthy = body ? (body.status === 'healthy' && body.ready !== false) : true;
    return {
      ok: healthy,
      reachable: true,
      http_status: res.status,
      status: body && body.status,
      version: body && body.version,
      uptime_seconds: body && body.uptime_seconds,
      error: healthy ? null : ((body && body.status) || 'unhealthy'),
    };
  } catch (e) {
    const code = (e.cause && e.cause.code) || '';
    const refused = /ECONNREFUSED|ECONNRESET/i.test(code) || /refused/i.test(e.message || '');
    const reason = e.name === 'AbortError' ? 'timeout'
      : refused ? 'not running' : (code || e.message || 'unreachable');
    return { ok: false, reachable: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

async function collectHeadroom() {
  const [subRaw, savRaw, health] = await Promise.all([
    readFile(headroomSubPath()),
    readFile(headroomSavingsPath()),
    probeHeadroomHealth(),
  ]);
  const parse = (raw) => { if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } };
  const sub = parse(subRaw);
  const savings = parse(savRaw);
  const base = sub || { error: 'no data' };
  return { ...base, savings, health };
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
  const sav = headroom && headroom.savings;
  const candidate = maxIso(
    (headroom && !headroom.error)
      ? (headroom.last_active_at || (headroom.latest && headroom.latest.polled_at))
      : null,
    sav && sav.display_session && sav.display_session.last_activity_at,
  );
  return maxIso(candidate, fileMtimeISO(headroomSubPath()), fileMtimeISO(headroomSavingsPath()));
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

// ---- Activity feed: per-operation before→after token records ----
// Three sources expose granular per-op token data. NB: no tool persists the
// actual prompt/response TEXT — only token counts + labels:
//   RTK history.db `commands`     → original_cmd, input→output tokens per command
//   Headroom session_stats.jsonl  → per MCP-compress event input→output tokens
//   Headroom logs/proxy.log PERF  → per proxied request tok_before→tok_after
// Served lazily via /api/activity (NOT the 10s SSE loop): proxy.log is large and
// growing, so we only read its tail.

function headroomSessionStatsPath() {
  return settings.HEADROOM_SESSION_STATS_PATH || process.env.HEADROOM_SESSION_STATS_PATH
    || path.join(HOME, '.headroom', 'session_stats.jsonl');
}
function headroomProxyLogPath() {
  return settings.HEADROOM_PROXY_LOG_PATH || process.env.HEADROOM_PROXY_LOG_PATH
    || path.join(HOME, '.headroom', 'logs', 'proxy.log');
}

// Read the last `maxBytes` of a (possibly large, growing) text file. Returns ''
// on any error. Drops the first (likely partial) line when the file was longer
// than maxBytes, so callers never parse a half-line.
function tailFileSync(filePath, maxBytes = 65536) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return '';
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, start);
    let text = buf.toString('utf8');
    if (start > 0) { const nl = text.indexOf('\n'); if (nl !== -1) text = text.slice(nl + 1); }
    return text;
  } catch { return ''; }
  finally { if (fd !== null) try { fs.closeSync(fd); } catch { } }
}

function matchNum(s, re) { const m = re.exec(s); return m ? Number(m[1]) : null; }

// One Headroom proxy.log "PERF" line → {model, before, after, saved, ts} or null.
// Example: "2026-06-19 14:29:19,130 - headroom.proxy - INFO - [hr_…] PERF
//           model=claude-opus-4-8 msgs=2 tok_before=6490 tok_after=1490 tok_saved=5000 …"
function parseProxyPerfLine(line) {
  if (!line || line.indexOf(' PERF ') === -1) return null;
  const before = matchNum(line, /tok_before=(\d+)/);
  const after = matchNum(line, /tok_after=(\d+)/);
  if (before === null || after === null) return null;
  const saved = matchNum(line, /tok_saved=(-?\d+)/);
  const model = (/model=(\S+)/.exec(line) || [])[1] || 'request';
  const tsM = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})[.,](\d+)/.exec(line);
  let ts = null;
  if (tsM) { const t = Date.parse(`${tsM[1]}T${tsM[2]}.${tsM[3]}`); if (!Number.isNaN(t)) ts = t; }
  return {
    model,
    before, after,
    saved: saved === null ? Math.max(0, before - after) : saved,
    ts,
    // per-request metadata — the closest we can get to "what was this request",
    // since the body itself is proxied passthrough and never stored.
    requestId: (/\[(hr_\S+?)\]/.exec(line) || [])[1] || null,
    msgs: matchNum(line, /\bmsgs=(\d+)/),
    cacheRead: matchNum(line, /\bcache_read=(\d+)/),
    cacheWrite: matchNum(line, /\bcache_write=(\d+)/),
    cacheHitPct: matchNum(line, /cache_hit_pct=(\d+)/),
    transforms: (/transforms=(\S+)/.exec(line) || [])[1] || null,
    client: (/client=(\S+)/.exec(line) || [])[1] || null,
  };
}

// One Headroom session_stats.jsonl line → compress event or null (skips
// `retrieve` and any non-compress entries). timestamp is unix seconds → ms.
function parseSessionStatLine(line) {
  const s = line && line.trim();
  if (!s) return null;
  let e; try { e = JSON.parse(s); } catch { return null; }
  if (!e || e.type !== 'compress') return null;
  const before = Number(e.input_tokens) || 0;
  const after = Number(e.output_tokens) || 0;
  return {
    before, after,
    saved: Math.max(0, before - after),
    savedPct: typeof e.savings_percent === 'number' ? e.savings_percent : null,
    strategy: e.strategy || 'compress',
    ts: typeof e.timestamp === 'number' ? Math.round(e.timestamp * 1000) : null,
  };
}

// Newest `limit` rows from every active RTK history.db, read straight from
// SQLite (the CLI only exposes aggregates). Returns [] when sqlite/DB missing.
function readRtkActivity(limit) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return []; }
  const rows = [];
  for (const home of rtkDataHomes()) {
    const dbPath = path.join(home, 'rtk', 'history.db');
    try {
      if (!fs.existsSync(dbPath)) continue;
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const r = db.prepare(
        'SELECT timestamp, original_cmd, rtk_cmd, input_tokens, output_tokens, saved_tokens, savings_pct, exec_time_ms '
        + 'FROM commands ORDER BY id DESC LIMIT ?'
      ).all(limit);
      db.close();
      for (const row of r) rows.push(row);
    } catch { }
  }
  return rows;
}

function clampLimit(n, def = 50, max = 200) {
  n = Number(n);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(max, Math.round(n)));
}

function truncLabel(s, n = 80) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return null;
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

// Merge the three sources into one normalized, newest-first activity feed. Each
// row: { source, ts, label, detail, before, after, saved, pct }.
async function collectActivity({ limit = 50 } = {}) {
  limit = clampLimit(limit);
  const out = [];

  // RTK — per-command original→rtk rewrite + input→output tokens
  for (const r of readRtkActivity(limit)) {
    const before = Number(r.input_tokens) || 0;
    const after = Number(r.output_tokens) || 0;
    const saved = Number(r.saved_tokens);
    const ts = r.timestamp ? Date.parse(r.timestamp) : NaN;
    const info = [];
    if (r.rtk_cmd && r.rtk_cmd !== r.original_cmd) info.push(['rewritten', r.rtk_cmd]);
    if (typeof r.savings_pct === 'number') info.push(['savings', Math.round(r.savings_pct) + '%']);
    if (Number.isFinite(Number(r.exec_time_ms))) info.push(['exec time', Number(r.exec_time_ms) + ' ms']);
    out.push({
      source: 'rtk',
      ts: Number.isNaN(ts) ? null : ts,
      label: truncLabel(r.original_cmd || r.rtk_cmd || 'rtk command'),
      detail: r.rtk_cmd || null,
      before, after,
      saved: Number.isFinite(saved) ? saved : Math.max(0, before - after),
      pct: typeof r.savings_pct === 'number' ? r.savings_pct : (before ? ((before - after) / before) * 100 : 0),
      info,
    });
  }

  // Headroom MCP compress events (tail of session_stats.jsonl)
  const statRaw = tailFileSync(headroomSessionStatsPath());
  const compressEvents = [];
  for (const line of statRaw ? statRaw.split('\n') : []) {
    const e = parseSessionStatLine(line);
    if (e) compressEvents.push(e);
  }
  for (const e of compressEvents.slice(-limit)) {
    out.push({
      source: 'headroom-compress',
      ts: e.ts,
      label: truncLabel(e.strategy),
      detail: null,
      before: e.before, after: e.after, saved: e.saved,
      pct: e.savedPct != null ? e.savedPct : (e.before ? (e.saved / e.before) * 100 : 0),
      info: [['strategy', e.strategy]],
    });
  }

  // Headroom proxy requests — PERF lines from the tail of proxy.log. We also map
  // request_id → body_bytes from the sibling `outbound_request` lines, so each
  // row can show the request's wire size (the body itself is never stored).
  const logRaw = tailFileSync(headroomProxyLogPath());
  const logLines = logRaw ? logRaw.split('\n') : [];
  const bodyBytesById = {};
  for (const line of logLines) {
    if (line.indexOf('event=outbound_request') === -1) continue;
    const id = (/request_id=(hr_\S+)/.exec(line) || [])[1];
    const bb = matchNum(line, /body_bytes=(\d+)/);
    if (id && bb !== null) bodyBytesById[id] = bb;
  }
  const perfEvents = [];
  for (const line of logLines) {
    const e = parseProxyPerfLine(line);
    if (e) perfEvents.push(e);
  }
  for (const e of perfEvents.slice(-limit)) {
    // Per-instant usage: each request resends the whole (growing) conversation as
    // context, so tok_before looks cumulative. We want the tokens actually
    // *processed* this turn (not served from cache). Two imperfect signals exist
    // in the log, on different bases, so we take whichever is positive:
    //   - uncached remainder: tok_before - cache_read (the context not cache-read)
    //   - new cache writes:   cache_write (new tokens cached this turn)
    // Neither alone suffices: cache_read can exceed tok_before (it also counts
    // system/tools), zeroing the remainder, while cache_write is 0 on turns whose
    // new input went uncached. cache_hit_pct is integer-rounded so it reads a
    // spurious 0 at 100% — never derive fresh from it. The exact uncached-input
    // count is NOT in the log, so this is a best estimate; it only reads ~0 for a
    // genuine no-op resend (nothing new read-uncached and nothing newly cached).
    const ctx = e.before;                               // full context resent this turn
    const cw = Number.isFinite(e.cacheWrite) ? e.cacheWrite : 0;
    const cr = Number.isFinite(e.cacheRead) ? e.cacheRead : 0;
    const fresh = Math.min(ctx, Math.max(ctx - cr, cw)); // new tokens processed this instant
    const cacheSaved = ctx - fresh;                     // ≈ tokens the cache served this turn
    const info = [];
    if (e.msgs != null) info.push(['messages', String(e.msgs)]);
    info.push(['context resent', String(ctx)]);
    info.push(['fresh processed', String(fresh)]);
    if (e.cacheHitPct != null) info.push(['cache hit', e.cacheHitPct + '%']);
    // genuine per-turn reduction by Headroom's transforms (tok_before → tok_after)
    if (Number.isFinite(e.after) && e.after < ctx) info.push(['optimized', `${e.after} (−${ctx - e.after})`]);
    if (e.transforms) info.push(['transform', e.transforms]);
    if (e.client) info.push(['client', e.client]);
    if (e.requestId && bodyBytesById[e.requestId] != null) info.push(['request size', fmtBytes(bodyBytesById[e.requestId])]);
    if (e.requestId) info.push(['request id', e.requestId]);
    out.push({
      source: 'headroom-proxy',
      ts: e.ts,
      label: truncLabel(e.model),
      detail: null,
      before: ctx,        // context resent (mostly cached)
      after: fresh,       // tokens actually processed this instant
      saved: cacheSaved,  // served from cache this turn
      pct: ctx ? (cacheSaved / ctx) * 100 : 0,
      info,
    });
  }

  // newest first; rows without a ts sink to the bottom but stay visible
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out.slice(0, limit);
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
    visibility, last_used: lastUsed, version: collectVersion(),
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
  collectStats,
  collectActivity,
  parseProxyPerfLine,
  parseSessionStatLine,
};
