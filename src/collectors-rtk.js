const fs = require('fs');
const path = require('path');
const { settings } = require('./settings');
const { HOME, configuredHomes, execPromise } = require('./collector-utils');

function listSnapShareDirs() {
  const dirs = [];
  for (const home of configuredHomes()) {
    const snapCode = path.join(home, 'snap', 'code');
    try {
      for (const rev of fs.readdirSync(snapCode)) {
        dirs.push(path.join(snapCode, rev, '.local', 'share'));
      }
    } catch { }
  }
  return dirs;
}

function rtkDataHomes() {
  const customHome = settings.RTK_DATA_HOME || process.env.RTK_DATA_HOME;
  if (customHome) return [customHome];
  const candidates = [
    process.env.XDG_DATA_HOME,
    ...configuredHomes().map(home => path.join(home, '.local', 'share')),
    ...configuredHomes().map(home => path.join(home, 'Library', 'Application Support')),
    ...listSnapShareDirs(),
  ].filter(Boolean);

  const seen = new Set(), homes = [];
  for (const share of candidates) {
    try {
      const real = fs.realpathSync(path.join(share, 'rtk', 'history.db'));
      if (!seen.has(real)) { seen.add(real); homes.push(share); }
    } catch { }
  }
  return homes;
}

function rtkDataHomesFor(home) {
  const candidates = [
    path.join(home, '.local', 'share'),
    path.join(home, 'Library', 'Application Support'),
  ];
  const homes = [];
  for (const share of candidates) {
    try {
      fs.realpathSync(path.join(share, 'rtk', 'history.db'));
      homes.push(share);
    } catch { }
  }
  return homes;
}

function mergeRTK(list) {
  const sum = { total_commands: 0, total_input: 0, total_output: 0, total_saved: 0, total_time_ms: 0 };
  const byKey = { daily: new Map(), weekly: new Map(), monthly: new Map() };
  const keyOf = { daily: r => r.date, weekly: r => r.week_start, monthly: r => r.month };

  for (const g of list) {
    const s = g.summary || {};
    sum.total_commands += s.total_commands || 0;
    sum.total_input += s.total_input || 0;
    sum.total_output += s.total_output || 0;
    sum.total_saved += s.total_saved || 0;
    sum.total_time_ms += s.total_time_ms || 0;
    for (const period of ['daily', 'weekly', 'monthly']) {
      for (const r of g[period] || []) {
        const k = keyOf[period](r);
        const m = byKey[period];
        const cur = m.get(k) || { ...r, commands: 0, input_tokens: 0, output_tokens: 0, saved_tokens: 0, total_time_ms: 0 };
        cur.commands += r.commands || 0;
        cur.input_tokens += r.input_tokens || 0;
        cur.output_tokens += r.output_tokens || 0;
        cur.saved_tokens += r.saved_tokens || 0;
        cur.total_time_ms += r.total_time_ms || 0;
        m.set(k, cur);
      }
    }
  }

  const pct = (saved, input) => input ? (saved / input) * 100 : 0;
  const finalizePeriod = (m, dateKey) => [...m.values()]
    .map(r => ({
      ...r, savings_pct: pct(r.saved_tokens, r.input_tokens),
      avg_time_ms: r.commands ? Math.round(r.total_time_ms / r.commands) : 0
    }))
    .sort((a, b) => String(a[dateKey]).localeCompare(String(b[dateKey])));

  return {
    summary: {
      ...sum,
      avg_savings_pct: pct(sum.total_saved, sum.total_input),
      avg_time_ms: sum.total_commands ? Math.round(sum.total_time_ms / sum.total_commands) : 0,
    },
    daily: finalizePeriod(byKey.daily, 'date'),
    weekly: finalizePeriod(byKey.weekly, 'week_start'),
    monthly: finalizePeriod(byKey.monthly, 'month'),
    sources: list.length,
  };
}

function parseRtkVal(str) {
  str = str.trim().toUpperCase();
  if (str.endsWith('K')) return parseFloat(str) * 1000;
  if (str.endsWith('M')) return parseFloat(str) * 1000000;
  if (str.endsWith('B')) return parseFloat(str) * 1000000000;
  return parseFloat(str) || 0;
}

