import { usageBar } from './cards-common.js';
import { computePace, parseDuration, windowSecsFromLabel } from './pace.js';

// ---- Antigravity usage by model group ----
// agy's /usage gauge is REMAINING quota, so the bar shows remaining % directly
// (100% = full quota available). The sub-line carries the reset countdown.
function agyLimitSub(lim) {
  if (!lim) return { style: 'opacity:0.6;', text: '—' };
  if (lim.full) return { style: 'opacity:0.8;', text: 'Quota available' };
  return { style: 'opacity:0.8;', text: lim.refresh ? `Refreshes in ${lim.refresh}` : 'remaining' };
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

  const remPct = lim => lim ? (lim.full ? 100 : (lim.remainingPct || 0)) : 0;
  // agy reports remaining quota + a rendered "Refreshes in …" string; the pacing
  // budget needs used% and seconds-left, and the window length comes from the
  // limit's own label ("Weekly" → 7d). An untouched ("Quota available") limit
  // has no refresh string, so it gets no pace line.
  const limPace = lim => computePace({
    usedPct: 100 - remPct(lim),
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
      html += usageBar(agyLimitLabel(lim.label), remPct(lim), agyLimitSub(lim), 'var(--antigravity)', mb, limPace(lim), true);
    });
  }

  if (d.stale) {
    html += `<div class="prog-sub" style="opacity:0.5; font-size:11px;">⚠ showing last successful poll${d.error ? ` (${d.error})` : ''}</div>`;
  } else if (d.polled_at) {
    html += `<div class="prog-sub" style="opacity:0.45; font-size:11px;">polled ${new Date(d.polled_at).toLocaleTimeString()}</div>`;
  }
  return html;
}

