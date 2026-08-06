const path = require('path');
const { spawn } = require('child_process');
const { settings } = require('./settings');
const { EXEC_PATH } = require('./collector-utils');

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
    // any "<label> Limit" / "<label> Limit Remaining" header opens a new limit
    // section (e.g. "Weekly Limit", "Weekly Limit Remaining"). Anchored + capital
    // "Limit" so the descriptive footer ("…share a weekly limit.") doesn't match.
    // agy ≥1.1.10 renamed "Weekly Limit" → "Weekly Limit Remaining".
    if (g && (m = s.match(/^(.+?)\s+Limit(?:\s+Remaining)?$/))) {
      cur = { label: m[1].trim(), remainingPct: null, refresh: null, full: false };
      g.limits.push(cur); continue;
    }
    if (g && cur) {
      // gauge line: "[████…] 72.42%" — anchored on the bar bracket so the
      // "72% remaining" / "79% remaining · Refreshes in …" status line below
      // doesn't clobber the precise value.
      if ((m = s.match(/\]\s*([\d.]+)%/))) { cur.remainingPct = parseFloat(m[1]); continue; }
      if (/Quota available/i.test(s)) { cur.full = true; cur = null; continue; }
      // refresh may be its own line ("Refreshes in 3d 4h") or trailing a status
      // line ("79% remaining · Refreshes in 142h 43m").
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

function getAntigravityCache() { return antigravityCache; }

module.exports = { pollAntigravity, parseAgyUsage, getAntigravityCache };
