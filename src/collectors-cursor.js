const fs = require('fs');
const path = require('path');
const { settings } = require('./settings');
const { HOME, configuredHomes } = require('./collector-utils');

async function collectCursor() {
  if (settings.CURSOR_ENABLED === false) {
    return { disabled: true };
  }
  let token = settings.CURSOR_ACCESS_TOKEN || process.env.CURSOR_ACCESS_TOKEN;

  if (!token) {
    const homes = [...new Set([HOME, ...configuredHomes()])];
    for (const home of homes) {
      token = readCursorAccessToken(home);
      if (token) break;
    }
  }

  if (!token) return { error: 'no token found' };

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
      return { error: msg };
    }
    const data = await res.json();
    return data;
  } catch (e) {
    return { error: e.message };
  }
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

module.exports = { collectCursor, readCursorAccessToken };
