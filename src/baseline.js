const fs = require('fs');
const path = require('path');

// A "baseline" is a non-destructive zero-point for the tool figures the
// dashboard shows. When the user hits "Reset all stats" we snapshot the current
// absolute readings here and, from then on, subtract this snapshot from every
// reading before it reaches the UI. The tools' own ledgers (RTK's SQLite,
// caveman's jsonl, Headroom's proxy_savings.json / subscription_state.json) are
// never touched — so the reset is fully reversible: delete the baseline and the
// absolute view returns.
//
// What gets offset:
//   • RTK       — cumulative summary totals AND the daily-chart buckets. The
//                 reset-day bucket is a whole-day rollup that already contains
//                 pre-reset activity, so we subtract the bucket's value *at reset
//                 time* (not just drop earlier days) or its bar stays full.
//   • Caveman   — cumulative session totals.
//   • Headroom  — the authoritative lifetime savings ledger AND the window
//                 telemetry (top-level + per-model). The telemetry reaching us
//                 is the persisted local accumulator (src/headroom-telemetry.js),
//                 which is monotonic — it never drops when Headroom restarts or
//                 rolls a quota window — so a plain subtract shows "usage since
//                 reset" forever, no window-identity gating needed.
// What is left alone: percentages/ratios, average exec time (an average, not a
// running total) and quota utilisation bars — none are cumulative counters.

// Overridable via env (mirrors history.js) so tests isolate to a temp dir.
const DATA_DIR = process.env.TOKENOMICS_DATA_DIR || path.join(__dirname, '..', 'data');
const BASELINE_FILE = path.join(DATA_DIR, 'baseline.json');

// Numeric fields carried for Headroom window telemetry (top-level + per-model).
const WIN_TOP = ['input', 'output', 'cache_reads', 'cache_writes_5m', 'cache_writes_1h', 'cache_writes_total', 'total_raw', 'weighted_token_equivalent'];
const WIN_MODEL = ['input', 'output', 'cache_reads', 'cache_writes_5m', 'cache_writes_1h', 'cache_writes_total'];

let baseline = null;

function loadBaseline() {
  try {
    if (fs.existsSync(BASELINE_FILE)) {
      const raw = fs.readFileSync(BASELINE_FILE, 'utf8').trim();
      baseline = raw ? JSON.parse(raw) : null;
    } else {
      baseline = null;
    }
  } catch (err) {
    console.error('Failed to load baseline:', err.message);
    baseline = null;
  }
  return baseline;
}

function getBaseline() {
  return baseline;
}

const num = (o, k) => (o && typeof o[k] === 'number') ? o[k] : 0;

// Snapshot the numeric fields of Headroom's window telemetry (top-level totals
// plus each per-model breakdown) so they can be offset later.
function snapshotWindow(wt) {
  const top = {};
  for (const k of WIN_TOP) top[k] = num(wt, k);
  const by = {};
  for (const [name, m] of Object.entries((wt && wt.by_model) || {})) {
    const e = {};
    for (const k of WIN_MODEL) e[k] = num(m, k);
    by[name] = e;
  }
  top.by_model = by;
  return top;
}

// Pull every figure the dashboard displays out of a RAW (un-offset) stats
// payload. This is exactly the set applyBaseline() subtracts, so capture and
// apply stay in lockstep.
// The numeric fields of one RTK period bucket (daily/weekly/monthly row) at
// reset time, so the containing bucket's chart bar can start from zero.
function bucketSnap(row) {
  return {
    saved_tokens: row.saved_tokens || 0,
    commands: row.commands || 0,
    input_tokens: row.input_tokens || 0,
    output_tokens: row.output_tokens || 0,
    total_time_ms: row.total_time_ms || 0,
  };
}

