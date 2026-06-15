// ---- theme ----
function tc(name) {
  return getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim() || '#888';
}
function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  try { localStorage.setItem('ltm-theme', mode); } catch { }
  document.querySelectorAll('#theme-toggle button').forEach(b =>
    b.classList.toggle('active', b.dataset.themeVal === mode));
  redrawAllCharts();
}
function initTheme() {
  let saved = 'auto';
  try { saved = localStorage.getItem('ltm-theme') || 'auto'; } catch { }
  document.documentElement.setAttribute('data-theme', saved);
  document.querySelectorAll('#theme-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.themeVal === saved);
    b.addEventListener('click', () => applyTheme(b.dataset.themeVal));
  });
  // when in auto mode, repaint charts if the OS theme flips
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if ((document.documentElement.getAttribute('data-theme')) === 'auto') redrawAllCharts();
    });
  }
}
function redrawAllCharts() {
  if (rtkChart) { rtkChart.destroy(); rtkChart = null; }
  Object.values(histCharts).forEach(c => c && c.destroy());
  for (const k of Object.keys(histCharts)) delete histCharts[k];
  if (lastStats && lastStats.rtk && (lastStats.rtk.daily || []).length) drawRTKChart(lastStats.rtk.daily);
  renderHistory();
}

let rtkChart = null;
let lastStats = null;

const MODE_COLORS = {
  full: '#d4a72c', ultra: '#f97316', lite: '#fbbf24',
  'wenyan-lite': '#a78bfa', 'wenyan-full': '#8b5cf6',
  'wenyan-ultra': '#7c3aed', wenyan: '#8b5cf6',
  off: '#6b7280', commit: '#58a6ff', review: '#3fb950', compress: '#38bdf8',
};

