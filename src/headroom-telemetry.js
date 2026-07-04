const fs = require('fs');
const path = require('path');

// Headroom's subscription_state window counters (window_tokens.*) reset
// whenever the Headroom proxy restarts or a quota window rolls — so on a PC
// reboot the dashboard's telemetry cells would all drop back to zero. This
// module persists a local, monotonic accumulator (data/headroom-telemetry.json)
// and only ever adds the newly observed growth of the raw counters, so the
// displayed telemetry survives those source resets. It is USAGE telemetry, not
// savings — never derive a saving from it (see AGENTS.md §4.3).
//
// The accumulator only resets via the dashboard's own reset flow: "Reset all
// stats" captures it into the baseline (display offset, non-destructive), and
// clearTelemetryState() exists for tests.

const DATA_DIR = process.env.TOKENOMICS_DATA_DIR || path.join(__dirname, '..', 'data');
const TELEMETRY_FILE = path.join(DATA_DIR, 'headroom-telemetry.json');

const WIN_TOP = ['input', 'output', 'cache_reads', 'cache_writes_5m', 'cache_writes_1h', 'cache_writes_total', 'total_raw', 'weighted_token_equivalent'];
const WIN_MODEL = ['input', 'output', 'cache_reads', 'cache_writes_5m', 'cache_writes_1h', 'cache_writes_total'];

let state = null;

const clone = (value) => JSON.parse(JSON.stringify(value || {}));
const num = (o, k) => (o && typeof o[k] === 'number') ? o[k] : 0;

function loadTelemetryState() {
  try {
    if (!fs.existsSync(TELEMETRY_FILE)) {
      state = { last: null, totals: { by_model: {} } };
      return state;
    }
    const raw = fs.readFileSync(TELEMETRY_FILE, 'utf8').trim();
    state = raw ? JSON.parse(raw) : { last: null, totals: { by_model: {} } };
    if (!state.totals) state.totals = { by_model: {} };
    if (!state.totals.by_model) state.totals.by_model = {};
  } catch (err) {
    console.error('Failed to load Headroom telemetry state:', err.message);
    state = { last: null, totals: { by_model: {} } };
  }
  return state;
}

function persistTelemetryState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(state));
  } catch (err) {
    console.error('Headroom telemetry persist failed:', err.message);
  }
}

function clearTelemetryState() {
  state = { last: null, totals: { by_model: {} } };
  try {
    if (fs.existsSync(TELEMETRY_FILE)) fs.rmSync(TELEMETRY_FILE);
  } catch (err) {
    console.error('Headroom telemetry clear failed:', err.message);
  }
}

function snapshotWindow(wt) {
  const snap = { by_model: {} };
  for (const k of WIN_TOP) snap[k] = num(wt, k);
  for (const [name, model] of Object.entries((wt && wt.by_model) || {})) {
    const row = {};
    for (const k of WIN_MODEL) row[k] = num(model, k);
    snap.by_model[name] = row;
  }
  return snap;
}

function applyDeltas(current, previous, totals, fields) {
  for (const k of fields) {
    if (!current || typeof current[k] !== 'number') continue;
    const prev = num(previous, k);
    // Counter grew → add the growth. Counter shrank → the raw source reset
    // (proxy restart / window rollover), so the whole current value is new.
    const delta = current[k] >= prev ? current[k] - prev : current[k];
    totals[k] = num(totals, k) + Math.max(0, delta);
  }
}

// Fold the currently observed raw window counters into the persisted
// accumulator and return the accumulated totals (what the dashboard shows).
// When the raw source is unavailable (no subscription_state / no window_tokens
// yet), return the persisted totals WITHOUT touching `last`: updating `last`
// to zeros on a mere read failure would double-count still-growing raw
// counters on the next successful read.
function accumulateWindowTelemetry(wt) {
  if (!state) loadTelemetryState();
  if (!wt || typeof wt !== 'object') {
    return clone(state.totals || { by_model: {} });
  }
  const current = snapshotWindow(wt);
  const previous = state.last || { by_model: {} };
  const totals = state.totals || { by_model: {} };
  if (!totals.by_model) totals.by_model = {};

  applyDeltas(current, previous, totals, WIN_TOP);
  for (const [name, model] of Object.entries(current.by_model || {})) {
    if (!totals.by_model[name]) totals.by_model[name] = {};
    applyDeltas(model, previous.by_model && previous.by_model[name], totals.by_model[name], WIN_MODEL);
  }

  state = { last: current, totals };
  persistTelemetryState();
  return clone(totals);
}

module.exports = {
  TELEMETRY_FILE,
  accumulateWindowTelemetry,
  loadTelemetryState,
  clearTelemetryState,
};
