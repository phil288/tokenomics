import { ht, pct, usd, lastUsedRow, timeAgo } from './format.js';
import { MODE_COLORS } from './pricing.js';
import { userBreakdown, heroUsers } from './cards-common.js';

// Install pill for the RTK CLI, driven by collectors.js's `rtk --version` probe.
// Installed = green (with version); missing = red.
export function rtkInstallPill(inst) {
  if (!inst) return '';
  if (inst.installed) {
    const col = 'var(--success, #3fb950)';
    const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></span>`;
    const sub = inst.version ? `<span style="opacity:0.7;font-weight:500;text-transform:none;letter-spacing:0;margin-left:6px">v${inst.version}</span>` : '';
    return `<div class="badge" style="background:${col}1a;color:${col};border:1px solid ${col}40">${dot}RTK installed${sub}</div>`;
  }
  const col = 'var(--danger, #f85149)';
  const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></span>`;
  return `<div class="badge" style="background:${col}1a;color:${col};border:1px solid ${col}40">${dot}RTK not installed</div>`;
}

export function renderRTK(d, lastUsed) {
  const pill = rtkInstallPill(d && d.install);
  if (!d || d.error) return pill + '<div class="err">No RTK data</div>';
  const s = d.summary || {};
  return `
    ${pill}
    <div class="big" style="color:var(--rtk)">${ht(s.total_saved || 0)}</div>
    <div class="big-label">tokens saved all-time</div>
    <div class="rows">
      <div class="row"><span class="row-label">Commands run</span><span class="row-val">${s.total_commands || 0}</span></div>
      <div class="row"><span class="row-label">Tokens in</span><span class="row-val">${ht(s.total_input || 0)}</span></div>
      <div class="row"><span class="row-label">Tokens out</span><span class="row-val">${ht(s.total_output || 0)}</span></div>
      <div class="row"><span class="row-label">Avg savings</span><span class="row-val" style="color:var(--rtk)">${pct(s.avg_savings_pct)}</span></div>
      <div class="row"><span class="row-label">Avg exec time</span><span class="row-val">${s.avg_time_ms || 0} ms</span></div>
      ${lastUsedRow(lastUsed)}
      ${userBreakdown(d.users || [], 'rtk')}
    </div>
  `;
}

// Active/inactive status pill for Caveman, driven by the mode in
// ~/.claude/.caveman-active. A real level (full/lite/ultra) = active (green,
// mode-colored); off / unknown / missing file = inactive (grey).
function cavemanStatusPill(mode) {
  const active = /^(full|lite|ultra)$/i.test(mode);
  if (active) {
    const col = MODE_COLORS[mode] || 'var(--success, #3fb950)';
    const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></span>`;
    const sub = `<span style="opacity:0.7;font-weight:500;text-transform:none;letter-spacing:0;margin-left:6px">${mode}</span>`;
    return `<div class="badge" style="background:${col}1a;color:${col};border:1px solid ${col}40">${dot}Caveman active${sub}</div>`;
  }
  const col = '#8b949e';
  const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></span>`;
  return `<div class="badge" style="background:${col}1a;color:${col};border:1px solid ${col}40">${dot}Caveman inactive</div>`;
}

function cavemanPill(d) {
  if (!d) return cavemanStatusPill('unknown');
  const mode = d.mode || 'unknown';
  if (d.active || /^(full|lite|ultra|wenyan|wenyan-lite|wenyan-ultra)$/i.test(mode)) {
    const col = MODE_COLORS[mode] || 'var(--success, #3fb950)';
    const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></span>`;
    const sub = `<span style="opacity:0.7;font-weight:500;text-transform:none;letter-spacing:0;margin-left:6px">${mode}</span>`;
    const label = d.source === 'install' ? 'Caveman installed' : 'Caveman active';
    return `<div class="badge" style="background:${col}1a;color:${col};border:1px solid ${col}40">${dot}${label}${sub}</div>`;
  }
  if (d.installed) {
    const col = 'var(--warn, #d29922)';
    const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></span>`;
    return `<div class="badge" style="background:${col}1a;color:${col};border:1px solid ${col}40">${dot}Caveman installed · off</div>`;
  }
  return cavemanStatusPill(mode);
}

export function renderCav(d, lastUsed) {
  if (!d) return '<div class="err">No Caveman data</div>';
  return `
    ${cavemanPill(d)}
    <div class="big" style="color:var(--caveman)">${ht(d.total_saved_tokens || 0)}</div>
    <div class="big-label">est. tokens saved</div>
    <div class="rows">
      <div class="row"><span class="row-label">Sessions logged</span><span class="row-val">${d.session_count || 0}</span></div>
      <div class="row"><span class="row-label">Output tokens</span><span class="row-val">${ht(d.total_output_tokens || 0)}</span></div>
      <div class="row"><span class="row-label">Est. USD saved</span><span class="row-val" style="color:var(--caveman)">${usd(d.total_saved_usd || 0)}</span></div>
      ${lastUsedRow(lastUsed)}
      ${userBreakdown(d.users || [], 'caveman')}
    </div>
  `;
}

export function renderHero(stats) {
  const rtkSaved = (stats.rtk && stats.rtk.summary) ? (stats.rtk.summary.total_saved || 0) : 0;
  const cavSaved = (stats.caveman) ? (stats.caveman.total_saved_tokens || 0) : 0;
  const hdrLife = stats.headroom && stats.headroom.savings && stats.headroom.savings.lifetime;
  const hdrSaved = hdrLife ? (hdrLife.tokens_saved || 0) : 0;
  const total = rtkSaved + cavSaved + hdrSaved;

  const lu = stats.last_used || {};
  const sub = (iso) => `<span class="chip-sub" title="${iso ? new Date(iso).toLocaleString() : 'no recorded activity'}">used ${timeAgo(iso)}</span>`;

  document.getElementById('hero-num').textContent = ht(total);
  document.getElementById('hero-chips').innerHTML = `
    <div class="chip" style="border-left-color:var(--rtk)">
      <span class="chip-label">RTK</span><span class="chip-val" style="color:var(--rtk)">${ht(rtkSaved)}</span>${sub(lu.rtk)}
    </div>
    <div class="chip" style="border-left-color:var(--caveman)">
      <span class="chip-label">Caveman</span><span class="chip-val" style="color:var(--caveman)">${ht(cavSaved)}</span>${sub(lu.caveman)}
    </div>
    <div class="chip" style="border-left-color:var(--headroom)">
      <span class="chip-label">Headroom</span><span class="chip-val" style="color:var(--headroom)">${ht(hdrSaved)}</span>${sub(lu.headroom)}
    </div>
    ${heroUsers(stats.users || [])}`;
}

