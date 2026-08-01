// ---- Consumption pacing ----
// A quota window is a budget spread evenly over its length: 100% / N days =
// X% per day, so on day 3 you may have spent up to 3X. Everything here is pure
// (no imports, no DOM reads) so it can be unit-tested outside the browser.

export const HOUR = 3600;
export const DAY = 86400;

// Pick the unit the budget is sliced into: days for windows of 2 days or more
// (weekly quotas, monthly billing cycles), hours for short ones (the 5h session).
export function windowUnits(windowSecs) {
  if (!Number.isFinite(windowSecs) || windowSecs <= 0) return null;
  const unit = windowSecs >= 2 * DAY ? DAY : HOUR;
  const count = Math.max(1, Math.round(windowSecs / unit));
  return { unit, count, label: unit === DAY ? 'day' : 'hour' };
}

// usedPct: how much of the quota is already consumed (0-100).
// windowSecs: total length of the quota window.
// remainingSecs: seconds left before it resets.
// Returns null when the window/timing isn't known — callers then render no pace.
export function computePace({ usedPct, windowSecs, remainingSecs }) {
  const u = windowUnits(windowSecs);
  if (!u) return null;
  if (!Number.isFinite(remainingSecs) || remainingSecs < 0) return null;
  const elapsed = Math.min(windowSecs, Math.max(0, windowSecs - remainingSecs));
  const perUnitPct = 100 / u.count;
  // The whole current unit's allowance is available as soon as it starts:
  // day 3 of 7 → budget 3 × 14.3% = 42.9%.
  const index = Math.min(u.count, Math.floor(elapsed / u.unit) + 1);
  const budgetPct = Math.min(100, perUnitPct * index);
  const used = Math.max(0, Number.isFinite(usedPct) ? usedPct : 0);
  const elapsedFrac = elapsed / windowSecs;
  return {
    ...u,
    perUnitPct,
    index,
    budgetPct,
    usedPct: used,
    spare: budgetPct - used,
    over: used > budgetPct,
    // kept so callers can identify *which* window instance this is (notify.js
    // dedupes per window, not per day-number — day 3 of next week is new)
    windowSecs,
    remainingSecs: Math.min(windowSecs, remainingSecs),
    // straight-line extrapolation of the current burn rate to the window end
    projectedPct: elapsedFrac > 0 ? used / elapsedFrac : null,
    elapsedFrac,
  };
}

// Monthly billing cycle (Cursor): walk the anniversary of `startMs` forward
// until it lands after `now`, giving the current cycle's length + remaining.
export function monthlyCycle(startMs, now = Date.now()) {
  const start = Number(startMs);
  if (!Number.isFinite(start) || start <= 0) return null;
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return null;
  let from = new Date(d);
  let to = new Date(d);
  to.setUTCMonth(to.getUTCMonth() + 1);
  let guard = 0;
  while (to.getTime() <= now && guard++ < 600) {
    from = new Date(to);
    to = new Date(to);
    to.setUTCMonth(to.getUTCMonth() + 1);
  }
  if (to.getTime() <= now) return null;
  return {
    windowSecs: (to.getTime() - from.getTime()) / 1000,
    remainingSecs: Math.max(0, (to.getTime() - now) / 1000),
  };
}

// "101h 16m" / "4d 11h" / "16m" / "2 days" → seconds. Antigravity only gives
// its reset time as this rendered string.
export function parseDuration(str) {
  const s = String(str || '').toLowerCase();
  if (!s.trim()) return null;
  let secs = 0, hit = false;
  const grab = (re, mult) => {
    const m = s.match(re);
    if (m) { secs += parseFloat(m[1]) * mult; hit = true; }
  };
  grab(/(\d+(?:\.\d+)?)\s*d(?:ays?)?\b/, DAY);
  grab(/(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\b/, HOUR);
  grab(/(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?s?)?\b/, 60);
  return hit ? Math.round(secs) : null;
}

// "Weekly" → 7d, "Five Hour"/"5-hour" → 5h, "Daily" → 1d, "Monthly" → 30d.
export function windowSecsFromLabel(label) {
  const s = String(label || '').trim().toLowerCase();
  if (!s) return null;
  if (/^week(ly)?$/.test(s) || /\bweek\b/.test(s)) return 7 * DAY;
  if (/^month(ly)?$/.test(s) || /\bmonth\b/.test(s)) return 30 * DAY;
  if (/^dai?ly$/.test(s) || /^day$/.test(s)) return DAY;
  const five = s.match(/^(five|5)[\s-]?hour$/);
  if (five) return 5 * HOUR;
  const n = s.match(/^(\d+(?:\.\d+)?)[\s-]?h(?:our)?s?$/);
  if (n) return parseFloat(n[1]) * HOUR;
  return null;
}

function pn(v) {
  const a = Math.abs(v);
  return a >= 10 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1);
}

// the per-unit rate is the headline number of the whole feature (100%/7 =
// 14.3%/day), so it keeps a decimal — rounding it to "14%/day" loses the point.
function rate(v) {
  return String(Math.round(v * 10) / 10);
}

// Tick on the bar marking "how far you're allowed to be by now". Every quota bar
// fills with USED %, so the tick sits at the budget itself.
export function paceMarker(p) {
  if (!p) return '';
  const left = Math.max(0, Math.min(99.4, p.budgetPct));
  return `<span class="pace-marker" style="left:${left.toFixed(2)}%" title="budget by now: ${pn(p.budgetPct)}%"></span>`;
}

// One-line verdict under the bar: where the budget is, and how much slack is left.
export function paceNote(p) {
  if (!p) return '';
  const verdict = p.over
    ? `${pn(-p.spare)}% over budget`
    : `${pn(p.spare)}% still available`;
  const proj = p.projectedPct == null ? '' :
    ` · at this rate ${pn(Math.min(999, p.projectedPct))}% by reset`;
  return `<div class="pace-note ${p.over ? 'over' : 'ok'}" title="${rate(p.perUnitPct)}% per ${p.label} × ${p.index} ${p.label}${p.index === 1 ? '' : 's'} = ${pn(p.budgetPct)}% budget${proj}">`
    + `${p.label} ${p.index}/${p.count} · ${rate(p.perUnitPct)}%/${p.label} · budget ${pn(p.budgetPct)}% · <b>${verdict}</b>`
    + `</div>`;
}
