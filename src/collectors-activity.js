const { configuredHomes, readFile, tailFileSync, clampLimit } = require('./collector-utils');
const { readRtkActivity } = require('./collectors-rtk');
const { cavemanHistoryPath } = require('./collectors-caveman');
const {
  headroomSessionStatsPath,
  headroomProxyLogPath,
  parseProxyPerfLine,
  parseSessionStatLine,
} = require('./collectors-headroom');

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

function matchNum(s, re) { const m = re.exec(s); return m ? Number(m[1]) : null; }

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
    // Same query (original_cmd) + same response (rtk_cmd) seen before → compare
    // effective tokens (output) of the prior identical run vs this one.
    let repeat = null;
    if (r.prev_after != null) {
      const prevAfter = Number(r.prev_after) || 0;
      const prevTs = r.prev_ts ? Date.parse(r.prev_ts) : NaN;
      repeat = { prevAfter, prevTs: Number.isNaN(prevTs) ? null : prevTs, delta: after - prevAfter };
    }
    out.push({
      source: 'rtk',
      ts: Number.isNaN(ts) ? null : ts,
      label: truncLabel(r.original_cmd || r.rtk_cmd || 'rtk command'),
      detail: r.rtk_cmd || null,
      before, after,
      saved: Number.isFinite(saved) ? saved : Math.max(0, before - after),
      pct: typeof r.savings_pct === 'number' ? r.savings_pct : (before ? ((before - after) / before) * 100 : 0),
      info,
      ...(repeat ? { repeat } : {}),
    });
  }

  // Caveman — one row per JSONL event line (a per-session time series written
  // as the session progresses; the file is tiny, so a full read is fine).
  // before = what the session would have cost without compression (output +
  // estimated saved), after = actual output tokens.
  const cavRaw = (await Promise.all(configuredHomes().map(home => readFile(cavemanHistoryPath(home)))))
    .filter(Boolean)
    .join('\n');
  const cavEvents = [];
  for (const line of cavRaw ? cavRaw.split('\n') : []) {
    const s = line.trim();
    if (!s) continue;
    let e; try { e = JSON.parse(s); } catch { continue; }
    const after = Number(e.output_tokens) || 0;
    const saved = Number(e.est_saved_tokens) || 0;
    const before = after + saved;
    const info = [];
    if (e.mode) info.push(['mode', String(e.mode)]);
    if (e.model) info.push(['model', String(e.model)]);
    if (e.session_id) info.push(['session', String(e.session_id).slice(0, 8)]);
    if (typeof e.est_saved_usd === 'number') info.push(['est saved', '$' + e.est_saved_usd.toFixed(4)]);
    cavEvents.push({
      source: 'caveman',
      ts: typeof e.ts === 'number' ? e.ts : null,
      label: truncLabel(`${e.mode || 'caveman'} · ${e.model || 'session'}`),
      detail: null,
      before, after, saved,
      pct: before ? (saved / before) * 100 : 0,
      info,
    });
  }
  for (const e of cavEvents.slice(-limit)) out.push(e);

  // Headroom MCP compress events (tail of session_stats.jsonl)
  const statRaw = configuredHomes().map(home => tailFileSync(headroomSessionStatsPath(home))).filter(Boolean).join('\n');
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
  const logRaw = configuredHomes().map(home => tailFileSync(headroomProxyLogPath(home))).filter(Boolean).join('\n');
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

module.exports = { collectActivity, clampLimit };
