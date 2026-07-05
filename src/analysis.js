const fs = require('fs');
const path = require('path');
const {
  rtkDataHomes, tailFileSync, cavemanHistoryPath,
  headroomSavingsPath, headroomSessionStatsPath, headroomProxyLogPath,
  parseProxyPerfLine, parseSessionStatLine,
} = require('./collectors');
const { getBaseline } = require('./baseline');

// ---- On-demand deep-analysis aggregations (/api/analysis/*) ----
// Everything here is EVENT-shaped: rows read straight from the tools' own
// ledgers (RTK SQLite, caveman jsonl, Headroom savings history + log tails).
// None of it runs in the 10s SSE loop — each function executes only when its
// endpoint is hit, and the Analysis view only fetches while visible.
//
// Baseline ("Reset all stats") semantics: event rows are filtered to
// ts >= baseline.t — the applyActivityBaseline pattern — because per-event data
// has nothing to subtract. IMPORTANT: RTK timestamps mix `+00:00` and `Z`
// suffixes, so rows are always compared in JS via Date.parse(), never by
// lexicographic SQL string comparison against an ISO cut.

// Active reset cut in ms, or null when no baseline is set.
function baselineCut() {
  const b = getBaseline();
  return b && typeof b.t === 'number' ? b.t : null;
}

const r0 = (n) => Number(n) || 0;
const pct = (part, whole) => whole ? (part / whole) * 100 : 0;
const round1 = (n) => Math.round(n * 10) / 10;

// ---- RTK: full-table row reads over every active history.db ----

// Read (timestamp, project_path, original_cmd, tokens…) rows from every RTK DB,
// already filtered to the active baseline cut. Returns [] when node:sqlite is
// unavailable (needs Node ≥22.5) or no DB exists — endpoints degrade to empty.
function readRtkRows() {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return []; }
  const cut = baselineCut();
  const rows = [];
  for (const home of rtkDataHomes()) {
    const dbPath = path.join(home, 'rtk', 'history.db');
    try {
      if (!fs.existsSync(dbPath)) continue;
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const r = db.prepare(
        'SELECT timestamp, original_cmd, rtk_cmd, project_path, '
        + 'input_tokens, output_tokens, saved_tokens, savings_pct, exec_time_ms '
        + 'FROM commands ORDER BY id'
      ).all();
      db.close();
      for (const row of r) {
        if (cut !== null) {
          const t = row.timestamp ? Date.parse(row.timestamp) : NaN;
          if (Number.isNaN(t) || t < cut) continue; // unprovably post-reset → drop
        }
        rows.push(row);
      }
    } catch { }
  }
  return rows;
}

// Feature: savings by project — aggregate per project_path. RTK records losses
// as saved=0 with output>input (saved_tokens is never negative), so gain/loss
// are derived from the input/output delta, matching collectRtkTotals().
function rtkProjects() {
  const byPath = new Map();
  for (const r of readRtkRows()) {
    const key = (r.project_path && String(r.project_path).trim()) || '(unknown)';
    const a = byPath.get(key) || { path: key, commands: 0, gain: 0, loss: 0, input: 0, output: 0 };
    const inp = r0(r.input_tokens), out = r0(r.output_tokens);
    a.commands += 1;
    a.input += inp;
    a.output += out;
    if (out < inp) a.gain += inp - out;
    else if (out > inp) a.loss += out - inp;
    byPath.set(key, a);
  }
  const projects = [...byPath.values()]
    .map(a => ({ ...a, net: a.gain - a.loss, avg_pct: round1(pct(a.gain - a.loss, a.input)) }))
    .sort((x, y) => y.net - x.net);
  return { projects, since: baselineCut() };
}

