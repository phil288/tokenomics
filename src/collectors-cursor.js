const fs = require('fs');
const path = require('path');
const { settings } = require('./settings');
const { HOME, configuredHomes } = require('./collector-utils');

// Resolve the effective Cursor access token from the same chain collectCursor
// uses: saved settings → env → Cursor's local SQLite store (scanned across
// every configured home, Linux + macOS paths). Returns the token plus which
// source it came from (null token → no source), so the settings UI can reveal
// a DB/env token the user never typed into the field.
function resolveCursorToken() {
  const settingsToken = (settings.CURSOR_ACCESS_TOKEN || '').trim();
  if (settingsToken) return { token: settingsToken, source: 'settings' };

  const envToken = (process.env.CURSOR_ACCESS_TOKEN || '').trim();
  if (envToken) return { token: envToken, source: 'env' };

  const homes = [...new Set([HOME, ...configuredHomes()])];
  for (const home of homes) {
    const t = readCursorAccessToken(home);
    if (t) return { token: String(t), source: 'db' };
  }

  return { token: null, source: null };
}

// Low-level POST to Cursor's usage RPC. Single place the token is exchanged for
// a live API response — shared by collectCursor (usage data) and
// testCursorToken (validity check) so the auth/error handling stays identical.
// Returns { status, data } on 200, else { status, error } / { error }.
async function cursorUsageRequest(token) {
  try {
    const res = await fetch('https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    if (res.status !== 200) {
      const errText = await res.text().catch(() => '');
      let msg = `API returned status ${res.status}`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.message) msg = parsed.message;
      } catch {}
      return { status: res.status, error: msg };
    }
    return { status: 200, data: await res.json() };
  } catch (e) {
    return { error: e.message };
  }
}

// Validate a Cursor token against the live API without exposing the usage
// payload. `token` blank → falls back to the effective token (settings → env →
// DB). Returns { ok, source?, status?, error? } for the settings "Test" button.
async function testCursorToken(token) {
  let tok = (token || '').trim();
  let source = 'provided';
  if (!tok) {
    const resolved = resolveCursorToken();
    tok = resolved.token;
    source = resolved.source;
  }
  if (!tok) return { ok: false, error: 'no token found', source: null };

  const r = await cursorUsageRequest(tok);
  if (r.error) return { ok: false, status: r.status, error: r.error, source };
  return { ok: true, status: r.status, source };
}

async function collectCursor() {
  if (settings.CURSOR_ENABLED === false) {
    return { disabled: true };
  }
  const { token } = resolveCursorToken();
  if (!token) return { error: 'no token found' };

  const r = await cursorUsageRequest(token);
  return r.error ? { error: r.error } : r.data;
}

function cursorStateDbPaths(home) {
  return [
    path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
    path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
  ];
}

function readCursorAccessToken(home) {
  for (const dbPath of cursorStateDbPaths(home)) {
    try {
      if (!fs.existsSync(dbPath)) continue;
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'").get();
        if (row && row.value) return row.value;
      } finally {
        db.close();
      }
    } catch (e) {
      console.error(`Failed to read Cursor token from DB ${dbPath}:`, e.message);
    }
  }
  return '';
}

module.exports = { collectCursor, readCursorAccessToken, resolveCursorToken, testCursorToken };
