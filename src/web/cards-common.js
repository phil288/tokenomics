import { ht, usdFull } from './format.js';
import { modelRaw, modelWeighted, modelUsd, modelUsdRaw } from './pricing.js';
import { paceMarker, paceNote } from './pace.js';
import { trackPace } from './notify.js';

export function renderModels(byModel) {
  if (!byModel) return '';
  const entries = Object.entries(byModel)
    .map(([name, m]) => ({
      name, raw: modelRaw(m), weighted: modelWeighted(m),
      usd: modelUsd(name, m), rawUsd: modelUsdRaw(name, m)
    }))
    .filter(e => e.raw > 0 && e.name !== '<synthetic>')
    .sort((a, b) => b.raw - a.raw);
  if (!entries.length) return '';
  const max = Math.max(...entries.map(e => Math.max(e.raw, e.weighted)));
  const tReal = entries.reduce((s, e) => s + (e.usd || 0), 0);
  const tRaw = entries.reduce((s, e) => s + (e.rawUsd || 0), 0);
  const tSaved = tRaw - tReal;
  const short = n => n.replace(/^(claude|gemini|antigravity|cursor)-/, '').replace(/-\d{8}$/, '').replace(/-\d{8}T.*$/, '');
  return `
    <div class="divider"></div>
    <div class="tcell-label" style="margin-bottom:10px">Raw vs weighted by model <span style="opacity:0.6">(token bars + raw/real/saved $)</span></div>
    <div class="mdl-legend">
      <span><span class="lg-swatch" style="background:var(--muted)"></span>raw</span>
      <span><span class="lg-swatch" style="background:var(--headroom)"></span>weighted</span>
    </div>
    <div class="cost-totals">
      <div class="ct"><span class="ct-l">raw cost</span><span class="ct-v ct-raw">${usdFull(tRaw)}</span></div>
      <div class="ct"><span class="ct-l">real cost</span><span class="ct-v ct-real">${usdFull(tReal)}</span></div>
      <div class="ct"><span class="ct-l">saved</span><span class="ct-v ct-saved">${usdFull(tSaved)}</span></div>
    </div>
    ${entries.map(e => {
      const disc = e.raw ? Math.round((1 - e.weighted / e.raw) * 100) : 0;
      const saved = (e.rawUsd || 0) - (e.usd || 0);
      return `
      <div class="mdl-block">
        <div class="mdl-block-head">
          <span class="mdl-name">${short(e.name)}</span>
          <span class="mdl-figs">${ht(e.raw)} → <b>${ht(e.weighted)}</b> <span class="mdl-disc">−${disc}%</span></span>
        </div>
        <div class="mdl-bar-track"><span class="mdl-bar" style="width:${(e.raw / max * 100).toFixed(0)}%;background:var(--muted)"></span></div>
        <div class="mdl-bar-track" style="margin-top:3px"><span class="mdl-bar" style="width:${(e.weighted / max * 100).toFixed(0)}%;background:var(--headroom)"></span></div>
        <div class="mdl-costs">
          <span>raw <b class="ct-raw">${usdFull(e.rawUsd)}</b></span>
          <span>real <b class="ct-real">${usdFull(e.usd)}</b></span>
          <span>saved <b class="ct-saved">${usdFull(saved)}</b></span>
        </div>
      </div>`;
    }).join('')}
  `;
}

// `paceOpts` is optional: `{ pace, key, alertLabel }`. With a pace the track
// gets a budget tick and a pacing line under the sub-text; `key`/`alertLabel`
// register the bar for desktop pacing alerts.
export function usageBar(label, pctVal, sub, color = 'var(--cursor)', mb = 12, paceOpts = null) {
  const { pace = null, key = null, alertLabel = label } = paceOpts || {};
  if (key) trackPace(key, alertLabel, pace);
  return `
      <div class="prog-group" style="margin-bottom: ${mb}px;">
        <div class="prog-header" style="font-size: 13px; margin-bottom: 4px;">
          <span class="prog-label" style="font-weight: 500;">${label}</span>
          <span class="prog-pct" style="color:${color}; font-weight: 700;">${Math.round(pctVal)}%</span>
        </div>
        <div class="track" style="height: 6px; background: rgba(255,255,255,0.05);">
          <div class="fill" style="width:${Math.min(pctVal, 100)}%; background: ${color}; height: 100%; border-radius: 3px;"></div>
          ${paceMarker(pace)}
        </div>
        <div class="prog-sub" style="font-size: 11px; margin-top: 4px; ${sub.style}">${sub.text}</div>
        ${paceNote(pace)}
      </div>`;
}

export function userBreakdown(users, kind) {
  if (!users || !users.length) return '';
  const rows = users.map(u => {
    let value = '';
    if (kind === 'rtk') {
      const r = u.rtk || {};
      value = `${ht(r.total_saved || 0)} saved`;
    } else if (kind === 'caveman') {
      const c = u.caveman || {};
      const status = c.active ? (c.mode || 'active') : c.installed ? 'installed' : 'not installed';
      value = `${status} · ${ht(c.total_saved_tokens || 0)} saved`;
    } else if (kind === 'claude') {
      const c = u.claude || {};
      value = c.has_quota ? 'quota polled' : c.headroom_state ? 'state only' : 'no state';
    }
    return `<div class="row"><span class="row-label">${ht(u.user || 'user')}</span><span class="row-val">${ht(value)}</span></div>`;
  }).join('');
  return `<div class="divider"></div><div class="tcell-label" style="margin-bottom:6px">Per user</div>${rows}`;
}

export function heroUsers(users) {
  if (!users || users.length < 2) return '';
  return users.map(u => {
    const rtk = u.rtk ? (u.rtk.total_saved || 0) : 0;
    const cav = u.caveman ? (u.caveman.total_saved_tokens || 0) : 0;
    const hr = u.headroom ? (u.headroom.tokens_saved || 0) : 0;
    return `<div class="chip" style="border-left-color:var(--muted)">
      <span class="chip-label">${ht(u.user)}</span><span class="chip-val">${ht(rtk + cav + hr)}</span>
    </div>`;
  }).join('');
}