// Feature: loss commands — the rows where RTK's rewrite produced MORE tokens
// than the original command, ranked worst-first. The `rtk gain` CLI never
// reports these; they only exist as output>input rows in SQLite.
function rtkLosses({ limit = 50 } = {}) {
  limit = Math.max(1, Math.min(200, Math.round(Number(limit) || 50)));
  const rows = [];
  for (const r of readRtkRows()) {
    const inp = r0(r.input_tokens), out = r0(r.output_tokens);
    if (out <= inp) continue;
    const ts = r.timestamp ? Date.parse(r.timestamp) : NaN;
    rows.push({
      ts: Number.isNaN(ts) ? null : ts,
      original_cmd: r.original_cmd || '',
      rtk_cmd: r.rtk_cmd || '',
      project_path: r.project_path || '',
      before: inp, after: out, lost: out - inp,
      exec_time_ms: r0(r.exec_time_ms),
    });
  }
  rows.sort((a, b) => b.lost - a.lost);
  return { rows: rows.slice(0, limit), total_loss_rows: rows.length, since: baselineCut() };
}

// Multiplexer commands whose second token names the real operation.
const CMD_MULTIPLEXERS = new Set(['git', 'gh', 'cargo', 'npm', 'pnpm', 'npx', 'docker', 'kubectl', 'go', 'rtk']);

