const path = require('path');
const { settings } = require('./settings');
const { collectVersion } = require('./version');
const { applyBaseline } = require('./baseline');
const {
  REFRESH_MS,
  configuredHomes,
  userLabel,
  maxIso,
  maxJsonlLastUsed,
  tailFileSync,
} = require('./collector-utils');
const {
  collectRTK,
  collectRTKForHome,
  parseTextRTK,
  parseRtkVal,
  rtkDataHomes,
  collectRtkTotals,
  maxRtkLastUsed,
} = require('./collectors-rtk');
const {
  collectCaveman,
  collectCavemanForHome,
  cavemanHistoryPath,
  cavemanLastUsed,
} = require('./collectors-caveman');
const {
  collectHeadroom,
  collectHeadroomForHome,
  headroomSavingsPath,
  headroomSessionStatsPath,
  headroomProxyLogPath,
  headroomLastUsed,
  parseProxyPerfLine,
  parseSessionStatLine,
} = require('./collectors-headroom');
const { collectCursor, readCursorAccessToken, resolveCursorToken, testCursorToken } = require('./collectors-cursor');
const { pollAntigravity, parseAgyUsage, getAntigravityCache } = require('./collectors-antigravity');
const { pollClaude, parseClaudeUsage, getClaudeCache } = require('./collectors-claude');
const { collectActivity, clampLimit } = require('./collectors-activity');

async function collectLastUsed(headroom) {
  const [caveman, claude] = await Promise.all([
    cavemanLastUsed(),
    Promise.all(configuredHomes().map(home => maxJsonlLastUsed(path.join(home, '.claude', 'history.jsonl'), 'timestamp')))
      .then(values => maxIso(...values)),
  ]);
  return { rtk: maxRtkLastUsed(), caveman, claude, headroom: headroomLastUsed(headroom) };
}

async function collectUserData() {
  const entries = await Promise.all(configuredHomes().map(async home => {
    const [rtk, caveman, headroom] = await Promise.all([
      collectRTKForHome(home),
      collectCavemanForHome(home),
      collectHeadroomForHome(home),
    ]);
    const user = {
      user: userLabel(home),
      home,
      rtk: rtk.summary || null,
      caveman,
      claude: {
        // Quota is account-wide and comes from the `claude /usage` poll, not
        // per-home Headroom state, so no per-user `latest` here.
        headroom_state: headroom.has_state,
        last_active_at: headroom.last_active_at,
      },
      headroom: {
        tokens_saved: headroom.savings && headroom.savings.lifetime
          ? (headroom.savings.lifetime.tokens_saved || 0)
          : 0,
      },
    };
    return { user, rtk };
  }));
  return {
    users: entries.map(e => e.user),
    rtkResults: entries.map(e => e.rtk),
  };
}

async function collectUsers() {
  return (await collectUserData()).users;
}

function emptyRtkSummary() {
  return {
    total_commands: 0,
    total_input: 0,
    total_output: 0,
    total_saved: 0,
    total_time_ms: 0,
    avg_savings_pct: 0,
    avg_time_ms: 0,
  };
}

function finalizeRtkSummary(summary) {
  summary.avg_savings_pct = summary.total_input
    ? (summary.total_saved / summary.total_input) * 100
    : 0;
  summary.avg_time_ms = summary.total_commands
    ? Math.round(summary.total_time_ms / summary.total_commands)
    : 0;
  return summary;
}

function mergeRtkPeriodRows(results, period, keyName) {
  const rows = new Map();
  for (const result of results || []) {
    for (const row of (result && result[period]) || []) {
      const key = row && row[keyName];
      if (!key) continue;
      const cur = rows.get(key) || {
        ...row,
        commands: 0,
        input_tokens: 0,
        output_tokens: 0,
        saved_tokens: 0,
        total_time_ms: 0,
      };
      cur.commands += row.commands || 0;
      cur.input_tokens += row.input_tokens || 0;
      cur.output_tokens += row.output_tokens || 0;
      cur.saved_tokens += row.saved_tokens || 0;
      cur.total_time_ms += row.total_time_ms || 0;
      if (row.week_end) cur.week_end = row.week_end;
      rows.set(key, cur);
    }
  }
  return [...rows.values()]
    .map(row => ({
      ...row,
      savings_pct: row.input_tokens ? (row.saved_tokens / row.input_tokens) * 100 : 0,
      avg_time_ms: row.commands ? Math.round(row.total_time_ms / row.commands) : 0,
    }))
    .sort((a, b) => String(a[keyName]).localeCompare(String(b[keyName])));
}

