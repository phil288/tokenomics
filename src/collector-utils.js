const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

const HOME = process.env.HOME || os.homedir();
const REFRESH_MS = Number(process.env.REFRESH_MS) || 10000;

function configuredHomes() {
  const raw = process.env.TOKENOMICS_HOMES || '';
  const homes = raw.split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return homes.length ? [...new Set(homes)] : [HOME];
}

function userLabel(home) {
  return path.basename(home) || home;
}

const EXEC_PATH = [
  path.join(HOME, '.local', 'bin'),
  path.join(HOME, 'bin'),
  '/usr/local/bin', '/usr/bin', '/bin',
  process.env.PATH || '',
].filter(Boolean).join(':');

function execPromise(cmd, extraEnv = {}) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 10000, env: { ...process.env, PATH: EXEC_PATH, ...extraEnv } }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

function readFile(filePath) {
  return new Promise((resolve) => {
    fs.readFile(filePath, 'utf8', (err, data) => resolve(err ? null : data));
  });
}

function tailFileSync(filePath, maxBytes = 65536) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return '';
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, start);
    let text = buf.toString('utf8');
    if (start > 0) { const nl = text.indexOf('\n'); if (nl !== -1) text = text.slice(nl + 1); }
    return text;
  } catch { return ''; }
  finally { if (fd !== null) try { fs.closeSync(fd); } catch { } }
}

function clampLimit(n, def = 50, max = 200) {
  n = Number(n);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(max, Math.round(n)));
}

function fileMtimeISO(filePath) {
  try { return fs.statSync(filePath).mtime.toISOString(); } catch { return null; }
}

function maxIso(...isos) {
  let max = null;
  for (const iso of isos) {
    if (!iso) continue;
    const t = Date.parse(iso);
    if (!Number.isNaN(t) && (max === null || t > max)) max = t;
  }
  return max === null ? null : new Date(max).toISOString();
}

async function maxJsonlLastUsed(filePath, tsField) {
  const raw = await readFile(filePath);
  if (!raw) return null;
  let max = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed);
      const ts = e[tsField];
      if (typeof ts === 'number' && (max === null || ts > max)) max = ts;
    } catch { }
  }
  return max === null ? null : new Date(max).toISOString();
}

module.exports = {
  HOME,
  REFRESH_MS,
  EXEC_PATH,
  configuredHomes,
  userLabel,
  execPromise,
  readFile,
  tailFileSync,
  clampLimit,
  fileMtimeISO,
  maxIso,
  maxJsonlLastUsed,
};
