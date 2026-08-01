// Desktop pacing alerts (src/web/notify.js). Same loader trick as pace.test.js:
// the module is browser ESM in a commonjs package, so it is evaluated with
// `export` stripped — which only works because notify.js is import-free.
// `Notification` is stubbed on globalThis to capture what would be shown.
const path = require('node:path');
const fs = require('node:fs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const load = (src, names) =>
  // eslint-disable-next-line no-new-func
  new Function(`${src.replace(/^export /gm, '')}\nreturn { ${names.join(', ')} };`)();

const notify = load(read('src/web/notify.js'), [
  'setPaceAlertConfig', 'paceAlertConfig', 'resetPaceAlerts', 'trackPace',
  'paceAlertLevel', 'notificationsSupported', 'notificationPermission',
  'requestNotificationPermission', 'sendTestNotification',
]);
const pace = load(read('src/web/pace.js'), ['computePace', 'DAY', 'HOUR']);
const { DAY, HOUR, computePace } = pace;

let sent = [];
class FakeNotification {
  constructor(title, opts) { sent.push({ title, ...opts }); }
  static permission = 'granted';
  static requestPermission() { return Promise.resolve(FakeNotification.permission); }
}
globalThis.Notification = FakeNotification;

// Minimal localStorage stand-in — the dedupe state is mirrored into it so a
// page reload doesn't replay alerts.
const fakeStorage = () => {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _map: m,
  };
};
globalThis.localStorage = fakeStorage();

// A weekly bar on day 3 → budget 42.86%.
const weekly = usedPct => computePace({ usedPct, windowSecs: 7 * DAY, remainingSecs: 4 * DAY + 11 * HOUR });
const NOW = Date.UTC(2026, 7, 1, 9, 0, 0);

beforeEach(() => {
  sent = [];
  FakeNotification.permission = 'granted';
  globalThis.localStorage = fakeStorage();
  notify.resetPaceAlerts();
  notify.setPaceAlertConfig({ enabled: true, warnPct: 80, overPct: 100 });
});

test('nothing fires while usage is below the warning share of the budget', () => {
  // 30% used of a 42.86% budget = 70% of budget
  assert.equal(notify.trackPace('k', 'Bar', weekly(30)), null);
  assert.equal(sent.length, 0);
});

test('crossing 80% of the budget fires one warning', () => {
  const r = notify.trackPace('k', 'Bar', weekly(35)); // 81.7% of budget
  assert.equal(r.level, 'warn');
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /82% of budget — Bar/);
  assert.match(sent[0].body, /35% used of a 43% budget \(day 3\/7\)/);
  assert.match(sent[0].body, /7\.9% left/);
});

test('reaching the budget fires the over-budget alert', () => {
  const r = notify.trackPace('k', 'Bar', weekly(50));
  assert.equal(r.level, 'over');
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /Over budget — Bar/);
  assert.match(sent[0].body, /50% used vs 43% budget \(day 3\/7\) · 7\.1% over/);
});

test('each level fires at most once per bar per unit', () => {
  notify.trackPace('k', 'Bar', weekly(35));
  notify.trackPace('k', 'Bar', weekly(36));
  notify.trackPace('k', 'Bar', weekly(37));
  assert.equal(sent.length, 1);
  // …then the over-budget alert is still allowed on the same unit
  notify.trackPace('k', 'Bar', weekly(50));
  notify.trackPace('k', 'Bar', weekly(52));
  assert.deepEqual(sent.map(s => s.title.startsWith('Over budget')), [false, true]);
});

test('an over-budget alert consumes the warning slot for that unit', () => {
  notify.trackPace('k', 'Bar', weekly(50));       // straight past the budget
  notify.trackPace('k', 'Bar', weekly(35));       // back into warn range
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /Over budget/);
});

