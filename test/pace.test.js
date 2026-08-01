// Consumption pacing (src/web/pace.js): "100% / N days = X% per day, so on day
// 3 you may have spent 3X". The module is browser ESM and the package is
// commonjs, so it is loaded by stripping `export` and evaluating it — that only
// works because pace.js is deliberately import-free and pure.
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PACE_JS = read('src/web/pace.js');
const EXPORTS = [
  'HOUR', 'DAY', 'windowUnits', 'computePace', 'monthlyCycle',
  'parseDuration', 'windowSecsFromLabel', 'paceMarker', 'paceNote',
];
// eslint-disable-next-line no-new-func
const pace = new Function(`${PACE_JS.replace(/^export /gm, '')}\nreturn { ${EXPORTS.join(', ')} };`)();
const { HOUR, DAY, windowUnits, computePace, monthlyCycle, parseDuration, windowSecsFromLabel, paceMarker, paceNote } = pace;

test('windowUnits slices long windows into days and short ones into hours', () => {
  assert.deepEqual(windowUnits(7 * DAY), { unit: DAY, count: 7, label: 'day' });
  assert.deepEqual(windowUnits(31 * DAY), { unit: DAY, count: 31, label: 'day' });
  assert.deepEqual(windowUnits(2 * DAY), { unit: DAY, count: 2, label: 'day' });
  assert.deepEqual(windowUnits(5 * HOUR), { unit: HOUR, count: 5, label: 'hour' });
  assert.equal(windowUnits(0), null);
  assert.equal(windowUnits(null), null);
});

test('weekly budget is per-day allowance times the current day index', () => {
  // 101h16m left of a 7-day window → 66h44m elapsed → day 3
  const p = computePace({ usedPct: 22, windowSecs: 7 * DAY, remainingSecs: 101 * HOUR + 16 * 60 });
  assert.equal(p.label, 'day');
  assert.equal(p.count, 7);
  assert.equal(p.index, 3);
  assert.ok(Math.abs(p.perUnitPct - 100 / 7) < 1e-9);
  assert.ok(Math.abs(p.budgetPct - 300 / 7) < 1e-9);
  assert.ok(Math.abs(p.spare - (300 / 7 - 22)) < 1e-9);
  assert.equal(p.over, false);
  assert.ok(p.projectedPct > 55 && p.projectedPct < 56);
});

test('overspending flips `over` and makes spare negative', () => {
  const p = computePace({ usedPct: 60, windowSecs: 7 * DAY, remainingSecs: 4 * DAY + 11 * HOUR });
  assert.equal(p.index, 3);
  assert.equal(p.over, true);
  assert.ok(p.spare < 0);
});

test('the whole first unit is available at the start of the window', () => {
  const p = computePace({ usedPct: 0, windowSecs: 5 * HOUR, remainingSecs: 5 * HOUR });
  assert.equal(p.index, 1);
  assert.equal(p.budgetPct, 20);
  assert.equal(p.spare, 20);
  assert.equal(p.projectedPct, null); // nothing elapsed → no burn rate yet
});

test('budget never exceeds 100% and clamps out-of-range timings', () => {
  const last = computePace({ usedPct: 90, windowSecs: 5 * HOUR, remainingSecs: 30 });
  assert.equal(last.index, 5);
  assert.equal(last.budgetPct, 100);
  // remaining > window (stale poll) is clamped to "nothing elapsed", not negative
  const early = computePace({ usedPct: 5, windowSecs: 5 * HOUR, remainingSecs: 9 * HOUR });
  assert.equal(early.index, 1);
  assert.equal(early.elapsedFrac, 0);
});

test('computePace returns null when the window or timing is unknown', () => {
  assert.equal(computePace({ usedPct: 10, windowSecs: null, remainingSecs: 100 }), null);
  assert.equal(computePace({ usedPct: 10, windowSecs: 7 * DAY, remainingSecs: null }), null);
  assert.equal(computePace({ usedPct: 10, windowSecs: 7 * DAY, remainingSecs: -5 }), null);
});

test('monthlyCycle walks the billing anniversary forward past now', () => {
  const start = Date.UTC(2026, 5, 15); // 2026-06-15
  const now = Date.UTC(2026, 7, 1);    // 2026-08-01 → cycle 07-15 .. 08-15
  const c = monthlyCycle(start, now);
  assert.equal(c.windowSecs, 31 * DAY);
  assert.equal(c.remainingSecs, 14 * DAY);
  // and the pace derived from it lands on day 18 of 31
  const p = computePace({ usedPct: 32, windowSecs: c.windowSecs, remainingSecs: c.remainingSecs });
  assert.equal(p.index, 18);
  assert.equal(p.count, 31);
  assert.equal(p.over, false);
});

test('monthlyCycle rejects missing/unparseable starts', () => {
  assert.equal(monthlyCycle(null), null);
  assert.equal(monthlyCycle(0), null);
  assert.equal(monthlyCycle('nope'), null);
});

test('parseDuration reads the rendered agy refresh strings', () => {
  assert.equal(parseDuration('101h 16m'), 101 * HOUR + 16 * 60);
  assert.equal(parseDuration('4d 11h'), 4 * DAY + 11 * HOUR);
  assert.equal(parseDuration('16m'), 960);
  assert.equal(parseDuration('2 days'), 2 * DAY);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('Quota available'), null);
  assert.equal(parseDuration(null), null);
});