function parseTextRTK(text) {
  const lines = text.split('\n');
  const summary = { total_commands: 0, total_input: 0, total_output: 0, total_saved: 0, total_time_ms: 0, avg_savings_pct: 0, avg_time_ms: 0 };
  const daily = [];
  const weekly = [];
  const monthly = [];

  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('D Daily Breakdown')) {
      currentSection = 'daily';
      continue;
    } else if (trimmed.startsWith('W Weekly Breakdown')) {
      currentSection = 'weekly';
      continue;
    } else if (trimmed.startsWith('M Monthly Breakdown')) {
      currentSection = 'monthly';
      continue;
    }

    if (trimmed.startsWith('Date') || trimmed.startsWith('Week') || trimmed.startsWith('Month') || trimmed.startsWith('──') || trimmed.startsWith('══')) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 7) continue;

    const key = parts[0];
    if (key === 'TOTAL') {
      if (currentSection === 'daily') {
        summary.total_commands = parseInt(parts[1]) || 0;
        summary.total_input = parseRtkVal(parts[2]);
        summary.total_output = parseRtkVal(parts[3]);
        summary.total_saved = parseRtkVal(parts[4]);
        summary.avg_savings_pct = parseFloat(parts[5]) || 0;
        summary.total_time_ms = (parseInt(parts[1]) || 0) * (parseInt(parts[6]) || 0);
        summary.avg_time_ms = parseInt(parts[6]) || 0;
      }
      continue;
    }

    let keyEndIdx = 0;
    if (trimmed.includes('→')) {
      const arrowIdx = parts.indexOf('→');
      if (arrowIdx !== -1) {
        keyEndIdx = arrowIdx + 1;
      }
    }

    const name = parts.slice(0, keyEndIdx + 1).join(' ');
    const rest = parts.slice(keyEndIdx + 1);

    if (rest.length < 6) continue;

    const cmds = parseInt(rest[0]) || 0;
    const input = parseRtkVal(rest[1]);
    const output = parseRtkVal(rest[2]);
    const saved = parseRtkVal(rest[3]);
    const pct = parseFloat(rest[4]) || 0;
    const time = parseInt(rest[5]) || 0;

    const row = {
      commands: cmds,
      input_tokens: input,
      output_tokens: output,
      saved_tokens: saved,
      savings_pct: pct,
      total_time_ms: cmds * time,
      avg_time_ms: time
    };

    if (currentSection === 'daily') {
      row.date = name;
      daily.push(row);
    } else if (currentSection === 'weekly') {
      row.week_start = name.split(' ')[0];
      row.week_end = name.split(' ').pop();
      weekly.push(row);
    } else if (currentSection === 'monthly') {
      row.month = name;
      monthly.push(row);
    }
  }

  return { summary, daily, weekly, monthly };
}

async function probeRtkInstalled() {
  const out = await execPromise('rtk --version');
  if (!out) return { installed: false };
  const m = String(out).match(/(\d+\.\d+\.\d+\S*)/);
  return { installed: true, version: m ? m[1] : null };
}

async function collectRTK() {
  const homes = rtkDataHomes();
  const envs = [];
  if (settings.RTK_DATA_HOME || process.env.RTK_DATA_HOME) {
    envs.push(...(homes.length ? homes.map(h => ({ XDG_DATA_HOME: h })) : [{}]));
  } else {
    const confHomes = configuredHomes();
    for (const h of homes) {
      const matchingHome = confHomes.find(home => h.startsWith(home)) || HOME;
      envs.push({ HOME: matchingHome, XDG_DATA_HOME: h });
    }
    if (!envs.length) envs.push(...confHomes.map(home => ({ HOME: home })));
  }

  const [results, install] = await Promise.all([
    Promise.all(
      envs.map(env => execPromise('rtk gain -g -a', env).then(o => {
        if (!o) return null;
        try {
          return JSON.parse(o);
        } catch {
          return parseTextRTK(o);
        }
      }))
    ).then(r => r.filter(Boolean)),
    probeRtkInstalled(),
  ]);

  const base = results.length
    ? (results.length === 1 ? results[0] : mergeRTK(results))
    : { error: 'no data' };
  return { ...base, install };
}