function mergeUserRtkResults(results) {
  const summary = emptyRtkSummary();
  let sources = 0;
  for (const result of results || []) {
    const rtk = result && result.summary;
    if (!rtk) continue;
    sources += 1;
    summary.total_commands += rtk.total_commands || 0;
    summary.total_input += rtk.total_input || 0;
    summary.total_output += rtk.total_output || 0;
    summary.total_saved += rtk.total_saved || 0;
    summary.total_time_ms += rtk.total_time_ms || 0;
  }
  if (!sources) return null;
  return {
    summary: finalizeRtkSummary(summary),
    daily: mergeRtkPeriodRows(results, 'daily', 'date'),
    weekly: mergeRtkPeriodRows(results, 'weekly', 'week_start'),
    monthly: mergeRtkPeriodRows(results, 'monthly', 'month'),
    sources,
  };
}

function applyUserRtkFallback(rtk, userRtkResults) {
  if (!rtk || typeof rtk !== 'object') return rtk;
  const userAggregate = mergeUserRtkResults(userRtkResults);
  if (!userAggregate) return rtk;
  const current = rtk.summary || {};
  if ((current.total_saved || 0) >= userAggregate.summary.total_saved) return rtk;
  return { ...rtk, ...userAggregate, install: rtk.install, summary_source: 'users' };
}

const QUOTA_FALLBACK_MAX_AGE_MS = Number(process.env.CLAUDE_QUOTA_FALLBACK_MAX_AGE_MS) || 30 * 60 * 1000;

function isFreshEnough(iso, maxAgeMs = QUOTA_FALLBACK_MAX_AGE_MS) {
  const t = iso ? Date.parse(iso) : NaN;
  return !Number.isNaN(t) && Date.now() - t <= maxAgeMs;
}

// The Claude card renders from the `claude /usage` poll (cached, slow timer).
// Headroom's health pill and per-user rows still ride along on the same object
// because the card shows them, but the quota windows are Claude's own.
function buildClaude(users, headroom) {
  const cache = getClaudeCache() || {};
  const hasCliQuota = cache.latest && Object.keys(cache.latest).length;
  const headroomLatest = headroom && headroom.latest;
  const headroomPolledAt = headroomLatest && headroomLatest.polled_at;
  const canFallback = headroomLatest && isFreshEnough(headroomPolledAt);
  const quota = hasCliQuota || !canFallback ? { ...cache } : {
    ...cache,
    latest: headroomLatest,
    polled_at: headroomPolledAt || null,
    stale: true,
    fallback: 'headroom',
  };
  if (!hasCliQuota && headroomLatest && !canFallback) {
    quota.fallback_blocked = 'headroom_stale';
    quota.fallback_polled_at = headroomPolledAt || null;
  }
  return { ...quota, users, health: (headroom && headroom.health) || null };
}

async function collectStatsRaw() {
  let [rtk, caveman, headroom, cursor, userData] = await Promise.all([
    collectRTK(), collectCaveman(), collectHeadroom(), collectCursor(), collectUserData()
  ]);
  const { users, rtkResults } = userData;
  rtk = applyUserRtkFallback(rtk, rtkResults);
  if (rtk && typeof rtk === 'object') rtk.users = users;
  if (caveman && typeof caveman === 'object') caveman.users = users;
  if (headroom && typeof headroom === 'object') headroom.users = users;
  const lastUsed = await collectLastUsed(headroom);
  const visibility = {
    rtk: settings.RTK_ENABLED !== false,
    caveman: settings.CAVEMAN_ENABLED !== false,
    claude: settings.CLAUDE_ENABLED !== false,
    headroom: settings.HEADROOM_ENABLED !== false,
    cursor: settings.CURSOR_ENABLED !== false,
    antigravity: settings.ANTIGRAVITY_ENABLED !== false,
  };
  return {
    rtk, caveman, headroom, cursor, claude: buildClaude(users, headroom),
    antigravity: getAntigravityCache(), users,
    visibility, last_used: lastUsed, version: collectVersion(),
    timestamp: new Date().toISOString(), refresh_ms: REFRESH_MS,
  };
}

async function collectStats() {
  return applyBaseline(await collectStatsRaw());
}

module.exports = {
  collectRTK,
  collectCaveman,
  collectHeadroom,
  collectCursor,
  resolveCursorToken,
  testCursorToken,
  pollAntigravity,
  parseAgyUsage,
  pollClaude,
  parseClaudeUsage,
  getClaudeCache,
  parseTextRTK,
  parseRtkVal,
  collectLastUsed,
  collectStats,
  collectStatsRaw,
  mergeUserRtkResults,
  applyUserRtkFallback,
  collectActivity,
  collectRtkTotals,
  parseProxyPerfLine,
  parseSessionStatLine,
  rtkDataHomes,
  tailFileSync,
  clampLimit,
  cavemanHistoryPath,
  headroomSavingsPath,
  headroomSessionStatsPath,
  headroomProxyLogPath,
  configuredHomes,
  collectUsers,
  readCursorAccessToken,
};