// `now` is the reset instant (ms epoch). It is BOTH the baseline's `t` and the
// day/week/month the reset falls in, so capture and apply share one source of
// truth. Defaults to Date.now() (production); tests inject a fixed instant so
// the reset-period bucket match doesn't drift with the wall clock.
function snapshotTotals(stats, now = Date.now()) {
  const rs = (stats.rtk && stats.rtk.summary) || {};
  const daily = (stats.rtk && Array.isArray(stats.rtk.daily)) ? stats.rtk.daily : [];
  const weekly = (stats.rtk && Array.isArray(stats.rtk.weekly)) ? stats.rtk.weekly : [];
  const monthly = (stats.rtk && Array.isArray(stats.rtk.monthly)) ? stats.rtk.monthly : [];
  const resetDay = new Date(now).toISOString().slice(0, 10);
  const dayRow = daily.find(r => String(r.date) === resetDay) || null;
  // Reset falls inside one weekly and one monthly rollup too — snapshot those
  // buckets so the Analysis view's weekly/monthly charts can zero their
  // reset-period bar (same trap as the daily bucket: the whole-period rollup
  // already contains pre-reset activity).
  const weekRow = weekly.find(r => String(r.week_start) <= resetDay && resetDay <= String(r.week_end)) || null;
  const monthRow = monthly.find(r => String(r.month) === resetDay.slice(0, 7)) || null;
  const c = stats.caveman || {};
  const life = (stats.headroom && stats.headroom.savings && stats.headroom.savings.lifetime) || {};
  const wt = (stats.headroom && stats.headroom.window_tokens) || {};
  return {
    t: now,
    rtk: {
      total_saved: rs.total_saved || 0,
      total_commands: rs.total_commands || 0,
      total_input: rs.total_input || 0,
      total_output: rs.total_output || 0,
      // The reset-day daily bucket at reset time (whole-day rollup), so its
      // chart bar can start from zero instead of showing pre-reset activity.
      day: dayRow ? { date: dayRow.date, ...bucketSnap(dayRow) } : null,
      week: weekRow ? { week_start: weekRow.week_start, ...bucketSnap(weekRow) } : null,
      month: monthRow ? { month: monthRow.month, ...bucketSnap(monthRow) } : null,
    },
    caveman: {
      total_saved_tokens: c.total_saved_tokens || 0,
      total_output_tokens: c.total_output_tokens || 0,
      total_saved_usd: c.total_saved_usd || 0,
      session_count: c.session_count || 0,
    },
    headroom: {
      tokens_saved: life.tokens_saved || 0,
      compression_savings_usd: life.compression_savings_usd || 0,
      requests: life.requests || 0,
      // Spend denominator (gross input volume/cost) — offset alongside the
      // savings so the "savings as % of spend" ratio stays coherent under reset.
      total_input_tokens: life.total_input_tokens || 0,
      total_input_cost_usd: life.total_input_cost_usd || 0,
      window: snapshotWindow(wt),
    },
  };
}

// Snapshot the current absolute readings and persist them as the new zero-point.
// `rtkTotals` is the whole-DB gain/loss rollup (collectRtkTotals()) captured at
// reset time so the Activity tab's lifetime totals can be offset too. Passed in
// rather than imported to avoid a require cycle with collectors.js.
function captureBaseline(rawStats, rtkTotals, now = Date.now()) {
  baseline = snapshotTotals(rawStats || {}, now);
  baseline.rtkTotals = {
    gain: (rtkTotals && rtkTotals.gain) || 0,
    loss: (rtkTotals && rtkTotals.loss) || 0,
    gainCmds: (rtkTotals && rtkTotals.gainCmds) || 0,
    lossCmds: (rtkTotals && rtkTotals.lossCmds) || 0,
  };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline));
  } catch (e) {
    console.error('baseline persist failed:', e.message);
  }
  return baseline;
}

// Drop the baseline → the dashboard returns to absolute (all-time) readings.
function clearBaseline() {
  baseline = null;
  try {
    if (fs.existsSync(BASELINE_FILE)) fs.rmSync(BASELINE_FILE);
  } catch (e) {
    console.error('baseline clear failed:', e.message);
  }
}

const sub = (a, b) => Math.max(0, (a || 0) - (b || 0));