test('windowSecsFromLabel maps agy limit labels to window lengths', () => {
  assert.equal(windowSecsFromLabel('Weekly'), 7 * DAY);
  assert.equal(windowSecsFromLabel('Five Hour'), 5 * HOUR);
  assert.equal(windowSecsFromLabel('5-hour'), 5 * HOUR);
  assert.equal(windowSecsFromLabel('Daily'), DAY);
  assert.equal(windowSecsFromLabel('Monthly'), 30 * DAY);
  assert.equal(windowSecsFromLabel('Starter Quota'), null);
  assert.equal(windowSecsFromLabel(''), null);
});

test('paceMarker positions the tick at the budget', () => {
  const p = computePace({ usedPct: 22, windowSecs: 7 * DAY, remainingSecs: 4 * DAY + 11 * HOUR });
  assert.equal(p.index, 3);
  assert.match(paceMarker(p), /left:42\.86%/);
  assert.equal(paceMarker(null), '');
  // never pinned at 100% where a 2px tick would be clipped by the track
  const full = computePace({ usedPct: 99, windowSecs: 5 * HOUR, remainingSecs: 60 });
  assert.match(paceMarker(full), /left:99\.40%/);
});

test('paceNote states the per-unit rate, the budget and the slack left', () => {
  const under = computePace({ usedPct: 17, windowSecs: 7 * DAY, remainingSecs: 4 * DAY + 11 * HOUR });
  const html = paceNote(under);
  assert.match(html, /class="pace-note ok"/);
  assert.match(html, /day 3\/7/);
  assert.match(html, /14\.3%\/day/);
  assert.match(html, /budget 43%/);
  assert.match(html, /26% still available/);
  const over = paceNote(computePace({ usedPct: 60, windowSecs: 7 * DAY, remainingSecs: 4 * DAY + 11 * HOUR }));
  assert.match(over, /class="pace-note over"/);
  assert.match(over, /17% over budget/);
  assert.equal(paceNote(null), '');
});

// ---- DOM/CSS contract (no jsdom — zero-dependency rule) ----

test('quota bars render the budget tick inside the track and the note under it', () => {
  const claude = read('src/web/cards-claude.js');
  assert.match(claude, /import \{[^}]*computePace[^}]*\} from '\.\/pace\.js'/);
  assert.match(claude, /computePace\(\{ usedPct: v, windowSecs, remainingSecs: resetSecs \}\)/);
  assert.match(claude, /<\/div>\$\{paceMarker\(pace\)\}<\/div>/);
  assert.match(claude, /\$\{paceNote\(pace\)\}/);
  // every Claude window declares its length so a pace can be computed
  assert.match(claude, /'Current session \(5h\)'.*5 \* HOUR\)/);
  assert.match(claude, /'Weekly · all models \(7d\)'.*7 \* DAY\)/);
  assert.match(claude, /modelWindows\.map\(m => quotaBar\(`Weekly · \$\{m\.label\} \(7d\)`.*7 \* DAY\)/);

  const common = read('src/web/cards-common.js');
  assert.match(common, /export function usageBar\(label, pctVal, sub, color = 'var\(--cursor\)', mb = 12, paceOpts = null\)/);
  assert.match(common, /\$\{paceMarker\(pace\)\}/);
  assert.match(common, /\$\{paceNote\(pace\)\}/);
});

test('antigravity flips its remaining-quota gauge into a used-% bar', () => {
  const agy = read('src/web/cards-antigravity.js');
  // agy reports REMAINING; every bar on the dashboard must fill 0 → 100 with use
  assert.match(agy, /const usedPct = lim => lim \? \(lim\.full \? 0 : 100 - \(lim\.remainingPct \|\| 0\)\) : 0/);
  assert.match(agy, /usageBar\(agyLimitLabel\(lim\.label\), usedPct\(lim\)/);
  assert.doesNotMatch(agy, /invert/);
  assert.match(agy, /usedPct: usedPct\(lim\)/);
  assert.match(agy, /windowSecs: windowSecsFromLabel\(lim && lim\.label\)/);
  assert.match(agy, /remainingSecs: parseDuration\(lim && lim\.refresh\)/);
});

test('cursor paces off the monthly billing cycle for all three bars', () => {
  const cur = read('src/web/cards-cursor.js');
  assert.match(cur, /import \{ computePace, monthlyCycle \} from '\.\/pace\.js'/);
  assert.match(cur, /function cursorCycleStartMs\(d\)/);
  assert.match(cur, /d\.subscriptionCycleStart \|\| \(d\.billingCycle && d\.billingCycle\.cycleStart\)/);
  assert.match(cur, /const cycle = monthlyCycle\(cursorCycleStartMs\(d\)\)/);
  assert.match(cur, /cursorBar\('Total'.*cursorPace\(cycle, totalPct\)/);
  assert.match(cur, /cursorBar\('Auto \+ Composer'.*cursorPace\(cycle, autoPct\)\)/);
  assert.match(cur, /cursorBar\('API'.*cursorPace\(cycle, apiPct\)\)/);
  assert.match(cur, /cursorBars\(totalPct, autoPct, apiPct, cycle\)/);
});

test('the track positions the tick and the note has ok/over colors', () => {
  const css = read('index.css');
  const track = css.slice(css.indexOf('.track {'), css.indexOf('.fill {'));
  assert.match(track, /position: relative/);
  assert.match(css, /\.pace-marker \{[\s\S]*?position: absolute[\s\S]*?\}/);
  assert.match(css, /\.pace-note\.ok b \{/);
  assert.match(css, /\.pace-note\.over b \{/);
});
