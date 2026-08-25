const fs = require('fs');
const path = require('path');
const { settings } = require('./settings');
const { HOME, configuredHomes, readFile, fileMtimeISO, maxIso, maxJsonlLastUsed } = require('./collector-utils');

// Caveman's session ledger. Overridable (settings/env) so tests can point it at
// a temp fixture, mirroring HEADROOM_SESSION_STATS_PATH.
function cavemanHistoryPath(home = HOME) {
  return settings.CAVEMAN_HISTORY_PATH || process.env.CAVEMAN_HISTORY_PATH
    || path.join(home, '.claude', '.caveman-history.jsonl');
}

function cavemanConfigMode(home) {
  if (process.env.CAVEMAN_DEFAULT_MODE) return process.env.CAVEMAN_DEFAULT_MODE.trim();
  const cfg = path.join(home, '.config', 'caveman', 'config.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    return String(parsed.defaultMode || parsed.default_mode || '').trim();
  } catch { return ''; }
}

function cavemanInstalled(home) {
  return [
    path.join(home, '.agents', 'skills', 'caveman', 'SKILL.md'),
    path.join(home, '.roo', 'skills', 'caveman', 'SKILL.md'),
  ].some(p => {
    try { return fs.existsSync(p); } catch { return false; }
  });
}

async function collectCavemanForHome(home) {
  const statusPath = path.join(home, '.claude', '.caveman-statusline-suffix');
  const historyPath = cavemanHistoryPath(home);
  const [modeRaw, historyRaw, statusRaw] = await Promise.all([
    readFile(path.join(home, '.claude', '.caveman-active')),
    readFile(historyPath),
    readFile(statusPath),
  ]);
  const installed = cavemanInstalled(home);
  const cfgMode = cavemanConfigMode(home);
  let mode = (modeRaw || '').trim();
  const source = mode ? 'ledger' : installed ? 'install' : 'missing';
  if (!mode && installed) mode = cfgMode || 'full';
  if (!mode) mode = 'unknown';
  const active = /^(full|lite|ultra|wenyan|wenyan-lite|wenyan-ultra)$/i.test(mode) && mode !== 'off';

  const latest = new Map();
  if (historyRaw) {
    for (const line of historyRaw.split('\n').filter(l => l.trim())) {
      try {
        const e = JSON.parse(line);
        const key = e.session_id || `_${latest.size}`;
        const prev = latest.get(key);
        if (!prev || (e.ts || 0) >= (prev.ts || 0)) latest.set(key, e);
      } catch { }
    }
  }
  const sessions = [...latest.values()];
  let totalOutputTokens = 0, totalSavedTokens = 0, totalSavedUsd = 0;
  for (const e of sessions) {
    totalOutputTokens += e.output_tokens || 0;
    totalSavedTokens += e.est_saved_tokens || 0;
    totalSavedUsd += e.est_saved_usd || 0;
  }
  return {
    installed, active, mode, source,
    session_count: sessions.length,
    total_output_tokens: totalOutputTokens,
    total_saved_tokens: totalSavedTokens,
    total_saved_usd: totalSavedUsd,
    statusline_saved_tokens: parseCompactTokenCount(statusRaw),
    statusline_updated_at: fileMtimeISO(statusPath),
    history_path: historyPath,
    history_present: !!historyRaw,
    status_path: statusPath,
    status_present: !!statusRaw,
    telemetry_missing: installed && active && !historyRaw && !statusRaw,
  };
}

async function collectCaveman() {
  const homes = configuredHomes();
  const latest = new Map();
  let mode = 'unknown';
  let statuslineSavedTokens = 0;
  let statuslineUpdatedAt = null;
  let anyInstalled = false;
  let anyActive = false;
  const telemetry = [];

  for (const home of homes) {
    const homeCaveman = await collectCavemanForHome(home);
    anyInstalled = anyInstalled || homeCaveman.installed;
    anyActive = anyActive || homeCaveman.active;
    telemetry.push({
      home,
      source: homeCaveman.source,
      history_present: homeCaveman.history_present,
      status_present: homeCaveman.status_present,
      telemetry_missing: homeCaveman.telemetry_missing,
    });
    const homeMode = homeCaveman.mode;
    if (homeMode && homeMode !== 'unknown') mode = homeMode;
    statuslineSavedTokens += homeCaveman.statusline_saved_tokens || 0;
    statuslineUpdatedAt = maxIso(statuslineUpdatedAt, homeCaveman.statusline_updated_at);

    const historyRaw = await readFile(cavemanHistoryPath(home));
    if (!historyRaw) continue;
    for (const line of historyRaw.split('\n').filter(l => l.trim())) {
      try {
        const e = JSON.parse(line);
        const key = e.session_id ? `${home}:${e.session_id}` : `${home}:_${latest.size}`;
        const prev = latest.get(key);
        if (!prev || (e.ts || 0) >= (prev.ts || 0)) latest.set(key, e);
      } catch { }
    }
  }

  const sessions = [...latest.values()];
  let totalOutputTokens = 0, totalSavedTokens = 0, totalSavedUsd = 0;
  for (const e of sessions) {
    totalOutputTokens += e.output_tokens || 0;
    totalSavedTokens += e.est_saved_tokens || 0;
    totalSavedUsd += e.est_saved_usd || 0;
  }

  return {
    installed: anyInstalled,
    active: anyActive,
    mode, session_count: sessions.length, total_output_tokens: totalOutputTokens,
    total_saved_tokens: totalSavedTokens, total_saved_usd: totalSavedUsd, sessions,
    statusline_saved_tokens: statuslineSavedTokens,
    statusline_updated_at: statuslineUpdatedAt,
    telemetry,
    telemetry_missing: anyInstalled && anyActive && sessions.length === 0 && statuslineSavedTokens === 0,
  };
}

function parseCompactTokenCount(raw) {
  const text = String(raw || '').trim();
  const m = text.match(/([\d.]+)\s*([kmb])?/i);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const mult = m[2] ? ({ k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] || 1) : 1;
  return Math.round(n * mult);
}

async function cavemanLastUsed() {
  const homes = configuredHomes();
  const histTimestamps = await Promise.all(homes.map(home => maxJsonlLastUsed(cavemanHistoryPath(home), 'ts')));
  const values = [];
  for (let i = 0; i < homes.length; i++) {
    const home = homes[i];
    values.push(
      histTimestamps[i],
      fileMtimeISO(path.join(home, '.claude', '.caveman-active')),
      fileMtimeISO(path.join(home, '.claude', '.caveman-statusline-suffix')),
    );
  }
  return maxIso(...values);
}

module.exports = {
  collectCaveman,
  collectCavemanForHome,
  cavemanHistoryPath,
  cavemanLastUsed,
};
