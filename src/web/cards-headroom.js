import { ht, pct, usd, timeAgo } from './format.js';
import { renderModels } from './cards-common.js';

// Live up/down pill for the Headroom proxy, driven by collectors.js's /health
// probe. Healthy = green, degraded = amber, down = red.
export function headroomHealthPill(h) {
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
    <div class="tcell-label" style="margin-bottom:8px">Headroom telemetry <span style="opacity:0.6">(usage, not savings; persists across restarts)</span></div>
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
