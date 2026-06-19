// ---- per-card HTML renderers ----
import { ht, pct, usd, usdFull, lastUsedRow, barColor, qpct, countdown, secsUntil, timeAgo } from './format.js';
import {
  MODE_COLORS,
  modelRaw, modelWeighted, modelUsd, modelUsdRaw,
} from './pricing.js';

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

export function renderRTK(d, lastUsed) {
  if (!d || d.error) return '<div class="err">No RTK data</div>';
  const s = d.summary || {};
  return `
    <div class="big" style="color:var(--rtk)">${ht(s.total_saved || 0)}</div>
    <div class="big-label">tokens saved all-time</div>
    <div class="rows">
      <div class="row"><span class="row-label">Commands run</span><span class="row-val">${s.total_commands || 0}</span></div>
      <div class="row"><span class="row-label">Tokens in</span><span class="row-val">${ht(s.total_input || 0)}</span></div>
      <div class="row"><span class="row-label">Tokens out</span><span class="row-val">${ht(s.total_output || 0)}</span></div>
      <div class="row"><span class="row-label">Avg savings</span><span class="row-val" style="color:var(--rtk)">${pct(s.avg_savings_pct)}</span></div>
      <div class="row"><span class="row-label">Avg exec time</span><span class="row-val">${s.avg_time_ms || 0} ms</span></div>
      ${lastUsedRow(lastUsed)}
    </div>
  `;
}

export function renderCav(d, lastUsed) {
  if (!d) return '<div class="err">No Caveman data</div>';
  const mode = d.mode || 'unknown';
  const col = MODE_COLORS[mode] || '#8b949e';
  return `
    <div class="badge" style="background:${col}1a;color:${col};border:1px solid ${col}40">${mode}</div>
    <div class="big" style="color:var(--caveman)">${ht(d.total_saved_tokens || 0)}</div>
    <div class="big-label">est. tokens saved</div>
    <div class="rows">
      <div class="row"><span class="row-label">Sessions logged</span><span class="row-val">${d.session_count || 0}</span></div>
      <div class="row"><span class="row-label">Output tokens</span><span class="row-val">${ht(d.total_output_tokens || 0)}</span></div>
      <div class="row"><span class="row-label">Est. USD saved</span><span class="row-val" style="color:var(--caveman)">${usd(d.total_saved_usd || 0)}</span></div>
      ${lastUsedRow(lastUsed)}
    </div>
  `;
}

// One usage progress bar. `sub` is {style, text}; `color` is a CSS color.
// Shared by the Cursor and Antigravity cards.
function usageBar(label, pctVal, sub, color = 'var(--cursor)', mb = 12) {
  return `
      <div class="prog-group" style="margin-bottom: ${mb}px;">
        <div class="prog-header" style="font-size: 13px; margin-bottom: 4px;">
          <span class="prog-label" style="font-weight: 500;">${label}</span>
          <span class="prog-pct" style="color:${color}; font-weight: 700;">${Math.round(pctVal)}%</span>
        </div>
        <div class="track" style="height: 6px; background: rgba(255,255,255,0.05);">
          <div class="fill" style="width:${Math.min(pctVal, 100)}%; background: ${color}; height: 100%; border-radius: 3px;"></div>
        </div>
        <div class="prog-sub" style="font-size: 11px; margin-top: 4px; ${sub.style}">${sub.text}</div>
      </div>`;
}

// One Cursor usage bar (Total / Auto+Composer / API). `sub` is {style, text}.
// Shared by the individual (planUsage) and team dashboards.
function cursorBar(label, pctVal, sub, mb = 12) {
  return usageBar(label, pctVal, sub, 'var(--cursor)', mb);
}
const CURSOR_SUB_AUTO = { style: 'opacity: 0.6; line-height: 1.3;', text: 'Additional usage beyond limits consumes API quota or on-demand spend.' };
const CURSOR_SUB_API = { style: 'opacity: 0.6; line-height: 1.3;', text: 'Additional usage beyond limits consumes on-demand spend. Your plan includes at least $20 of API usage.' };
const cursorTotalSub = (autoPct, apiPct) => ({ style: 'opacity: 0.8;', text: `${Math.round(autoPct)}% Auto and ${Math.round(apiPct)}% API used` });

// the three usage bars, identical between the individual and team dashboards
function cursorBars(totalPct, autoPct, apiPct) {
  return `
      ${cursorBar('Total', totalPct, cursorTotalSub(autoPct, apiPct))}
      ${cursorBar('Auto + Composer', autoPct, CURSOR_SUB_AUTO)}
      ${cursorBar('API', apiPct, CURSOR_SUB_API, 16)}`;
}

