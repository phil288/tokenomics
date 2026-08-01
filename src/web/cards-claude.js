import { barColor, qpct, countdown, remainingTime, secsUntil } from './format.js';
import { userBreakdown } from './cards-common.js';
import { headroomHealthPill } from './cards-headroom.js';
import { computePace, paceMarker, paceNote, HOUR, DAY } from './pace.js';

function quotaBar(label, pctVal, resetSecs, inlineNote = '', windowSecs = null) {
  const v = pctVal || 0;
  const pace = computePace({ usedPct: v, windowSecs, remainingSecs: resetSecs });
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

// Claude plan usage (session / weekly limits). Sourced from Headroom's poll of
// the Claude quota API, but it's Claude's data — shown in its own card.
//
// Anthropic reports the 7-day "all models" window plus zero or more per-model
// 7-day windows (e.g. seven_day_sonnet, seven_day_opus, seven_day_fable) —
// which models get their own window depends on the account's plan/tier, so we
// discover them from whatever `seven_day_<model>` keys Headroom actually sent
// rather than hardcoding a single model.
export function renderClaude(d) {
  if (!d || d.error) return '<div class="err">No Claude quota data</div>';
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
    const online = d.health && d.health.ok;
    const msg = online
      ? 'Claude connected via Headroom; quota poll pending'
      : 'Claude quota unavailable (Headroom not reachable)';
    return `
      ${headroomHealthPill(d.health)}
      <div class="${online ? 'note' : 'err'}">${msg}</div>
      <div class="rows">${userBreakdown(d.users || [], 'claude')}</div>
    `;
  }
  const sessionSecs = sessionResetSecs(fh);
  return `
    ${quotaBar('Current session (5h)', fh.utilization_pct, sessionSecs, remainingTime(sessionSecs), 5 * HOUR)}
    ${quotaBar('Weekly · all models (7d)', sd.utilization_pct, quotaResetSecs(sd), '', 7 * DAY)}
    ${modelWindows.map(m => quotaBar(`Weekly · ${m.label} (7d)`, m.win.utilization_pct, quotaResetSecs(m.win), '', 7 * DAY)).join('')}
    <div class="rows">${userBreakdown(d.users || [], 'claude')}</div>
  `;
}
