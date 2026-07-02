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
//   • Headroom  — the authoritative lifetime savings ledger AND the live window
//                 telemetry (top-level + per-model). Window telemetry rolls over
//                 each quota window on its own; offsetting it shows "usage since
//                 reset" within the current window and naturally clamps to zero
//                 after a rollover — which reads as reset, so it's consistent.
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
function snapshotTotals(stats) {
  const rs = (stats.rtk && stats.rtk.summary) || {};
  const daily = (stats.rtk && Array.isArray(stats.rtk.daily)) ? stats.rtk.daily : [];
  const resetDay = new Date().toISOString().slice(0, 10);
  const dayRow = daily.find(r => String(r.date) === resetDay) || null;
  const c = stats.caveman || {};
  const life = (stats.headroom && stats.headroom.savings && stats.headroom.savings.lifetime) || {};
  const wt = (stats.headroom && stats.headroom.window_tokens) || {};
  return {
    t: Date.now(),
    rtk: {
      total_saved: rs.total_saved || 0,
      total_commands: rs.total_commands || 0,
      total_input: rs.total_input || 0,
      total_output: rs.total_output || 0,
      // The reset-day daily bucket at reset time (whole-day rollup), so its
      // chart bar can start from zero instead of showing pre-reset activity.
      day: dayRow ? {
        date: dayRow.date,
        saved_tokens: dayRow.saved_tokens || 0,
        commands: dayRow.commands || 0,
        input_tokens: dayRow.input_tokens || 0,
        output_tokens: dayRow.output_tokens || 0,
        total_time_ms: dayRow.total_time_ms || 0,
      } : null,
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
      window: snapshotWindow(wt),
    },
  };
}

// Snapshot the current absolute readings and persist them as the new zero-point.
function captureBaseline(rawStats) {
  baseline = snapshotTotals(rawStats || {});
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
  }

  // ---- Caveman ----
  if (stats.caveman && !stats.caveman.error) {
    const c = stats.caveman;
    c.total_saved_tokens = sub(c.total_saved_tokens, b.caveman.total_saved_tokens);
    c.total_output_tokens = sub(c.total_output_tokens, b.caveman.total_output_tokens);
    c.total_saved_usd = sub(c.total_saved_usd, b.caveman.total_saved_usd);
    c.session_count = sub(c.session_count, b.caveman.session_count);
  }

  // ---- Headroom lifetime savings ledger ----
  const life = stats.headroom && stats.headroom.savings && stats.headroom.savings.lifetime;
  if (life) {
    life.tokens_saved = sub(life.tokens_saved, b.headroom.tokens_saved);
    life.compression_savings_usd = sub(life.compression_savings_usd, b.headroom.compression_savings_usd);
    life.requests = sub(life.requests, b.headroom.requests);
  }

  // ---- Headroom live window telemetry (top-level + per-model) ----
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

// Load any persisted baseline immediately on import (mirrors history.js).
loadBaseline();

module.exports = {
  loadBaseline,
  getBaseline,
  snapshotTotals,
  captureBaseline,
  clearBaseline,
  applyBaseline,
};