export function renderCursor(d) {
  if (!d || d.error) return `<div class="err">${d && d.error ? d.error : 'No Cursor data'}</div>`;

  if (d.planUsage) {
    const autoPct = d.planUsage.autoPercentUsed || 0;
    const apiPct = d.planUsage.apiPercentUsed || 0;
    const totalPct = Math.max(autoPct, apiPct);
    return cursorBars(totalPct, autoPct, apiPct);
  }

  const members = d.teamMemberSpend || (d.group && d.group.members) || [];
  if (members.length === 0) {
    return '<div class="err">No spending data available</div>';
  }

  let totalSpendCents = 0;
  let totalFastRequests = 0;
  for (const m of members) {
    totalSpendCents += m.spendCents || 0;
    totalFastRequests += m.fastPremiumRequests || 0;
  }
  const totalSpendUsd = totalSpendCents / 100;

  const totalMembers = d.totalMembers || (d.group && d.group.memberCount) || members.length || 1;

  // Auto % = (Total Fast Requests) / (totalMembers * 500) * 100
  const autoLimit = totalMembers * 500;
  const autoPct = autoLimit > 0 ? (totalFastRequests / autoLimit) * 100 : 0;

  // API % = (Total Spend Cents) / (totalMembers * 2000) * 100
  const apiLimitCents = totalMembers * 2000;
  const apiPct = apiLimitCents > 0 ? (totalSpendCents / apiLimitCents) * 100 : 0;

  // Total % = Math.max(Auto %, API %)
  const totalPct = Math.max(autoPct, apiPct);

  let cycleStartStr = '—';
  const cycleStartVal = d.subscriptionCycleStart || (d.billingCycle && d.billingCycle.cycleStart);
  if (cycleStartVal) {
    const dateObj = new Date(isNaN(cycleStartVal) ? cycleStartVal : parseInt(cycleStartVal));
    if (!isNaN(dateObj.getTime())) {
      // Format as UTC to prevent timezone offsets shifting the date
      cycleStartStr = `${dateObj.getUTCMonth() + 1}/${dateObj.getUTCDate()}/${dateObj.getUTCFullYear()}`;
    }
  }

  const formatNum = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n;

  return `
    ${cursorBars(totalPct, autoPct, apiPct)}

    <div class="divider" style="margin: 12px 0 12px 0;"></div>

    <div class="rows">
      <div class="row">
        <span class="row-label">Total Team Spend</span>
        <span class="row-val" style="color:var(--cursor); font-weight:700;">$${totalSpendUsd.toFixed(2)}</span>
      </div>
      <div class="row">
        <span class="row-label">Total Fast Requests</span>
        <span class="row-val" style="color:var(--cursor); font-weight:700;">${formatNum(totalFastRequests)}</span>
      </div>
      <div class="row">
        <span class="row-label">Billing Cycle Start</span>
        <span class="row-val">${cycleStartStr}</span>
      </div>
    </div>

    <div class="divider" style="margin: 12px 0 8px 0;"></div>
    <div class="tcell-label" style="margin-bottom:6px">Member Spending</div>
    <div class="pricing-table-container" style="max-height: 200px; overflow-y: auto; border: 1px solid var(--grid); border-radius: 4px;">
      <table class="pricing-table" style="font-size: 11px; width: 100%; border-collapse: collapse; margin-top: 0;">
        <thead>
          <tr style="background: rgba(255,255,255,0.02); text-align: left; border-bottom: 1px solid var(--grid);">
            <th style="padding: 6px 8px;">Member</th>
            <th style="padding: 6px 8px; text-align: right;">Fast Reqs</th>
            <th style="padding: 6px 8px; text-align: right;">Spend</th>
            <th style="padding: 6px 8px; text-align: right;">Limit</th>
          </tr>
        </thead>
        <tbody>
          ${members.map(m => {
            const name = m.name || m.email.split('@')[0];
            const limitStr = m.monthlyLimitDollars ? `$${m.monthlyLimitDollars}` : '—';
            const memberSpendUsd = (m.spendCents || 0) / 100;
            return `
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.02);">
                <td style="padding: 6px 8px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 90px;" title="${m.email}">${name}</td>
                <td style="padding: 6px 8px; text-align: right;">${m.fastPremiumRequests || 0}</td>
                <td style="padding: 6px 8px; text-align: right; color: var(--cursor); font-weight: 600;">$${memberSpendUsd.toFixed(2)}</td>
                <td style="padding: 6px 8px; text-align: right; opacity: 0.7;">${limitStr}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

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
      html += usageBar(agyLimitLabel(lim.label), remPct(lim), agyLimitSub(lim), 'var(--antigravity)', mb);
    });
  }

  if (d.stale) {
    html += `<div class="prog-sub" style="opacity:0.5; font-size:11px;">⚠ showing last successful poll${d.error ? ` (${d.error})` : ''}</div>`;
  } else if (d.polled_at) {
    html += `<div class="prog-sub" style="opacity:0.45; font-size:11px;">polled ${new Date(d.polled_at).toLocaleTimeString()}</div>`;
  }
  return html;
}