// Subtract the active baseline from a stats payload IN PLACE and return it.
// No-op when no baseline is set. collectStats() calls this so every consumer
// (SSE stream, recorded history snapshots, the activity feed) sees a single,
// consistent offset view. Guards on each baseline sub-object so a baseline
// captured by an older build (missing .day / .window) still applies safely.
function applyBaseline(stats) {
  if (!baseline || !stats) return stats;
  const b = baseline;

  // ---- RTK ----
  if (stats.rtk && stats.rtk.summary && !stats.rtk.error) {
    const s = stats.rtk.summary;
    s.total_saved = sub(s.total_saved, b.rtk.total_saved);
    s.total_commands = sub(s.total_commands, b.rtk.total_commands);
    s.total_input = sub(s.total_input, b.rtk.total_input);
    s.total_output = sub(s.total_output, b.rtk.total_output);
    // Recompute the ratio from the now-offset totals so it stays coherent.
    s.avg_savings_pct = s.total_input ? (s.total_saved / s.total_input) * 100 : 0;

    // Daily breakdown (the RTK bar chart): drop buckets before the reset day,
    // and subtract the reset-day bucket's value-at-reset from the reset-day bar.
    if (Array.isArray(stats.rtk.daily)) {
      const resetDay = new Date(b.t).toISOString().slice(0, 10);
      const dayBase = b.rtk.day;
      stats.rtk.daily = stats.rtk.daily
        .filter(r => String(r.date) >= resetDay)
        .map(r => {
          if (!dayBase || String(r.date) !== dayBase.date) return r;
          const nr = {
            ...r,
            saved_tokens: sub(r.saved_tokens, dayBase.saved_tokens),
            commands: sub(r.commands, dayBase.commands),
            input_tokens: sub(r.input_tokens, dayBase.input_tokens),
            output_tokens: sub(r.output_tokens, dayBase.output_tokens),
            total_time_ms: sub(r.total_time_ms, dayBase.total_time_ms),
          };
          nr.savings_pct = nr.input_tokens ? (nr.saved_tokens / nr.input_tokens) * 100 : 0;
          return nr;
        });
    }

    // Weekly/monthly breakdowns (charted by the Analysis view): same treatment
    // as daily — drop periods that ended before the reset, subtract the
    // reset-period bucket's value-at-reset. Guarded per sub-object so an older
    // baseline (no .week/.month) leaves them untouched until the next reset.
    const offsetBucket = (r, base) => {
      const nr = {
        ...r,
        saved_tokens: sub(r.saved_tokens, base.saved_tokens),
        commands: sub(r.commands, base.commands),
        input_tokens: sub(r.input_tokens, base.input_tokens),
        output_tokens: sub(r.output_tokens, base.output_tokens),
        total_time_ms: sub(r.total_time_ms, base.total_time_ms),
      };
      nr.savings_pct = nr.input_tokens ? (nr.saved_tokens / nr.input_tokens) * 100 : 0;
      return nr;
    };
    if (Array.isArray(stats.rtk.weekly) && b.rtk.week !== undefined) {
      const resetDay = new Date(b.t).toISOString().slice(0, 10);
      const wkBase = b.rtk.week;
      stats.rtk.weekly = stats.rtk.weekly
        .filter(r => String(r.week_end) >= resetDay)
        .map(r => (wkBase && String(r.week_start) === String(wkBase.week_start)) ? offsetBucket(r, wkBase) : r);
    }
    if (Array.isArray(stats.rtk.monthly) && b.rtk.month !== undefined) {
      const resetMonth = new Date(b.t).toISOString().slice(0, 7);
      const moBase = b.rtk.month;
      stats.rtk.monthly = stats.rtk.monthly
        .filter(r => String(r.month) >= resetMonth)
        .map(r => (moBase && String(r.month) === String(moBase.month)) ? offsetBucket(r, moBase) : r);
    }
  }

  // ---- Caveman ----
  if (stats.caveman && !stats.caveman.error) {
    const c = stats.caveman;
    const liveSaved = (typeof c.statusline_saved_tokens === 'number') ? c.statusline_saved_tokens : 0;
    const liveUpdated = c.statusline_updated_at ? Date.parse(c.statusline_updated_at) : NaN;
    const liveAfterReset = liveSaved > 0 && Number.isFinite(liveUpdated) && liveUpdated >= b.t;
    c.total_saved_tokens = sub(c.total_saved_tokens, b.caveman.total_saved_tokens);
    c.total_output_tokens = sub(c.total_output_tokens, b.caveman.total_output_tokens);
    c.total_saved_usd = sub(c.total_saved_usd, b.caveman.total_saved_usd);
    c.session_count = sub(c.session_count, b.caveman.session_count);

    // Caveman writes its JSONL totals at session end, but the statusline suffix
    // is touched while Caveman is active. If a reset baseline zeroes the last
    // completed-session log, let a post-reset live statusline value keep the
    // card from looking empty during an active run.
    if (liveAfterReset && c.total_saved_tokens === 0) {
      c.total_saved_tokens = liveSaved;
      if (c.total_saved_usd === 0) c.total_saved_usd = liveSaved * 0.000015;
    }
  }

  // ---- Headroom lifetime savings ledger ----
  const life = stats.headroom && stats.headroom.savings && stats.headroom.savings.lifetime;
  if (life) {
    life.tokens_saved = sub(life.tokens_saved, b.headroom.tokens_saved);
    life.compression_savings_usd = sub(life.compression_savings_usd, b.headroom.compression_savings_usd);
    life.requests = sub(life.requests, b.headroom.requests);
    // Spend denominator — only when the baseline recorded it (newer builds);
    // otherwise leave absolute rather than faking a "since reset" ratio.
    if (typeof b.headroom.total_input_tokens === 'number') {
      life.total_input_tokens = sub(life.total_input_tokens, b.headroom.total_input_tokens);
      life.total_input_cost_usd = sub(life.total_input_cost_usd, b.headroom.total_input_cost_usd);
    }
  }

  // ---- Headroom window telemetry (top-level + per-model) ----
  // The telemetry is the local monotonic accumulator, so the baseline snapshot
  // always describes it — subtract unconditionally (clamped at 0).
  const wt = stats.headroom && stats.headroom.window_tokens;
  const wb = b.headroom && b.headroom.window;
  if (wt && wb) {
    for (const k of WIN_TOP) {
      if (typeof wt[k] === 'number') wt[k] = sub(wt[k], wb[k]);
    }
    if (wt.by_model && wb.by_model) {
      // Match by model name; models unseen at reset stay at their full value.
      for (const [name, m] of Object.entries(wt.by_model)) {
        const mb = wb.by_model[name];
        if (!mb) continue;
        for (const k of WIN_MODEL) {
          if (typeof m[k] === 'number') m[k] = sub(m[k], mb[k]);
        }
      }
    }
  }

  return stats;
}

