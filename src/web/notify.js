// ---- Desktop alerts for quota pacing ----
// Fires a browser notification when a quota bar's usage reaches a share of its
// pacing budget (§8): 80% of budget = "slow down", 100% = "over budget".
// Import-free and side-effect-free at load (same reason as pace.js) so the CJS
// test suite can evaluate it with a stubbed `Notification`.

let cfg = { enabled: false, warnPct: 80, overPct: 100 };

// key -> { warn: <unit stamp>, over: <unit stamp> }: which levels already fired
// for which unit of the window. Re-arms when the unit advances (a new day of a
// weekly quota raises the budget, so the alert is meaningful again) — at most
// one warn + one over per bar per unit.
const fired = new Map();

export function setPaceAlertConfig(next = {}) {
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(500, n) : fallback;
  };
  cfg = {
    enabled: next.enabled === true,
    warnPct: num(next.warnPct, 80),
    overPct: num(next.overPct, 100),
  };
  return paceAlertConfig();
}

export function paceAlertConfig() { return { ...cfg }; }

// Test seam + "user disabled and re-enabled" reset.
export function resetPaceAlerts() { fired.clear(); }

export function notificationsSupported() {
  return typeof Notification !== 'undefined';
}

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

// Must be called from a user gesture (the settings checkbox / test button),
// otherwise browsers reject the prompt.
export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function show(title, body, tag) {
  if (notificationPermission() !== 'granted') return false;
  try {
    new Notification(title, { body, tag });
    return true;
  } catch {
    return false;
  }
}

function pn(v) {
  const a = Math.abs(v);
  return a >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}

// Decide which alert (if any) a pace reading is due, without sending it.
// Exported for tests and so the caller can stay a one-liner.
export function paceAlertLevel(key, p) {
  if (!cfg.enabled || !p || !(p.budgetPct > 0)) return null;
  const ratio = (p.usedPct / p.budgetPct) * 100;
  const level = ratio >= cfg.overPct ? 'over' : ratio >= cfg.warnPct ? 'warn' : null;
  if (!level) return null;
  const stamp = `${p.count}:${p.index}`;
  const st = fired.get(key) || {};
  if (st[level] === stamp) return null;
  return { level, ratio, stamp };
}

// Called by the quota-bar renderers on every repaint; cheap and idempotent.
// `label` is what the user sees in the notification ("Claude · Weekly (7d)").
export function trackPace(key, label, p) {
  const due = paceAlertLevel(key, p);
  if (!due) return null;

  const st = fired.get(key) || {};
  st[due.level] = due.stamp;
  // Jumping straight past the budget consumes the warn slot too, so the user
  // never gets a "slow down" ping right after an "over budget" one.
  if (due.level === 'over') st.warn = due.stamp;
  fired.set(key, st);

  const where = `${p.label} ${p.index}/${p.count}`;
  const title = due.level === 'over'
    ? `Over budget — ${label}`
    : `${pn(due.ratio)}% of budget — ${label}`;
  const body = due.level === 'over'
    ? `${pn(p.usedPct)}% used vs ${pn(p.budgetPct)}% budget (${where}) · ${pn(-p.spare)}% over`
    : `${pn(p.usedPct)}% used of a ${pn(p.budgetPct)}% budget (${where}) · ${pn(p.spare)}% left`;

  show(title, body, `pace:${key}:${due.level}:${due.stamp}`);
  return { ...due, title, body };
}

export function sendTestNotification() {
  return show('Tokenomics', 'Quota pacing alerts are enabled.', 'pace:test');
}