async function collectRTKForHome(home) {
  const homes = rtkDataHomesFor(home);
  const envs = homes.length ? [{ HOME: home }] : [];
  const results = await Promise.all(
    envs.map(env => execPromise('rtk gain -g -a', env).then(o => {
      if (!o) return null;
      try {
        return JSON.parse(o);
      } catch {
        return parseTextRTK(o);
      }
    }))
  ).then(r => r.filter(Boolean));
  return results.length
    ? (results.length === 1 ? results[0] : mergeRTK(results))
    : { error: 'no data' };
}

function maxRtkLastUsed() {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return null; }

  let max = null;
  for (const home of rtkDataHomes()) {
    const dbPath = path.join(home, 'rtk', 'history.db');
    try {
      if (!fs.existsSync(dbPath)) continue;
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const row = db.prepare('SELECT MAX(timestamp) AS ts FROM commands').get();
      db.close();
      if (row && row.ts) {
        const t = Date.parse(row.ts);
        if (!Number.isNaN(t) && (max === null || t > max)) max = t;
      }
    } catch { }
  }
  return max === null ? null : new Date(max).toISOString();
}

function readRtkActivity(limit) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return []; }
  const rows = [];
  for (const home of rtkDataHomes()) {
    const dbPath = path.join(home, 'rtk', 'history.db');
    try {
      if (!fs.existsSync(dbPath)) continue;
      const db = new DatabaseSync(dbPath, { readOnly: true });
      // LAG over the WHOLE table (partitioned by query+response identity) gives
      // each row its immediately-preceding identical run, reaching beyond `limit`.
      const r = db.prepare(
        'SELECT timestamp, original_cmd, rtk_cmd, input_tokens, output_tokens, saved_tokens, savings_pct, exec_time_ms, '
        + 'LAG(output_tokens) OVER w AS prev_after, LAG(timestamp) OVER w AS prev_ts '
        + 'FROM commands '
        + 'WINDOW w AS (PARTITION BY original_cmd, rtk_cmd ORDER BY id) '
        + 'ORDER BY id DESC LIMIT ?'
      ).all(limit);
      db.close();
      for (const row of r) rows.push(row);
    } catch { }
  }
  return rows;
}

function collectRtkTotals() {
  let DatabaseSync;
  const empty = { gain: 0, loss: 0, net: 0, gainCmds: 0, lossCmds: 0 };
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return empty; }
  const t = { ...empty };
  for (const home of rtkDataHomes()) {
    const dbPath = path.join(home, 'rtk', 'history.db');
    try {
      if (!fs.existsSync(dbPath)) continue;
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const r = db.prepare(
        'SELECT '
        + 'COALESCE(SUM(CASE WHEN output_tokens < input_tokens THEN input_tokens - output_tokens ELSE 0 END), 0) AS gain, '
        + 'COALESCE(SUM(CASE WHEN output_tokens > input_tokens THEN output_tokens - input_tokens ELSE 0 END), 0) AS loss, '
        + 'COALESCE(SUM(CASE WHEN output_tokens < input_tokens THEN 1 ELSE 0 END), 0) AS gain_cmds, '
        + 'COALESCE(SUM(CASE WHEN output_tokens > input_tokens THEN 1 ELSE 0 END), 0) AS loss_cmds '
        + 'FROM commands'
      ).get();
      db.close();
      t.gain += Number(r.gain) || 0;
      t.loss += Number(r.loss) || 0;
      t.gainCmds += Number(r.gain_cmds) || 0;
      t.lossCmds += Number(r.loss_cmds) || 0;
    } catch { }
  }
  t.net = t.gain - t.loss;
  return t;
}

module.exports = {
  collectRTK,
  collectRTKForHome,
  parseTextRTK,
  parseRtkVal,
  rtkDataHomes,
  collectRtkTotals,
  maxRtkLastUsed,
  readRtkActivity,
};