function quotaBar(label, pctVal, resetSecs) {
  const v = pctVal || 0;
  return `
    <div class="prog-group">
      <div class="prog-header">
        <span class="prog-label">${label}</span>
        <span class="prog-pct" style="color:${barColor(v)}">${qpct(v)}%</span>
      </div>
      <div class="track"><div class="fill" style="width:${Math.min(v, 100)}%;background:${barColor(v)}"></div></div>
      ${resetSecs != null ? `<div class="prog-sub">${countdown(resetSecs)}</div>` : ''}
    </div>`;
}

// Claude plan usage (session / weekly limits). Sourced from Headroom's poll of
// the Claude quota API, but it's Claude's data — shown in its own card.
export function renderClaude(d) {
  if (!d || d.error) return '<div class="err">No Claude quota data</div>';
  const lt = d.latest || {};
  const fh = lt.five_hour || {};
  const sd = lt.seven_day || {};
  const ss = lt.seven_day_sonnet || {};
  const have = (fh.utilization_pct != null) || (sd.utilization_pct != null) || (ss.utilization_pct != null);
  if (!have) return '<div class="err">Claude quota unavailable (Headroom hasn\'t polled yet)</div>';
  return `
    ${quotaBar('Current session (5h)', fh.utilization_pct, secsUntil(fh.resets_at))}
    ${quotaBar('Weekly · all models (7d)', sd.utilization_pct, secsUntil(sd.resets_at))}
    ${quotaBar('Weekly · Sonnet (7d)', ss.utilization_pct, secsUntil(ss.resets_at))}
  `;
}

