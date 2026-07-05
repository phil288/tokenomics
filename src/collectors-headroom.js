const path = require('path');
const { settings } = require('./settings');
const { accumulateWindowTelemetry } = require('./headroom-telemetry');
const { HOME, configuredHomes, readFile, fileMtimeISO, maxIso } = require('./collector-utils');

// Headroom keeps TWO files (see its filesystem-contract):
//   proxy_savings.json      → authoritative savings ledger (what `headroom
//                             perf` reports: lifetime.tokens_saved / USD).
//   subscription_state.json → quota windows (latest.*) + raw window-token
//                             telemetry (window_tokens.*). NOT savings — its
//                             window_tokens reset every quota window, so it
//                             must never be treated as a cumulative saving.
// We read both and return the subscription object (so the Claude quota card +
// telemetry keep working) with the savings ledger attached as `.savings`.
function headroomSubPath(home = HOME) {
  return settings.HEADROOM_SUBSCRIPTION_STATE_PATH || process.env.HEADROOM_SUBSCRIPTION_STATE_PATH
    || path.join(home, '.headroom', 'subscription_state.json');
}
function headroomSavingsPath(home = HOME) {
  return settings.HEADROOM_SAVINGS_PATH || process.env.HEADROOM_SAVINGS_PATH
    || path.join(home, '.headroom', 'proxy_savings.json');
}

async function collectHeadroomForHome(home) {
  const parse = (raw) => { if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } };
  const [subRaw, savRaw] = await Promise.all([
    readFile(headroomSubPath(home)),
    readFile(headroomSavingsPath(home)),
  ]);
  const sub = parse(subRaw);
  const sav = parse(savRaw);
  return {
    latest: sub && sub.latest || null,
    last_active_at: sub && sub.last_active_at || null,
    window_tokens: sub && sub.window_tokens || null,
    savings: sav && sav.lifetime ? { lifetime: sav.lifetime } : null,
    has_state: Boolean(sub || sav),
  };
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
  const health = await probeHeadroomHealth();
  const parse = (raw) => { if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } };
  const subs = [];
  const savingsDocs = [];
  const results = await Promise.all(configuredHomes().map(async (home) => {
    const [subRaw, savRaw] = await Promise.all([
      readFile(headroomSubPath(home)),
      readFile(headroomSavingsPath(home)),
    ]);
    return { sub: parse(subRaw), sav: parse(savRaw) };
  }));
  for (const { sub, sav } of results) {
    if (sub) subs.push(sub);
    if (sav) savingsDocs.push(sav);
  }
  const sub = mergeHeadroomSubscriptions(subs);
  let savings = mergeHeadroomSavings(savingsDocs);
  // proxy_savings.json also carries a large per-model `history[]` (5000-cap
  // snapshots, ~MBs) and a `projects` map. Nothing in the stats pipeline reads
  // them, and this object rides every 10s SSE frame — strip them here. The
  // history is served on demand via /api/analysis/headroom/models instead.
  if (savings) {
    const { history, projects, ...lean } = savings;
    savings = lean;
  }
  const base = sub || { error: 'no data' };
  // Headroom's raw window counters reset when the proxy restarts or a quota
  // window rolls. Display the persisted local accumulator instead so the
  // telemetry survives PC/proxy restarts (usage, not savings — see
  // src/headroom-telemetry.js). Resettable only via the dashboard's own
  // reset flow (baseline offset).
  const windowTokens = accumulateWindowTelemetry(sub ? sub.window_tokens : null);
  return { ...base, window_tokens: windowTokens, savings, health };
}

function addNums(target, source, keys) {
  for (const key of keys) target[key] = (Number(target[key]) || 0) + (Number(source && source[key]) || 0);
}

function newestByIso(items, pick) {
  let best = null, bestTime = null;
  for (const item of items) {
    const value = pick(item);
    const time = value ? Date.parse(value) : NaN;
    if (!Number.isNaN(time) && (bestTime === null || time > bestTime)) {
      best = item;
      bestTime = time;
    }
  }
  return best;
}

function mergeHeadroomSubscriptions(list) {
  if (!list.length) return null;
  if (list.length === 1) return { ...list[0], sources: 1 };
  const latestSource = newestByIso(list, s => s.last_active_at || (s.latest && s.latest.polled_at)) || list[0];
  const out = { ...latestSource, sources: list.length };
  out.window_tokens = {};
  for (const s of list) {
    addNums(out.window_tokens, s.window_tokens || {}, [
      'input', 'output', 'input_tokens', 'output_tokens', 'cache_creation_input_tokens',
      'cache_read_input_tokens', 'cache_reads', 'cache_writes_5m', 'cache_writes_1h',
      'cache_writes_total', 'total_raw', 'weighted_token_equivalent',
      'cache_reads', 'cache_writes', 'requests'
    ]);
    for (const [model, row] of Object.entries((s.window_tokens && s.window_tokens.by_model) || {})) {
      out.window_tokens.by_model ||= {};
      out.window_tokens.by_model[model] ||= {};
      addNums(out.window_tokens.by_model[model], row, [
        'input', 'output', 'cache_reads', 'cache_writes_5m',
        'cache_writes_1h', 'cache_writes_total', 'total_raw',
        'weighted_token_equivalent'
      ]);
    }
  }
  return out;
}

function mergeHeadroomSavings(list) {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const out = { sources: list.length, lifetime: {} };
  for (const doc of list) {
    addNums(out.lifetime, doc.lifetime || {}, [
      'tokens_saved', 'compression_savings_usd', 'requests',
      'total_input_tokens', 'total_input_cost_usd'
    ]);
  }
  const latestDisplay = newestByIso(list.map(d => d.display_session).filter(Boolean), d => d.last_activity_at);
  if (latestDisplay) out.display_session = latestDisplay;
  return out;
}

function headroomLastUsed(headroom) {
  const sav = headroom && headroom.savings;
  const candidate = maxIso(
    (headroom && !headroom.error)
      ? (headroom.last_active_at || (headroom.latest && headroom.latest.polled_at))
      : null,
    sav && sav.display_session && sav.display_session.last_activity_at,
  );
  const mtimes = [];
  for (const home of configuredHomes()) {
    mtimes.push(fileMtimeISO(headroomSubPath(home)), fileMtimeISO(headroomSavingsPath(home)));
  }
  return maxIso(candidate, ...mtimes);
}

function headroomSessionStatsPath(home = HOME) {
  return settings.HEADROOM_SESSION_STATS_PATH || process.env.HEADROOM_SESSION_STATS_PATH
    || path.join(home, '.headroom', 'session_stats.jsonl');
}

function headroomProxyLogPath(home = HOME) {
  return settings.HEADROOM_PROXY_LOG_PATH || process.env.HEADROOM_PROXY_LOG_PATH
    || path.join(home, '.headroom', 'logs', 'proxy.log');
}

function matchNum(s, re) { const m = re.exec(s); return m ? Number(m[1]) : null; }

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

module.exports = {
  collectHeadroom,
  collectHeadroomForHome,
  headroomSavingsPath,
  headroomSessionStatsPath,
  headroomProxyLogPath,
  headroomLastUsed,
  parseProxyPerfLine,
  parseSessionStatLine,
};
