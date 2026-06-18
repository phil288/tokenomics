// ---- formatting & small pure helpers ----

// resolve a CSS custom property (theme color) by name, with a fallback
export function tc(name) {
  return getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim() || '#888';
}

export function ht(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
export function pct(n) { return (n === null || n === undefined) ? '—' : n.toFixed(1) + '%'; }

// compact relative time, e.g. "3m ago" / "2h ago" / "5d ago". Returns 'never' when no data.
export function timeAgo(iso) {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'never';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return '1m ago';
  const m = s / 60;
  if (m < 60) return Math.round(m) + 'm ago';
  const h = m / 60;
  if (h < 24) return Math.round(h) + 'h ago';
  const d = h / 24;
  if (d < 7) return Math.round(d) + 'd ago';
  if (d < 30) return Math.round(d / 7) + 'w ago';
  if (d < 365) return Math.round(d / 30) + 'mo ago';
  return Math.round(d / 365) + 'y ago';
}
// "Last used" row with absolute timestamp on hover.
export function lastUsedRow(iso) {
  const title = iso ? new Date(iso).toLocaleString() : 'no recorded activity';
  return `<div class="row"><span class="row-label">Last used</span><span class="row-val" title="${title}">${timeAgo(iso)}</span></div>`;
}
export function usd(n) { return (n === null || n === undefined) ? '—' : '$' + n.toFixed(4); }
export function usdFull(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(3);
  return '$' + n.toFixed(4);
}
export function countdown(secs) {
  if (!secs || secs <= 0) return '';
  if (secs > 86400) return `resets in ${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
  if (secs > 3600) return `resets in ${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `resets in ${Math.floor(secs / 60)}m`;
}

// Headroom stores seconds_to_reset frozen at poll time, so it goes stale
// between polls. resets_at is an absolute timestamp — compute remaining live
// against the clock so the countdown matches Claude's own display.
export function secsUntil(resetsAt) {
  if (!resetsAt) return null;
  const t = Date.parse(resetsAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((t - Date.now()) / 1000));
}
export function barColor(p) {
  return p > 80 ? '#f85149' : p > 60 ? '#d29922' : '#3fb950';
}
// quota % can be a small fraction (e.g. 0.4%); never round a nonzero value down
// to 0 — show at least 1% so "in use" is visible (matches Claude's own display).
export function qpct(p) { return p > 0 ? Math.max(1, Math.round(p)) : 0; }
