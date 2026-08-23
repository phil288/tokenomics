import { barColor, qpct, countdown, remainingTime, secsUntil, timeAgo } from './format.js';
import { userBreakdown } from './cards-common.js';
import { headroomHealthPill } from './cards-headroom.js';
import { computePace, paceMarker, paceNote, HOUR, DAY } from './pace.js';
import { trackPace } from './notify.js';

function quotaBar(label, pctVal, resetSecs, inlineNote = '', windowSecs = null) {
  const v = pctVal || 0;
  const pace = computePace({ usedPct: v, windowSecs, remainingSecs: resetSecs });
  trackPace(`claude:${label}`, `Claude · ${label}`, pace);
  return `
    <div class="prog-group">
      <div class="prog-header">
        <span class="prog-label">${label}${inlineNote ? ` <span class="prog-note">${inlineNote}</span>` : ''}</span>
        <span class="prog-pct" style="color:${barColor(v)}">${qpct(v)}%</span>
      </div>
      <div class="track"><div class="fill" style="width:${Math.min(v, 100)}%;background:${barColor(v)}"></div>${paceMarker(pace)}</div>
      ${resetSecs != null ? `<div class="prog-sub">${countdown(resetSecs)}</div>` : ''}
      ${paceNote(pace)}
    </div>`;
}

function quotaResetSecs(win) {
  if (!win) return null;
  const resetAt = win.resets_at || win.reset_at || win.resetAt;
  const fromTimestamp = secsUntil(resetAt);
  if (fromTimestamp != null) return fromTimestamp;
  return Number.isFinite(win.seconds_to_reset) ? Math.max(0, Math.round(win.seconds_to_reset)) : null;
}

function sessionResetSecs(win) {
  if (!win) return null;
  const resetAt = win.resets_at || win.reset_at || win.resetAt;
  const fromTimestamp = secsUntil(resetAt);
  if (fromTimestamp && fromTimestamp > 0) return fromTimestamp;
  if (Number.isFinite(win.seconds_to_reset) && win.seconds_to_reset > 0) {
    return Math.round(win.seconds_to_reset);
  }
  return null;
}

// "seven_day_sonnet" -> "Sonnet", "seven_day_fable" -> "Fable", etc.
export function modelWindowLabel(slug) {
  return slug.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

// How stale a quota reading may get before we flag it. The numbers below come
// from the slow `claude /usage` poll, so a bar can look live while actually
// being hours old if that poll started failing.
export const POLL_WARN_SECS = 5 * 60;
export const POLL_STALE_SECS = 30 * 60;

// Freshness line for the Claude card: when the quota numbers were last read
// from the `claude /usage` poll (`polled_at`), not when the dashboard last
// refreshed.
export function polledFreshness(polledAt) {
  const t = polledAt ? Date.parse(polledAt) : NaN;
  if (Number.isNaN(t)) {
    return '<div class="poll-age unknown">Quota age unknown</div>';
  }
  const age = Math.max(0, (Date.now() - t) / 1000);
  const level = age >= POLL_STALE_SECS ? 'stale' : age >= POLL_WARN_SECS ? 'warn' : 'fresh';
  const title = new Date(t).toLocaleString();
  return `<div class="poll-age ${level}" title="Last polled via claude /usage: ${title}">`
    + `Updated ${timeAgo(polledAt)}</div>`;
}

// Claude plan usage (session / weekly limits). Sourced from Claude Code's own
// `/usage` slash command (`claude -p "/usage"`, polled on a slow timer because
// each call costs ~11s) — not from Headroom's mirror of the quota API.
//
// Anthropic reports the 7-day "all models" window plus zero or more per-model
// 7-day windows (e.g. seven_day_sonnet, seven_day_opus, seven_day_fable) —
// which models get their own window depends on the account's plan/tier, so we
// discover them from whatever `seven_day_<model>` keys Headroom actually sent
// rather than hardcoding a single model.
export function renderClaude(d) {
  // Note: a `d.error` alone must NOT short-circuit — the poller keeps the last
  // good `latest` and flags the failure, so we still render the (stale) bars
  // and let the freshness line say how old they are.
  if (!d) return '<div class="err">No Claude quota data</div>';
  const lt = d.latest || {};
  const fh = lt.five_hour || {};
  const sd = lt.seven_day || {};
  const modelWindows = Object.keys(lt)
    .filter(k => k.startsWith('seven_day_') && lt[k])
    .map(k => ({ label: modelWindowLabel(k.slice('seven_day_'.length)), win: lt[k] }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const have = (fh.utilization_pct != null) || (sd.utilization_pct != null)
    || modelWindows.some(m => m.win.utilization_pct != null);
  if (!have) {
    // `claude /usage` runs on a slow timer, so the first frames after boot
    // legitimately have no quota yet — that's "pending", not an error.
    const msg = d.error
      ? `Claude quota unavailable (${d.error})`
      : 'Claude quota poll pending (claude /usage)';
    return `
      ${headroomHealthPill(d.health)}
      <div class="${d.error ? 'err' : 'note'}">${msg}</div>
      ${polledFreshness(d.polled_at)}
      <div class="rows">${userBreakdown(d.users || [], 'claude')}</div>
    `;
  }
  const sessionSecs = sessionResetSecs(fh);
  return `
    ${polledFreshness(d.polled_at)}
    ${quotaBar('Current session (5h)', fh.utilization_pct, sessionSecs, remainingTime(sessionSecs), 5 * HOUR)}
    ${quotaBar('Weekly · all models (7d)', sd.utilization_pct, quotaResetSecs(sd), '', 7 * DAY)}
    ${modelWindows.map(m => quotaBar(`Weekly · ${m.label} (7d)`, m.win.utilization_pct, quotaResetSecs(m.win), '', 7 * DAY)).join('')}
    <div class="rows">${userBreakdown(d.users || [], 'claude')}</div>
  `;
}
