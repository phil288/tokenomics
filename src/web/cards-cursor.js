import { usageBar } from './cards-common.js';
import { computePace, monthlyCycle } from './pace.js';

// `alert` is off for the Total bar: it is max(auto, api), so whichever bar
// drives it alerts already and a second notification says nothing new.
function cursorBar(label, pctVal, sub, mb = 12, pace = null, alert = true) {
  return usageBar(label, pctVal, sub, 'var(--cursor)', mb, {
    pace,
    key: alert ? `cursor:${label}` : null,
    alertLabel: `Cursor · ${label}`,
  });
}

// Cursor's quota resets with the billing cycle; the API only gives its start,
// so the current cycle is the monthly anniversary window containing now.
function cursorCycleStartMs(d) {
  const raw = d.subscriptionCycleStart || (d.billingCycle && d.billingCycle.cycleStart);
  if (!raw) return null;
  const ms = new Date(isNaN(raw) ? raw : parseInt(raw)).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function cursorPace(cycle, usedPct) {
  if (!cycle) return null;
  return computePace({ usedPct, windowSecs: cycle.windowSecs, remainingSecs: cycle.remainingSecs });
}

const CURSOR_SUB_AUTO = { style: 'opacity: 0.6; line-height: 1.3;', text: 'Additional usage beyond limits consumes API quota or on-demand spend.' };
const CURSOR_SUB_API = { style: 'opacity: 0.6; line-height: 1.3;', text: 'Additional usage beyond limits consumes on-demand spend. Your plan includes at least $20 of API usage.' };
const cursorTotalSub = (autoPct, apiPct) => ({ style: 'opacity: 0.8;', text: `${Math.round(autoPct)}% Auto and ${Math.round(apiPct)}% API used` });

function cursorBars(totalPct, autoPct, apiPct, cycle = null) {
  return `
      ${cursorBar('Total', totalPct, cursorTotalSub(autoPct, apiPct), 12, cursorPace(cycle, totalPct), false)}
      ${cursorBar('Auto + Composer', autoPct, CURSOR_SUB_AUTO, 12, cursorPace(cycle, autoPct))}
      ${cursorBar('API', apiPct, CURSOR_SUB_API, 16, cursorPace(cycle, apiPct))}`;
}

export function renderCursor(d) {
  if (!d || d.error) return `<div class="err">${d && d.error ? d.error : 'No Cursor data'}</div>`;

  const cycle = monthlyCycle(cursorCycleStartMs(d));

  if (d.planUsage) {
    const autoPct = d.planUsage.autoPercentUsed || 0;
    const apiPct = d.planUsage.apiPercentUsed || 0;
    const totalPct = Math.max(autoPct, apiPct);
    return cursorBars(totalPct, autoPct, apiPct, cycle);
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
    ${cursorBars(totalPct, autoPct, apiPct, cycle)}

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

