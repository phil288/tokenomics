import { usageBar } from './cards-common.js';
import { computePace, parseDuration, windowSecsFromLabel } from './pace.js';

// ---- Antigravity usage by model group ----
// agy's /usage gauge reports REMAINING quota, but the card shows USED % so every
// quota bar on the dashboard fills the same way (0 → 100 as you consume), like
// Claude and Cursor. The sub-line carries the reset countdown.
function agyLimitSub(lim) {
  if (!lim) return { style: 'opacity:0.6;', text: '—' };
  // `full` = agy's "Quota available", i.e. nothing consumed yet — with a used-%
  // bar the honest label is the metric itself.
  if (lim.full) return { style: 'opacity:0.8;', text: 'quota used' };
  return { style: 'opacity:0.8;', text: lim.refresh ? `Refreshes in ${lim.refresh}` : 'quota used' };
}

// "GEMINI MODELS" → "Gemini", "CLAUDE AND GPT MODELS" → "Claude & GPT"
function agyGroupTitle(name) {
  return String(name || '')
    .replace(/\s*MODELS$/i, '')
    .replace(/\bAND\b/gi, '&')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/Gpt/g, 'GPT');
}

// agy gives labels like "Weekly", "Five Hour" (the " Limit" suffix is stripped
// in the parser). Tidy the common time windows; pass anything else through.
function agyLimitLabel(label) {
  const s = String(label || '').trim();
  return /^five[\s-]?hour$/i.test(s) ? '5-hour' : s;
}

export function renderAntigravity(d) {
  if (!d || d.disabled) return '';
  const hasGroups = d.groups && d.groups.length;
  if (!hasGroups) {
    if (d.error) return `<div class="err">${d.error}</div>`;
    return `<div class="loading">Fetching usage… first poll runs in the background (spawns agy).</div>`;
  }

  // agy's gauge is remaining quota; flip it so the bar grows with consumption.
  const usedPct = lim => lim ? (lim.full ? 0 : 100 - (lim.remainingPct || 0)) : 0;
  // The window length comes from the limit's own label ("Weekly" → 7d) and the
  // seconds left from the rendered "Refreshes in …" string. An untouched
  // ("Quota available") limit has no refresh string, so it gets no pace line.
  const limPace = lim => computePace({
    usedPct: usedPct(lim),
    windowSecs: windowSecsFromLabel(lim && lim.label),
    remainingSecs: parseDuration(lim && lim.refresh),
  });
  let html = '';
  if (d.account) html += `<div class="prog-sub" style="opacity:0.7; margin-bottom:10px;">${d.account}</div>`;

  for (const g of d.groups) {
    html += `
      <div style="margin-bottom:6px;">
        <div style="font-weight:600; font-size:12px;">${agyGroupTitle(g.name)}</div>
        ${g.models ? `<div class="prog-sub" style="opacity:0.55; font-size:11px;">${g.models}</div>` : ''}
      </div>`;
    // Render exactly the limits agy reported for this group — no assumptions
    // about which windows exist (varies by tier).
    const limits = g.limits || [];
    limits.forEach((lim, i) => {
      const mb = i === limits.length - 1 ? 16 : 10; // extra gap after the last bar
      const title = agyGroupTitle(g.name);
      html += usageBar(agyLimitLabel(lim.label), usedPct(lim), agyLimitSub(lim), 'var(--antigravity)', mb, {
        pace: limPace(lim),
        key: `agy:${g.name}:${lim.label}`,
        alertLabel: `Antigravity · ${title} ${agyLimitLabel(lim.label)}`,
      });
    });
  }

  if (d.stale) {
    html += `<div class="prog-sub" style="opacity:0.5; font-size:11px;">⚠ showing last successful poll${d.error ? ` (${d.error})` : ''}</div>`;
  } else if (d.polled_at) {
    html += `<div class="prog-sub" style="opacity:0.45; font-size:11px;">polled ${new Date(d.polled_at).toLocaleTimeString()}</div>`;
  }
  return html;
}

