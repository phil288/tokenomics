const { execFile } = require('child_process');
const { settings } = require('./settings');
const { EXEC_PATH } = require('./collector-utils');

// ---- Claude plan usage (`claude /usage`) ----
// Claude Code's own `/usage` slash command is the source of truth for the
// account's quota windows. Unlike agy, it renders fine in print mode
// (`claude -p "/usage"`) — no PTY driver needed — but a call costs ~11s, which
// is longer than the 10s SSE refresh. So it runs on its own slow timer
// (pollClaude) and collectStats() just reads the cache, exactly like the
// Antigravity poller.
//
// This replaced Headroom's subscription_state poll as the quota source: the
// numbers now come from Claude itself rather than from a proxy's mirror of
// them. Headroom is still read for savings + window telemetry, but its
// `latest.*` quota windows no longer feed the Claude card.

const CLAUDE_TIMEOUT_MS = 60000;

let claudeCache = { stale: true };  // last good (or empty) result
let claudePolling = false;          // re-entry guard

// "Current week (all models)" -> seven_day; "Current week (Fable)" ->
// seven_day_fable; "Current session" -> five_hour. Keys match the shape the
// card already renders (see cards-claude.js), so the model-window discovery,
// pacing and history snapshots keep working unchanged.
function windowKey(label) {
  const s = label.trim().toLowerCase();
  if (/^current session/.test(s)) return 'five_hour';
  const m = s.match(/^current week\s*\((.+)\)$/);
  if (!m) return null;
  const scope = m[1].trim();
  if (/^all models$/.test(scope)) return 'seven_day';
  return 'seven_day_' + scope.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Offset (in minutes) of `tz` from UTC at the given instant. Uses Intl rather
// than a tz database so we stay zero-dependency: format the instant in the
// target zone, read it back as if it were UTC, and diff.
function tzOffsetMinutes(tz, atMs) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    for (const { type, value } of dtf.formatToParts(new Date(atMs))) p[type] = value;
    const asUTC = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour) % 24, Number(p.minute), Number(p.second),
    );
    return (asUTC - Math.floor(atMs / 1000) * 1000) / 60000;
  } catch {
    return null;
  }
}

// "Aug 26, 10:59pm (Europe/Paris)" -> ISO string.
//
// Two traps: the year is absent (so a December->January reset would resolve
// into the past — we roll forward a year when the naive result is well behind
// now), and the time is wall-clock in the printed zone, not local or UTC.
// We resolve the zone offset at the target instant so DST is handled, then
// re-resolve once because the offset itself can shift across the boundary.
function parseResetAt(text, now = Date.now()) {
  const m = String(text).match(
    /([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?/i,
  );
  if (!m) return null;
  const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (mon === undefined) return null;
  const day = Number(m[2]);
  let hour = Number(m[3]);
  const min = m[4] ? Number(m[4]) : 0;
  const ap = m[5] ? m[5].toLowerCase() : null;
  if (ap === 'pm' && hour < 12) hour += 12;
  if (ap === 'am' && hour === 12) hour = 0;
  const tz = m[6] ? m[6].trim() : null;

  const year = new Date(now).getUTCFullYear();
  const build = (y) => {
    let ms = Date.UTC(y, mon, day, hour, min, 0);
    if (tz) {
      // resolve twice: the offset at the naive instant may differ from the
      // offset at the corrected one (DST boundary).
      for (let i = 0; i < 2; i++) {
        const off = tzOffsetMinutes(tz, ms);
        if (off == null) return null;
        const next = Date.UTC(y, mon, day, hour, min, 0) - off * 60000;
        if (next === ms) break;
        ms = next;
      }
    }
    return ms;
  };

  let ms = build(year);
  if (ms == null) return null;
  // No year in the source: if this lands far in the past, it's next year's.
  if (ms < now - 30 * 24 * 3600 * 1000) {
    const rolled = build(year + 1);
    if (rolled != null) ms = rolled;
  }
  return new Date(ms).toISOString();
}

// Parse the `claude /usage` print-mode output into the quota shape the Claude
// card consumes: { latest: { five_hour: {...}, seven_day: {...}, ... } }.
//
// Only the quota lines are used. The "What's contributing to your limits
// usage?" block below them (request/session counts, parallel + subagent
// percentages) is deliberately ignored — the card renders quota bars only.
function parseClaudeUsage(raw, now = Date.now()) {
  const text = String(raw)
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  const latest = {};
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    // "Current week (all models): 49% used · resets Aug 26, 10:59pm (Europe/Paris)"
    const m = s.match(/^(Current\s+(?:session|week[^:]*)):\s*([\d.]+)%\s*used\b(.*)$/i);
    if (!m) continue;
    const key = windowKey(m[1]);
    if (!key) continue;
    const rest = m[3] || '';
    const resetMatch = rest.match(/resets?\s+(.+?)\s*$/i);
    const win = { utilization_pct: parseFloat(m[2]) };
    if (resetMatch) {
      const iso = parseResetAt(resetMatch[1], now);
      if (iso) win.resets_at = iso;
    }
    latest[key] = win;
  }
  if (!Object.keys(latest).length) return { error: 'no quota lines in claude /usage output' };
  return { latest };
}

function runClaudeUsage() {
  return new Promise((resolve) => {
    execFile('claude', ['-p', '/usage'], {
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PATH: EXEC_PATH },
    }, (err, stdout) => resolve(stdout || null));
  });
}

async function pollClaude() {
  if (settings.CLAUDE_ENABLED === false) {
    claudeCache = { disabled: true };
    return;
  }
  if (claudePolling) return;
  claudePolling = true;
  try {
    const raw = await runClaudeUsage();
    const parsed = raw ? parseClaudeUsage(raw) : { error: 'no output from claude CLI' };
    if (parsed.error) {
      // keep the last good value, just flag it
      claudeCache = { ...claudeCache, disabled: false, stale: true, error: parsed.error };
    } else {
      claudeCache = { ...parsed, polled_at: new Date().toISOString(), stale: false };
    }
  } catch (e) {
    claudeCache = { ...claudeCache, disabled: false, stale: true, error: e.message };
  } finally {
    claudePolling = false;
  }
}

function getClaudeCache() { return claudeCache; }

module.exports = { pollClaude, parseClaudeUsage, parseResetAt, getClaudeCache };