function ht(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
function pct(n) { return (n === null || n === undefined) ? '—' : n.toFixed(1) + '%'; }
// compact relative time, e.g. "3m ago" / "2h ago" / "5d ago". Returns 'never' when no data.
function timeAgo(iso) {
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
function lastUsedRow(iso) {
  const title = iso ? new Date(iso).toLocaleString() : 'no recorded activity';
  return `<div class="row"><span class="row-label">Last used</span><span class="row-val" title="${title}">${timeAgo(iso)}</span></div>`;
}
function usd(n) { return (n === null || n === undefined) ? '—' : '$' + n.toFixed(4); }
function usdFull(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(3);
  return '$' + n.toFixed(4);
}
function countdown(secs) {
  if (!secs || secs <= 0) return '';
  if (secs > 86400) return `resets in ${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
  if (secs > 3600) return `resets in ${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `resets in ${Math.floor(secs / 60)}m`;
}

// Headroom stores seconds_to_reset frozen at poll time, so it goes stale
// between polls. resets_at is an absolute timestamp — compute remaining live
// against the clock so the countdown matches Claude's own display.
function secsUntil(resetsAt) {
  if (!resetsAt) return null;
  const t = Date.parse(resetsAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((t - Date.now()) / 1000));
}
function barColor(p) {
  return p > 80 ? '#f85149' : p > 60 ? '#d29922' : '#3fb950';
}

// cache reads are billed ~10% of input price → ~90% saved vs uncached
function cacheSavings(wt) {
  return Math.round((wt.cache_reads || 0) * 0.9);
}

// Universal Claude billing ratios (in units of that model's input token):
// output 5×, cache-read 0.1×, cache-write-5m 1.25×, cache-write-1h 2×.
function modelRaw(m) {
  return (m.input || 0) + (m.output || 0) + (m.cache_reads || 0) + (m.cache_writes_total || 0);
}
function modelWeighted(m) {
  const writes5m = m.cache_writes_5m || 0;
  const writes1h = m.cache_writes_1h || 0;
  // fall back to total at 1.25× if the 5m/1h split is absent
  const writeW = (writes5m || writes1h) ? writes5m * 1.25 + writes1h * 2 : (m.cache_writes_total || 0) * 1.25;
  return Math.round((m.input || 0) * 1 + (m.output || 0) * 5 + (m.cache_reads || 0) * 0.1 + writeW);
}

// USD per million tokens by category. Matched to model name by prefix.
// cache rates: read 0.1×, write-5m 1.25×, write-1h 2× of input price.
const PRICING = [
  ['claude-opus-4', { in: 5, out: 25, cr: 0.50, cw5: 6.25, cw1: 10 }],
  ['claude-sonnet-4', { in: 3, out: 15, cr: 0.30, cw5: 3.75, cw1: 6 }],
  ['claude-haiku-4', { in: 1, out: 5, cr: 0.10, cw5: 1.25, cw1: 2 }],
  ['claude-fable-5', { in: 10, out: 50, cr: 1.00, cw5: 12.50, cw1: 20 }],
  ['antigravity-3.5-flash', { in: 1.5, out: 9, cr: 0.15, cw5: 1.875, cw1: 3.0 }],
  ['gemini-3.5-flash', { in: 1.5, out: 9, cr: 0.15, cw5: 1.875, cw1: 3.0 }],
  ['antigravity-3.1-pro', { in: 2, out: 12, cr: 0.20, cw5: 2.50, cw1: 4.0 }],
  ['gemini-3.1-pro', { in: 2, out: 12, cr: 0.20, cw5: 2.50, cw1: 4.0 }],
  ['cursor-opus', { in: 5, out: 25, cr: 0.50, cw5: 6.25, cw1: 10 }],
  ['cursor-sonnet', { in: 3, out: 15, cr: 0.30, cw5: 3.75, cw1: 6 }],
  ['cursor-haiku', { in: 1, out: 5, cr: 0.10, cw5: 1.25, cw1: 2 }],
  ['cursor-small', { in: 0.1, out: 0.5, cr: 0.01, cw5: 0.125, cw1: 0.2 }],
];
function priceFor(name) {
  for (const [prefix, p] of PRICING) if (name.startsWith(prefix)) return p;
  return null;
}
// real (weighted) cost — cache reads/writes at discounted/premium rates
function modelUsd(name, m) {
  const p = priceFor(name);
  if (!p) return null;
  const writes5m = m.cache_writes_5m || 0;
  const writes1h = m.cache_writes_1h || 0;
  const writeUsd = (writes5m || writes1h)
    ? writes5m * p.cw5 + writes1h * p.cw1
    : (m.cache_writes_total || 0) * p.cw5;
  return ((m.input || 0) * p.in + (m.output || 0) * p.out + (m.cache_reads || 0) * p.cr + writeUsd) / 1e6;
}
// raw cost — every cache token billed at full input price (no caching)
function modelUsdRaw(name, m) {
  const p = priceFor(name);
  if (!p) return null;
  const cacheAll = (m.cache_reads || 0) + (m.cache_writes_total || 0);
  return ((m.input || 0) * p.in + (m.output || 0) * p.out + cacheAll * p.in) / 1e6;
}

function renderModels(byModel) {
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

function renderRTK(d, lastUsed) {
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

function renderCav(d, lastUsed) {
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

// One Cursor usage bar (Total / Auto+Composer / API). `sub` is {style, text}.
// Shared by the individual (planUsage) and team dashboards.
function cursorBar(label, pctVal, sub, mb = 12) {
  return `
      <div class="prog-group" style="margin-bottom: ${mb}px;">
        <div class="prog-header" style="font-size: 13px; margin-bottom: 4px;">
          <span class="prog-label" style="font-weight: 500;">${label}</span>
          <span class="prog-pct" style="color:var(--cursor); font-weight: 700;">${Math.round(pctVal)}%</span>
        </div>
        <div class="track" style="height: 6px; background: rgba(255,255,255,0.05);">
          <div class="fill" style="width:${Math.min(pctVal, 100)}%; background: var(--cursor); height: 100%; border-radius: 3px;"></div>
        </div>
        <div class="prog-sub" style="font-size: 11px; margin-top: 4px; ${sub.style}">${sub.text}</div>
      </div>`;
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

function renderCursor(d) {
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

// quota % can be a small fraction (e.g. 0.4%); never round a nonzero value down
// to 0 — show at least 1% so "in use" is visible (matches Claude's own display).
function qpct(p) { return p > 0 ? Math.max(1, Math.round(p)) : 0; }

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
function renderClaude(d) {
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

function renderHdr(d) {
  if (!d || d.error) return '<div class="err">No Headroom data</div>';
  const wt = d.window_tokens || {};
  const contrib = d.contribution || {};
  const saved = contrib.tokens_saved || {};

  return `
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
    <div class="divider"></div>
    <div class="rows">
      <div class="row" title="Cache reads are billed at ~10% of normal input price. This is the token-equivalent you avoided paying full price for (cache_reads × 0.9).">
        <span class="row-label">Cache savings <span class="info">?</span></span>
        <span class="row-val" style="color:var(--headroom)">${ht(cacheSavings(wt))}</span>
      </div>
      <div class="row" title="Raw = every token counted at face value. Weighted = the effective billable equivalent after cache discounts (reads ~10%, writes weighted by TTL). Weighted below raw means caching is cutting real cost.">
        <span class="row-label">Raw → weighted <span class="info">?</span></span>
        <span class="row-val">${ht(wt.total_raw || 0)} → ${ht(wt.weighted_token_equivalent || 0)}</span>
      </div>
      ${saved.total ? `<div class="row" title="Tokens removed by the Headroom proxy's active transforms (compression, filtering). Only nonzero while the proxy is running and processing traffic.">
        <span class="row-label">Proxy saved <span class="info">?</span></span><span class="row-val" style="color:var(--headroom)">${ht(saved.total)}</span></div>
      <div class="row"><span class="row-label">Efficiency</span><span class="row-val" style="color:var(--headroom)">${pct(contrib.efficiency_pct)}</span></div>` : ''}
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

function drawRTKChart(daily) {
  const wrap = document.getElementById('rtk-chart-wrap');
  const canvas = document.getElementById('rtk-chart');
  if (!canvas) return;

  if (!daily || !daily.length) {
    if (wrap) wrap.style.display = 'none';
    return;
  }
  if (wrap) wrap.style.display = 'block';

  const data14 = daily.slice(-14);
  const labels = data14.map(d => d.date.slice(5));
  const vals = data14.map(d => d.saved_tokens || 0);

  if (rtkChart) {
    rtkChart.data.labels = labels;
    rtkChart.data.datasets[0].data = vals;
    rtkChart.update('none');
    return;
  }
  const barLabels = {
    id: 'rtkBarLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.fillStyle = tc('muted');
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      meta.data.forEach((bar, i) => {
        const v = chart.data.datasets[0].data[i];
        if (!v) return;
        ctx.fillText(ht(v), bar.x, bar.y - 2);
      });
      ctx.restore();
    },
  };
  rtkChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: vals,
        backgroundColor: 'rgba(88,166,255,0.45)',
        borderColor: '#58a6ff',
        borderWidth: 1,
        borderRadius: 2,
      }],
    },
    plugins: [barLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 14 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${ht(c.raw)} saved` } },
      },
      scales: {
        x: { ticks: { color: tc('muted'), font: { size: 10 } }, grid: { color: tc('grid') } },
        y: { ticks: { color: tc('muted'), font: { size: 10 }, callback: v => ht(v) }, grid: { color: tc('grid') } },
      },
    },
  });
}

function renderHero(stats) {
  const rtkSaved = (stats.rtk && stats.rtk.summary) ? (stats.rtk.summary.total_saved || 0) : 0;
  const cavSaved = (stats.caveman) ? (stats.caveman.total_saved_tokens || 0) : 0;
  const hdrSaved = (stats.headroom && stats.headroom.window_tokens) ? cacheSavings(stats.headroom.window_tokens) : 0;
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
      <span class="chip-label">Headroom cache</span><span class="chip-val" style="color:var(--headroom)">${ht(hdrSaved)}</span>${sub(lu.headroom)}
    </div>`;
}

let explainOpen = false;  // persists the raw-vs-weighted panel across refreshes

function render(stats) {
  lastStats = stats;
  renderHero(stats);
  const lu = stats.last_used || {};
  document.getElementById('rtk').innerHTML = renderRTK(stats.rtk, lu.rtk);
  document.getElementById('cav').innerHTML = renderCav(stats.caveman, lu.caveman);

  const cursorCard = document.getElementById('cursor-card');
  if (stats.cursor && stats.cursor.disabled) {
    if (cursorCard) cursorCard.style.display = 'none';
  } else {
    if (cursorCard) cursorCard.style.display = 'block';
    const curEl = document.getElementById('cur');
    if (curEl) curEl.innerHTML = renderCursor(stats.cursor);
  }

  const claudeEl = document.getElementById('claude');
  if (claudeEl) claudeEl.innerHTML = renderClaude(stats.headroom);

  // skip rebuilding the Headroom card while the explainer is open — don't interrupt reading
  if (!explainOpen) {
    document.getElementById('hdr').innerHTML = renderHdr(stats.headroom);
    const ex = document.querySelector('.explain');
    if (ex) {
      ex.open = explainOpen;
      ex.addEventListener('toggle', () => { explainOpen = ex.open; });
    }
  }

  if (stats.rtk && !stats.rtk.error && (stats.rtk.daily || []).length) {
    setTimeout(() => drawRTKChart(stats.rtk.daily), 0);
  } else {
    const wrap = document.getElementById('rtk-chart-wrap');
    if (wrap) wrap.style.display = 'none';
  }

  const d = new Date(stats.timestamp);
  document.getElementById('ts').textContent = 'updated ' + d.toLocaleTimeString();
  document.getElementById('dot').className = 'dot live';
  resetCountdown(stats.refresh_ms || 10000);
  startClock(stats.refresh_ms || 10000);
}

// ---- auto-refresh countdown ----
let cdRemaining = 10;
let cdTimer = null;
function resetCountdown(refreshMs) {
  cdRemaining = Math.round(refreshMs / 1000);
  const el = document.getElementById('countdown');
  if (cdTimer) clearInterval(cdTimer);
  el.textContent = cdRemaining + 's';
  cdTimer = setInterval(() => {
    cdRemaining = Math.max(0, cdRemaining - 1);
    el.textContent = cdRemaining + 's';
  }, 1000);
}

// ---- live wall-clock tick ----
// SSE pushes only every REFRESH_MS, and Headroom polls every ~5min, so any
// clock-derived value (quota reset countdowns, "used Xago") would otherwise sit
// frozen between updates. Re-render those bits at the refresh cadence from the
// last snapshot — secsUntil/timeAgo recompute against Date.now(), so they tick.
let clockTimer = null;
function clockTick() {
  if (!lastStats) return;
  renderHero(lastStats); // refreshes "used Xago" chips (no chart, safe to rebuild)
  const claudeEl = document.getElementById('claude');
  if (claudeEl) claudeEl.innerHTML = renderClaude(lastStats.headroom);
}
// tick at the same cadence as the auto-refresh countdown (stats.refresh_ms)
function startClock(refreshMs) {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(clockTick, refreshMs);
}

// manual refresh — pulls a fresh snapshot immediately via /api/stats
async function manualRefresh() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/stats');
    render(await r.json());
  } catch (err) { console.error(err); }
  btn.disabled = false;
}
document.getElementById('refresh-btn').addEventListener('click', manualRefresh);

function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = e => {
    try { render(JSON.parse(e.data)); } catch (err) { console.error(err); }
  };
  es.onerror = () => {
    document.getElementById('dot').className = 'dot error';
    document.getElementById('ts').textContent = 'reconnecting…';
    if (cdTimer) clearInterval(cdTimer);
    document.getElementById('countdown').textContent = '—';
    es.close();
    setTimeout(connect, 5000);
  };
}

initTheme();
connect();

// ============ HISTORY CHARTS ============
let histData = [];
let histRangeMin = 360; // default 6h
try { const s = localStorage.getItem('ltm-range'); if (s !== null) histRangeMin = Number(s); } catch { }
const histCharts = {};

function filterHist() {
  if (!histRangeMin) return histData;
  const cutoff = Date.now() - histRangeMin * 60000;
  return histData.filter(r => r.t >= cutoff);
}

const hcBase = (extra) => ({
  type: 'line',
  options: {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: tc('muted'), font: { size: 11 }, boxWidth: 12, padding: 8 } },
      tooltip: { callbacks: extra.tooltip || {} },
    },
    elements: { point: { radius: 0, hitRadius: 8 }, line: { tension: 0.25, borderWidth: 2 } },
    scales: {
      x: { ticks: { color: tc('muted'), font: { size: 10 }, maxTicksLimit: 6 }, grid: { color: tc('grid') } },
      y: { ticks: { color: tc('muted'), font: { size: 10 }, callback: extra.yfmt }, grid: { color: tc('grid') }, beginAtZero: true },
      ...(extra.y1fmt ? {
        y1: {
          position: 'right', beginAtZero: true,
          ticks: { color: tc('muted'), font: { size: 10 }, callback: extra.y1fmt },
          grid: { drawOnChartArea: false },
        }
      } : {}),
    },
  },
});

function drawLine(id, labels, datasets, yfmt, tipfmt, y1fmt) {
  const cv = document.getElementById(id);
  if (!cv) return;
  if (histCharts[id]) {
    histCharts[id].data.labels = labels;
    histCharts[id].data.datasets = datasets;
    histCharts[id].update('none');
    return;
  }
  const cfg = hcBase({ yfmt, tooltip: { label: tipfmt }, y1fmt });
  cfg.data = { labels, datasets };
  histCharts[id] = new Chart(cv.getContext('2d'), cfg);
}

function renderHistory() {
  const rows = filterHist();
  if (rows.length < 2) return;

  const labels = rows.map(r => new Date(r.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  const ds = (data, color, label) => ({ label, data, borderColor: color, backgroundColor: color + '22', fill: false });

  // 1. tokens saved — RTK/Caveman (~100k–400k) share the left axis; Headroom
  // cache (tens of M) gets its own right axis so the small series stay readable.
  drawLine('hc-saved', labels, [
    ds(rows.map(r => r.rtk?.saved || 0), '#58a6ff', 'RTK'),
    ds(rows.map(r => r.cav?.saved || 0), '#d4a72c', 'Caveman'),
    { ...ds(rows.map(r => r.hr?.cacheSave || 0), '#3fb950', 'Headroom cache (right)'), yAxisID: 'y1' },
  ], ht, c => ` ${c.dataset.label}: ${ht(c.raw)}`, ht);

  // 2. cost raw/real/saved
  drawLine('hc-cost', labels, [
    ds(rows.map(r => r.hr?.rawUsd || 0), tc('muted'), 'raw'),
    ds(rows.map(r => r.hr?.usd || 0), '#d4a72c', 'real'),
    ds(rows.map(r => r.hr?.saved || 0), '#3fb950', 'saved'),
  ], v => '$' + v.toFixed(0), c => ` ${c.dataset.label}: ${usdFull(c.raw)}`);
}

async function fetchHistory() {
  try {
    const r = await fetch('/api/history');
    histData = await r.json();
    renderHistory();
  } catch (err) { console.error(err); }
}

document.querySelectorAll('.rng').forEach(btn => {
  // restore active state from saved range
  btn.classList.toggle('active', Number(btn.dataset.min) === histRangeMin);
  btn.addEventListener('click', () => {
    document.querySelectorAll('.rng').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    histRangeMin = Number(btn.dataset.min);
    try { localStorage.setItem('ltm-range', String(histRangeMin)); } catch { }
    renderHistory();
  });
});

fetchHistory();
setInterval(fetchHistory, 60000);

// ============ SETTINGS MODAL & LOGIC ============
const settingsBtn = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsClose = document.getElementById('settings-close');
const settingsCancel = document.getElementById('settings-cancel');
const settingsSave = document.getElementById('settings-save');
const cursorEnabledCb = document.getElementById('set-cursor-enabled');
const cursorTokenGroup = document.getElementById('set-cursor-token-group');
const pricingTableBody = document.getElementById('pricing-table-body');
const addPricingRowBtn = document.getElementById('btn-add-pricing-row');

cursorEnabledCb.addEventListener('change', () => {
  cursorTokenGroup.style.display = cursorEnabledCb.checked ? 'flex' : 'none';
});

const toggleCursorTokenBtn = document.getElementById('toggle-cursor-token');
const eyeIconClosed = document.getElementById('eye-icon-closed');
const eyeIconOpen = document.getElementById('eye-icon-open');
const cursorTokenInput = document.getElementById('set-cursor-token');

toggleCursorTokenBtn.addEventListener('click', () => {
  if (cursorTokenInput.type === 'password') {
    cursorTokenInput.type = 'text';
    eyeIconClosed.style.display = 'none';
    eyeIconOpen.style.display = 'block';
  } else {
    cursorTokenInput.type = 'password';
    eyeIconClosed.style.display = 'block';
    eyeIconOpen.style.display = 'none';
  }
});

async function loadSettingsUI() {
  try {
    const res = await fetch('/api/settings');
    const config = await res.json();

    cursorEnabledCb.checked = config.CURSOR_ENABLED !== false;
    cursorTokenGroup.style.display = cursorEnabledCb.checked ? 'flex' : 'none';

    document.getElementById('set-cursor-token').value = config.CURSOR_ACCESS_TOKEN || '';
    document.getElementById('set-rtk-home').value = config.RTK_DATA_HOME || '';
    document.getElementById('set-headroom-path').value = config.HEADROOM_SAVINGS_PATH || '';

    pricingTableBody.innerHTML = '';
    const pricing = config.PRICING || [];
    for (const [prefix, cost] of pricing) {
      addPricingRow(prefix, cost);
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function addPricingRow(prefix = '', cost = { in: 0, out: 0, cr: 0, cw5: 0, cw1: 0 }) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="px-prefix" value="${prefix}" placeholder="model-prefix"></td>
    <td><input type="number" step="any" class="px-num px-in" value="${cost.in || 0}"></td>
    <td><input type="number" step="any" class="px-num px-out" value="${cost.out || 0}"></td>
    <td><input type="number" step="any" class="px-num px-cr" value="${cost.cr || 0}"></td>
    <td><input type="number" step="any" class="px-num px-cw5" value="${cost.cw5 || 0}"></td>
    <td><input type="number" step="any" class="px-num px-cw1" value="${cost.cw1 || 0}"></td>
    <td style="text-align:center;"><button class="btn-del-pricing">&times;</button></td>
  `;
  tr.querySelector('.btn-del-pricing').addEventListener('click', () => tr.remove());
  pricingTableBody.appendChild(tr);
}

addPricingRowBtn.addEventListener('click', (e) => {
  e.preventDefault();
  addPricingRow();
});

settingsBtn.addEventListener('click', () => {
  loadSettingsUI().then(() => {
    settingsOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
});

const closeModal = () => {
  settingsOverlay.classList.remove('open');
  document.body.style.overflow = '';
};
settingsClose.addEventListener('click', closeModal);
settingsCancel.addEventListener('click', closeModal);

settingsSave.addEventListener('click', async () => {
  const updatedPricing = [];
  const rows = pricingTableBody.querySelectorAll('tr');
  for (const row of rows) {
    const prefix = row.querySelector('.px-prefix').value.trim();
    if (!prefix) continue;

    updatedPricing.push([
      prefix,
      {
        in: parseFloat(row.querySelector('.px-in').value) || 0,
        out: parseFloat(row.querySelector('.px-out').value) || 0,
        cr: parseFloat(row.querySelector('.px-cr').value) || 0,
        cw5: parseFloat(row.querySelector('.px-cw5').value) || 0,
        cw1: parseFloat(row.querySelector('.px-cw1').value) || 0
      }
    ]);
  }

  const body = {
    CURSOR_ENABLED: cursorEnabledCb.checked,
    CURSOR_ACCESS_TOKEN: document.getElementById('set-cursor-token').value,
    RTK_DATA_HOME: document.getElementById('set-rtk-home').value,
    HEADROOM_SAVINGS_PATH: document.getElementById('set-headroom-path').value,
    PRICING: updatedPricing
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();
    if (result.success) {
      if (result.settings && result.settings.PRICING) {
        PRICING.length = 0;
        result.settings.PRICING.forEach(item => PRICING.push(item));
      }
      closeModal();
      manualRefresh();
    } else {
      alert('Failed to save settings: ' + (result.error || 'unknown error'));
    }
  } catch (err) {
    alert('Error saving settings: ' + err.message);
  }
});

async function initSettingsAndPricing() {
  try {
    const res = await fetch('/api/settings');
    const config = await res.json();
    if (config && config.PRICING) {
      PRICING.length = 0;
      config.PRICING.forEach(item => PRICING.push(item));
    }
  } catch (err) {
    console.error('Failed to load dynamic pricing from settings:', err);
  }
}

initSettingsAndPricing();