test('alerts re-arm when the window advances to the next unit', () => {
  notify.trackPace('k', 'Bar', weekly(35), NOW);
  const day4 = computePace({ usedPct: 48, windowSecs: 7 * DAY, remainingSecs: 3 * DAY + 11 * HOUR });
  assert.equal(day4.index, 4);
  // one day later in wall-clock time, one day less remaining
  assert.equal(notify.trackPace('k', 'Bar', day4, NOW + DAY * 1000).level, 'warn');
  assert.equal(sent.length, 2);
});

test('the same day of the NEXT window is a new event', () => {
  notify.trackPace('k', 'Bar', weekly(35), NOW);
  // a week later: same day-3-of-7 position, different window instance
  const nextWeek = NOW + 7 * DAY * 1000;
  assert.equal(notify.trackPace('k', 'Bar', weekly(35), nextWeek).level, 'warn');
  assert.equal(sent.length, 2);
});

test('a page reload does not replay an alert already sent', () => {
  notify.trackPace('k', 'Bar', weekly(35), NOW);
  assert.equal(sent.length, 1);

  // reload = a fresh module instance against the same localStorage
  const reloaded = load(read('src/web/notify.js'), ['setPaceAlertConfig', 'trackPace', 'resetPaceAlerts']);
  reloaded.setPaceAlertConfig({ enabled: true, warnPct: 80, overPct: 100 });
  assert.equal(reloaded.trackPace('k', 'Bar', weekly(36), NOW + 60_000), null);
  assert.equal(sent.length, 1);
  // …but a genuinely new event still gets through after the reload
  assert.equal(reloaded.trackPace('k', 'Bar', weekly(50), NOW + 120_000).level, 'over');
  assert.equal(sent.length, 2);
});

test('alerts still work when localStorage is unavailable', () => {
  const saved = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('blocked'); },
  });
  try {
    const iso = load(read('src/web/notify.js'), ['setPaceAlertConfig', 'trackPace']);
    iso.setPaceAlertConfig({ enabled: true, warnPct: 80, overPct: 100 });
    assert.equal(iso.trackPace('k', 'Bar', weekly(35), NOW).level, 'warn');
    assert.equal(iso.trackPace('k', 'Bar', weekly(35), NOW), null); // in-memory dedupe still holds
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: saved });
  }
});

test('bars are tracked independently by key', () => {
  notify.trackPace('a', 'Claude · Weekly', weekly(35));
  notify.trackPace('b', 'Cursor · Total', weekly(35));
  assert.deepEqual(sent.map(s => s.title.split('— ')[1]), ['Claude · Weekly', 'Cursor · Total']);
});

test('disabled config and missing pace never alert', () => {
  notify.setPaceAlertConfig({ enabled: false, warnPct: 80, overPct: 100 });
  assert.equal(notify.trackPace('k', 'Bar', weekly(99)), null);
  notify.setPaceAlertConfig({ enabled: true, warnPct: 80, overPct: 100 });
  assert.equal(notify.trackPace('k', 'Bar', null), null);
  assert.equal(sent.length, 0);
});

test('thresholds are configurable', () => {
  notify.setPaceAlertConfig({ enabled: true, warnPct: 50, overPct: 90 });
  assert.equal(notify.paceAlertConfig().warnPct, 50);
  assert.equal(notify.trackPace('k', 'Bar', weekly(25)).level, 'warn'); // 58% of budget
  notify.resetPaceAlerts();
  assert.equal(notify.trackPace('k', 'Bar', weekly(40)).level, 'over');  // 93% of budget
});

test('setPaceAlertConfig falls back to defaults on junk values', () => {
  const c = notify.setPaceAlertConfig({ enabled: true, warnPct: 'abc', overPct: -5 });
  assert.deepEqual(c, { enabled: true, warnPct: 80, overPct: 100 });
  assert.equal(notify.setPaceAlertConfig({}).enabled, false);
});

test('without browser permission the level is still computed but nothing is shown', () => {
  FakeNotification.permission = 'denied';
  const r = notify.trackPace('k', 'Bar', weekly(50));
  assert.equal(r.level, 'over');
  assert.equal(sent.length, 0);
  assert.equal(notify.notificationPermission(), 'denied');
  assert.equal(notify.sendTestNotification(), false);
});

