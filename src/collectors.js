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
const { collectActivity, clampLimit } = require('./collectors-activity');

async function collectLastUsed(headroom) {
  const [caveman, claude] = await Promise.all([
    cavemanLastUsed(),
    Promise.all(configuredHomes().map(home => maxJsonlLastUsed(path.join(home, '.claude', 'history.jsonl'), 'timestamp')))
      .then(values => maxIso(...values)),
  ]);
  return { rtk: maxRtkLastUsed(), caveman, claude, headroom: headroomLastUsed(headroom) };
}

async function collectUsers() {
  return Promise.all(configuredHomes().map(async home => {
    const [rtk, caveman, headroom] = await Promise.all([
      collectRTKForHome(home),
      collectCavemanForHome(home),
      collectHeadroomForHome(home),
    ]);
    return {
      user: userLabel(home),
      home,
      rtk: rtk.summary || null,
      caveman,
      claude: {
        latest: headroom.latest,
        has_quota: Boolean(headroom.latest),
        headroom_state: headroom.has_state,
        last_active_at: headroom.last_active_at,
      },
      headroom: {
        tokens_saved: headroom.savings && headroom.savings.lifetime
          ? (headroom.savings.lifetime.tokens_saved || 0)
          : 0,
      },
    };
  }));
}

async function collectStatsRaw() {
  const [rtk, caveman, headroom, cursor, users] = await Promise.all([
    collectRTK(), collectCaveman(), collectHeadroom(), collectCursor(), collectUsers()
  ]);
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
    rtk, caveman, headroom, cursor, antigravity: getAntigravityCache(), users,
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
  parseTextRTK,
  parseRtkVal,
  collectLastUsed,
  collectStats,
  collectStatsRaw,
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