// Live up/down pill for the Headroom proxy, driven by collectors.js's /health
// probe. Healthy = green, degraded = amber, down = red.
function headroomHealthPill(h) {
  if (!h) return '';
  let col, label, detail;
  if (h.ok) {
    col = 'var(--success, #3fb950)';
    label = 'Proxy online';
    const bits = [];
    if (h.version) bits.push('v' + h.version);
    if (h.uptime_seconds != null) bits.push('up ' + timeAgo(new Date(Date.now() - h.uptime_seconds * 1000).toISOString()).replace(' ago', ''));
    detail = bits.join(' · ');
  } else if (h.reachable) {
    col = 'var(--warn, #d29922)';
    label = 'Proxy degraded';
    detail = h.error || h.status || '';
  } else {
    col = 'var(--danger, #f85149)';
    label = 'Proxy offline';
    detail = h.error || 'not reachable';
  }
  const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></span>`;
  const sub = detail ? `<span style="opacity:0.7;font-weight:500;text-transform:none;letter-spacing:0;margin-left:6px">${detail}</span>` : '';
  return `<div class="badge" style="background:${col}1a;color:${col};border:1px solid ${col}40">${dot}${label}${sub}</div>`;
}

export function renderHdr(d) {
  const wt = (d && d.window_tokens) || {};
  const sav = (d && d.savings) || null;
  const pill = headroomHealthPill(d && d.health);
  const hasTelemetry = !!(wt.total_raw || wt.input || wt.cache_reads);
  if (!sav && !hasTelemetry) return pill + '<div class="err">No Headroom data</div>';

  // Authoritative savings — straight from Headroom's proxy_savings.json ledger
  // (the same numbers `headroom perf` reports). Cumulative, never resets.
  const life = (sav && sav.lifetime) || {};
  const sess = (sav && sav.display_session) || {};
  const savedTok = life.tokens_saved || 0;
  const savedUsd = life.compression_savings_usd || 0;
  const reqs = life.requests || 0;
  const savePct = sess.savings_percent || 0;

  return `
    ${pill}
    <div class="big" style="color:var(--headroom)">${ht(savedTok)}</div>
    <div class="big-label">tokens saved by proxy</div>
    <div class="rows">
      <div class="row" title="Compression savings in USD, from Headroom's proxy_savings.json ledger (lifetime.compression_savings_usd).">
        <span class="row-label">USD saved <span class="info">?</span></span>
        <span class="row-val" style="color:var(--headroom)">${usd(savedUsd)}</span>
      </div>
      <div class="row"><span class="row-label">Savings</span><span class="row-val" style="color:var(--headroom)">${pct(savePct)}</span></div>
      <div class="row"><span class="row-label">Requests</span><span class="row-val">${reqs}</span></div>
    </div>
    <div class="divider"></div>
    <div class="tcell-label" style="margin-bottom:8px">Live window telemetry <span style="opacity:0.6">(current quota window — usage, not savings; resets each window)</span></div>
    <div class="token-grid">
      <div class="tcell">
        <div class="tcell-label">Input</div>
        <div class="tcell-val" style="color:var(--rtk)">${ht(wt.input || 0)}</div>
      </div>
      <div class="tcell">
        <div class="tcell-label">Output</div>
        <div class="tcell-val" style="color:var(--rtk)">${ht(wt.output || 0)}</div>
      </div>
      <div class="tcell">
        <div class="tcell-label">Cache reads</div>
        <div class="tcell-val" style="color:var(--headroom)">${ht(wt.cache_reads || 0)}</div>
      </div>
      <div class="tcell">
        <div class="tcell-label">Weighted total</div>
        <div class="tcell-val" style="color:var(--headroom)">${ht(wt.weighted_token_equivalent || 0)}</div>
      </div>
    </div>
    <div class="rows">
      <div class="row" title="Raw = every token counted at face value. Weighted = the effective billable equivalent after cache discounts (reads ~10%, writes weighted by TTL). Weighted below raw means caching is cutting real cost.">
        <span class="row-label">Raw → weighted <span class="info">?</span></span>
        <span class="row-val">${ht(wt.total_raw || 0)} → ${ht(wt.weighted_token_equivalent || 0)}</span>
      </div>
    </div>
    <details class="explain">
      <summary>What is raw vs weighted? <span class="info">?</span></summary>
      <div class="explain-body">
        <p><strong>Not all tokens cost the same.</strong> The API charges different rates by token type. Raw ignores that; weighted accounts for it.</p>
        <ul>
          <li><strong>Raw</strong> — every token counted as 1, whatever its type. A plain sum.</li>
          <li><strong>Weighted</strong> — each token scaled by what it actually costs vs a normal input token. The real bill.</li>
        </ul>
        <table class="explain-tbl">
          <tr><th>Token type</th><th>Count</th><th>Rel. cost</th></tr>
          <tr><td>Fresh input</td><td>${ht(wt.input || 0)}</td><td>1×</td></tr>
          <tr><td>Output</td><td>${ht(wt.output || 0)}</td><td>most</td></tr>
          <tr><td>Cache reads</td><td>${ht(wt.cache_reads || 0)}</td><td>~0.1× (cheap)</td></tr>
          <tr><td>Cache writes 5m</td><td>${ht(wt.cache_writes_5m || 0)}</td><td>~1.25×</td></tr>
          <tr><td>Cache writes 1h</td><td>${ht(wt.cache_writes_1h || 0)}</td><td>~2×</td></tr>
          <tr class="tbl-sum"><td>Raw total</td><td>${ht(wt.total_raw || 0)}</td><td>—</td></tr>
          <tr class="tbl-sum"><td>Weighted total</td><td>${ht(wt.weighted_token_equivalent || 0)}</td><td>—</td></tr>
        </table>
        <p><strong>Why weighted is lower:</strong> cache reads are ${wt.total_raw ? Math.round((wt.cache_reads || 0) / wt.total_raw * 100) : 0}% of all tokens but billed at ~10%. That discount pulls weighted below raw.</p>
        <div class="cmp">
          <div class="cmp-row"><span class="cmp-tag">Raw</span><span class="cmp-track"><span class="cmp-fill" style="width:100%;background:var(--muted)"></span></span><span class="cmp-n">${ht(wt.total_raw || 0)}</span></div>
          <div class="cmp-row"><span class="cmp-tag">Weighted</span><span class="cmp-track"><span class="cmp-fill" style="width:${wt.total_raw ? (wt.weighted_token_equivalent / wt.total_raw * 100).toFixed(0) : 0}%;background:var(--headroom)"></span></span><span class="cmp-n">${ht(wt.weighted_token_equivalent || 0)}</span></div>
        </div>
        <p class="explain-note">The gap = your caching discount. Bigger gap = more saved. Weighted equal to raw would mean zero cache benefit.</p>
      </div>
    </details>
    ${renderModels(wt.by_model)}
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
    </div>`;
}