// Offset the Activity feed payload ({ rows, rtk }) IN PLACE. Unlike the live
// stats, the activity feed is event-based, so "reset" means: only show events
// that happened AFTER the reset. Rows are filtered by timestamp (rows with no
// timestamp can't be proven post-reset, so they're dropped while a baseline is
// active), and the whole-DB RTK gain/loss totals are offset by the values
// captured at reset. No-op when no baseline is set. Guards on baseline.rtkTotals
// so a baseline from an older build still filters rows safely.
function applyActivityBaseline(payload) {
  if (!baseline || !payload) return payload;
  const cut = baseline.t;
  if (Array.isArray(payload.rows)) {
    payload.rows = payload.rows.filter(r => typeof r.ts === 'number' && r.ts >= cut);
  }
  const rb = baseline.rtkTotals;
  if (payload.rtk && rb) {
    const r = payload.rtk;
    r.gain = sub(r.gain, rb.gain);
    r.loss = sub(r.loss, rb.loss);
    r.gainCmds = sub(r.gainCmds, rb.gainCmds);
    r.lossCmds = sub(r.lossCmds, rb.lossCmds);
    r.net = r.gain - r.loss;
  }
  return payload;
}

// Load any persisted baseline immediately on import (mirrors history.js).
loadBaseline();

module.exports = {
  loadBaseline,
  getBaseline,
  snapshotTotals,
  captureBaseline,
  clearBaseline,
  applyBaseline,
  applyActivityBaseline,
};