// "rtk git status -sb" → "git status"; "grep -r foo" → "grep". Strips a leading
// `rtk` (every command here went through RTK anyway) and option tokens.
function commandType(cmd) {
  const toks = String(cmd || '').trim().split(/\s+/).filter(t => t && !t.startsWith('-'));
  if (toks[0] === 'rtk') toks.shift();
  if (!toks.length) return '(unknown)';
  const first = toks[0].replace(/^.*\//, ''); // basename for absolute paths
  if (CMD_MULTIPLEXERS.has(first) && toks[1]) return `${first} ${toks[1].replace(/^.*\//, '')}`;
  return first;
}

// Feature: command-type aggregation — which command families RTK saves on,
// which pass through, which lose. passthrough = output === input (same
// convention as the activity feed).
function rtkCommandTypes() {
  const byType = new Map();
  for (const r of readRtkRows()) {
    const key = commandType(r.original_cmd);
    const a = byType.get(key) || { type: key, commands: 0, gain: 0, loss: 0, input: 0, passthrough: 0, time_ms: 0 };
    const inp = r0(r.input_tokens), out = r0(r.output_tokens);
    a.commands += 1;
    a.input += inp;
    a.time_ms += r0(r.exec_time_ms);
    if (out < inp) a.gain += inp - out;
    else if (out > inp) a.loss += out - inp;
    else a.passthrough += 1;
    byType.set(key, a);
  }
  const types = [...byType.values()]
    .map(a => ({
      type: a.type, commands: a.commands, gain: a.gain, loss: a.loss,
      net: a.gain - a.loss,
      passthrough: a.passthrough,
      passthrough_rate: round1(pct(a.passthrough, a.commands)),
      avg_pct: round1(pct(a.gain - a.loss, a.input)),
      avg_time_ms: a.commands ? Math.round(a.time_ms / a.commands) : 0,
    }))
    .sort((x, y) => y.net - x.net);
  return { types, since: baselineCut() };
}

// ---- Caveman: the full JSONL time series ----
// collectCaveman() keeps only the latest row per session; here we read ALL rows
// (the within-session growth curve) plus per-model / per-mode rollups.

function cavemanAnalysis({ series = 10 } = {}) {
  series = Math.max(1, Math.min(25, Math.round(Number(series) || 10)));
  const cut = baselineCut();
  let raw = null;
  try { raw = fs.readFileSync(cavemanHistoryPath(), 'utf8'); } catch { }

  const bySession = new Map(); // session_id → { latest, events, points[] }
  for (const line of raw ? raw.split('\n') : []) {
    const s = line.trim();
    if (!s) continue;
    let e; try { e = JSON.parse(s); } catch { continue; }
    const ts = typeof e.ts === 'number' ? e.ts : null;
    if (cut !== null && (ts === null || ts < cut)) continue;
    const key = e.session_id || `_${bySession.size}`;
    const g = bySession.get(key) || { latest: null, events: 0, points: [] };
    g.events += 1;
    g.points.push({ ts, output_tokens: r0(e.output_tokens), est_saved_tokens: r0(e.est_saved_tokens) });
    if (!g.latest || (ts || 0) >= (g.latest.ts || 0)) g.latest = e;
    bySession.set(key, g);
  }

  const sessions = [];
  const byModel = new Map(), byMode = new Map();
  for (const [id, g] of bySession) {
    const e = g.latest;
    sessions.push({
      session_id: id,
      mode: e.mode || 'unknown',
      model: e.model || 'unknown',
      ts: typeof e.ts === 'number' ? e.ts : null,
      output_tokens: r0(e.output_tokens),
      est_saved_tokens: r0(e.est_saved_tokens),
      est_saved_usd: r0(e.est_saved_usd),
      events: g.events,
    });
    for (const [map, key] of [[byModel, e.model || 'unknown'], [byMode, e.mode || 'unknown']]) {
      const a = map.get(key) || { sessions: 0, output_tokens: 0, est_saved_tokens: 0, est_saved_usd: 0 };
      a.sessions += 1;
      a.output_tokens += r0(e.output_tokens);
      a.est_saved_tokens += r0(e.est_saved_tokens);
      a.est_saved_usd += r0(e.est_saved_usd);
      map.set(key, a);
    }
  }
  sessions.sort((a, b) => b.est_saved_tokens - a.est_saved_tokens);

  const rollup = (m, label) => [...m.entries()]
    .map(([k, v]) => ({ [label]: k, ...v }))
    .sort((a, b) => b.est_saved_tokens - a.est_saved_tokens);

  // Growth curves: the `series` most recently active sessions, points in ts
  // order, capped at 500 points each. Values in the jsonl are already
  // cumulative-within-session, so the curve is the raw point sequence.
  const grow = [...bySession.entries()]
    .map(([id, g]) => ({
      session_id: id,
      last_ts: (g.latest && typeof g.latest.ts === 'number') ? g.latest.ts : 0,
      points: g.points
        .slice()
        .sort((a, b) => (a.ts || 0) - (b.ts || 0))
        .slice(-500),
    }))
    .sort((a, b) => b.last_ts - a.last_ts)
    .slice(0, series)
    .map(({ session_id, points }) => ({ session_id, points }));

  return {
    sessions,
    by_model: rollup(byModel, 'model'),
    by_mode: rollup(byMode, 'mode'),
    series: grow,
    since: cut,
  };
}

// ---- Headroom: native per-model savings history ----
// proxy_savings.json carries `history[]`: timestamped CUMULATIVE per-model
// snapshots {timestamp, provider, model, total_tokens_saved,
// compression_savings_usd, total_input_tokens, total_input_cost_usd}. It goes
// back further than the dashboard's own minute snapshots and is stripped from
// the SSE payload (see collectHeadroom) — this endpoint is its only carrier.

function headroomModels({ points = 300 } = {}) {
  points = Math.max(10, Math.min(1000, Math.round(Number(points) || 300)));
  const cut = baselineCut();
  let doc = null;
  try { doc = JSON.parse(fs.readFileSync(headroomSavingsPath(), 'utf8')); } catch { }
  const hist = (doc && Array.isArray(doc.history)) ? doc.history : [];

  const byModel = new Map();
  for (const h of hist) {
    if (!h || !h.timestamp) continue;
    const t = Date.parse(h.timestamp);
    if (Number.isNaN(t)) continue;
    const key = `${h.provider || ''}/${h.model || 'unknown'}`;
    const g = byModel.get(key) || { model: h.model || 'unknown', provider: h.provider || null, pts: [] };
    g.pts.push({
      t,
      saved_tokens: r0(h.total_tokens_saved),
      saved_usd: r0(h.compression_savings_usd),
      input_tokens: r0(h.total_input_tokens),
      input_cost_usd: r0(h.total_input_cost_usd),
    });
    byModel.set(key, g);
  }

  const KEYS = ['saved_tokens', 'saved_usd', 'input_tokens', 'input_cost_usd'];
  const models = [];
  let totalRaw = 0;
  for (const g of byModel.values()) {
    g.pts.sort((a, b) => a.t - b.t);
    totalRaw += g.pts.length;
    let pts = g.pts;
    if (cut !== null) {
      // Rebase at reset: snapshots are cumulative, so subtract the model's last
      // pre-reset value from every retained point ("saved since reset").
      const base = [...pts].reverse().find(p => p.t <= cut) || null;
      pts = pts.filter(p => p.t >= cut).map(p => {
        if (!base) return p;
        const np = { t: p.t };
        for (const k of KEYS) np[k] = Math.max(0, p[k] - base[k]);
        return np;
      });
    }
    if (!pts.length) continue;
    // Uniform-stride downsample (cumulative series — no bucket summing needed),
    // always keeping the last point so the headline value is exact.
    if (pts.length > points) {
      const stride = (pts.length - 1) / (points - 1);
      const out = [];
      for (let i = 0; i < points; i++) out.push(pts[Math.round(i * stride)]);
      pts = out;
    }
    models.push({ model: g.model, provider: g.provider, points: pts });
  }
  models.sort((a, b) => {
    const last = m => m.points[m.points.length - 1].saved_tokens;
    return last(b) - last(a);
  });
  return { models, total_points_raw: totalRaw, since: cut };
}

// ---- Headroom: strategy/transform/client aggregates + cache-hit trend ----
// Tail-window over session_stats.jsonl + proxy.log (proxy.log grows unbounded —
// never full-read). Aggregates therefore cover the visible window only;
// window_partial=true tells the UI to label them "last N MB".

function headroomOps({ bytes = 2097152 } = {}) {
  bytes = Math.max(65536, Math.min(8388608, Math.round(Number(bytes) || 2097152)));
  const cut = baselineCut();
  const inWindow = ts => (cut === null || (typeof ts === 'number' && ts >= cut));

  // Compress events by strategy
  const statPath = headroomSessionStatsPath();
  const strategies = new Map();
  for (const line of (tailFileSync(statPath, bytes) || '').split('\n')) {
    const e = parseSessionStatLine(line);
    if (!e || !inWindow(e.ts)) continue;
    const a = strategies.get(e.strategy) || { strategy: e.strategy, events: 0, before: 0, after: 0, saved: 0 };
    a.events += 1; a.before += e.before; a.after += e.after; a.saved += e.saved;
    strategies.set(e.strategy, a);
  }

  // PERF lines by transform + client, plus the cache-hit trend
  const logPath = headroomProxyLogPath();
  const transforms = new Map(), clients = new Map();
  const cachePts = [];
  let logSize = 0;
  try { logSize = fs.statSync(logPath).size; } catch { }
  for (const line of (tailFileSync(logPath, bytes) || '').split('\n')) {
    const e = parseProxyPerfLine(line);
    if (!e || !inWindow(e.ts)) continue;
    const saved = Math.max(0, e.before - e.after);
    const tKey = e.transforms || '(none)';
    const tA = transforms.get(tKey) || { transform: tKey, requests: 0, before: 0, after: 0, saved: 0 };
    tA.requests += 1; tA.before += e.before; tA.after += e.after; tA.saved += saved;
    transforms.set(tKey, tA);
    const cKey = e.client || '(unknown)';
    const cA = clients.get(cKey) || { client: cKey, requests: 0, saved: 0 };
    cA.requests += 1; cA.saved += saved;
    clients.set(cKey, cA);
    if (e.cacheHitPct != null && e.ts != null) cachePts.push({ t: e.ts, hit_pct: e.cacheHitPct });
  }

  // Downsample the cache trend to ≤300 points (keep the newest).
  let cacheTrend = cachePts.sort((a, b) => a.t - b.t);
  if (cacheTrend.length > 300) {
    const stride = (cacheTrend.length - 1) / 299;
    cacheTrend = Array.from({ length: 300 }, (_, i) => cacheTrend[Math.round(i * stride)]);
  }

  const finish = (m, sortKey) => [...m.values()].sort((a, b) => b[sortKey] - a[sortKey]);
  return {
    strategies: finish(strategies, 'saved').map(a => ({ ...a, avg_pct: round1(pct(a.saved, a.before)) })),
    transforms: finish(transforms, 'requests'),
    clients: finish(clients, 'requests'),
    cache_trend: cacheTrend,
    window_bytes: bytes,
    window_partial: logSize > bytes,
    since: cut,
  };
}

module.exports = {
  rtkProjects,
  rtkLosses,
  rtkCommandTypes,
  commandType,
  cavemanAnalysis,
  headroomModels,
  headroomOps,
};