test('permission helpers degrade when the API is absent', async () => {
  const saved = globalThis.Notification;
  delete globalThis.Notification;
  try {
    assert.equal(notify.notificationsSupported(), false);
    assert.equal(notify.notificationPermission(), 'unsupported');
    assert.equal(await notify.requestNotificationPermission(), 'unsupported');
    assert.equal(notify.sendTestNotification(), false);
  } finally {
    globalThis.Notification = saved;
  }
});

// ---- wiring contract ----

test('every quota bar registers itself for alerts with a unique key', () => {
  const claude = read('src/web/cards-claude.js');
  assert.match(claude, /import \{ trackPace \} from '\.\/notify\.js'/);
  assert.match(claude, /trackPace\(`claude:\$\{label\}`, `Claude · \$\{label\}`, pace\)/);

  const common = read('src/web/cards-common.js');
  assert.match(common, /export function usageBar\(label, pctVal, sub, color = 'var\(--cursor\)', mb = 12, paceOpts = null\)/);
  assert.match(common, /const \{ pace = null, key = null, alertLabel = label \} = paceOpts \|\| \{\}/);
  assert.match(common, /if \(key\) trackPace\(key, alertLabel, pace\)/);

  const agy = read('src/web/cards-antigravity.js');
  assert.match(agy, /key: `agy:\$\{g\.name\}:\$\{lim\.label\}`/);
  assert.match(agy, /alertLabel: `Antigravity · \$\{title\} \$\{agyLimitLabel\(lim\.label\)\}`/);

  const cur = read('src/web/cards-cursor.js');
  assert.match(cur, /key: alert \? `cursor:\$\{label\}` : null/);
  assert.match(cur, /alertLabel: `Cursor · \$\{label\}`/);
  // Total is max(auto, api) — the driving bar alerts, so Total must not
  assert.match(cur, /cursorBar\('Total'.*cursorPace\(cycle, totalPct\), false\)/);
});

test('the settings modal owns an Alerts tab wired to the notifier', () => {
  const html = read('index.html');
  assert.match(html, /data-tab="alerts"/);
  assert.match(html, /data-panel="alerts"/);
  for (const id of ['set-notify-enabled', 'set-notify-warn', 'set-notify-over', 'test-notification-btn', 'notify-status']) {
    assert.ok(html.includes(`id="${id}"`), `${id} missing from index.html`);
  }

  const js = read('src/web/settings.js');
  assert.match(js, /import \{[\s\S]*?setPaceAlertConfig[\s\S]*?\} from '\.\/notify\.js'/);
  assert.match(js, /PACE_ALERTS_ENABLED: document\.getElementById\('set-notify-enabled'\)\.checked/);
  assert.match(js, /PACE_ALERT_WARN_PCT: document\.getElementById\('set-notify-warn'\)\.value/);
  assert.match(js, /PACE_ALERT_OVER_PCT: document\.getElementById\('set-notify-over'\)\.value/);
  // permission must be requested from the checkbox gesture, and config applied
  // both at boot and after a save
  assert.match(js, /notifyEnabledCb\.addEventListener\('change'[\s\S]*?requestNotificationPermission\(\)/);
  assert.match(js, /if \(config\) applyPaceAlertSettings\(config\)/);
  // an unrelated save (pricing, paths) must not re-arm and replay alerts
  assert.match(js, /if \(before\.enabled !== after\.enabled \|\| before\.warnPct !== after\.warnPct/);
  assert.match(js, /resetPaceAlerts\(\);/);
});

test('the threshold fields and the toggle inherit the modal form styling', () => {
  // The thresholds are number inputs and the toggle sits in a .form-group-row;
  // both were unstyled (white boxes / oversized label) until the CSS covered them.
  const css = read('index.css');
  assert.match(css, /\.form-group input\[type="number"\] \{/);
  assert.match(css, /\.form-group input\[type="number"\]:focus/);
  assert.match(css, /\.form-group-row input\[type="checkbox"\] \{/);
  assert.match(css, /\.form-group-row label \{/);
});
