// resolveCursorToken(): the settings → env → Cursor-DB resolution chain that
// backs GET /api/cursor/token (the settings UI's "reveal effective token").
// HOME is captured at collectors module-load, so we point it at a temp dir
// with a controlled state.vscdb BEFORE requiring collectors — that makes the
// DB branch and the no-token branch deterministic (the real machine may have a
// Cursor DB, which would otherwise leak into the null case).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-home-'));
process.env.HOME = FAKE_HOME;
delete process.env.CURSOR_ACCESS_TOKEN;

const { resolveCursorToken, testCursorToken } = require('../src/collectors');
const { settings } = require('../src/settings');

function writeCursorDb(value) {
  const dir = path.join(FAKE_HOME, '.config', 'Cursor', 'User', 'globalStorage');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'state.vscdb'));
  db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('cursorAuth/accessToken', ?)").run(value);
  db.close();
}

function reset() {
  settings.CURSOR_ACCESS_TOKEN = '';
  delete process.env.CURSOR_ACCESS_TOKEN;
}

test('returns null token/source when nothing is stored', () => {
  reset();
  assert.deepEqual(resolveCursorToken(), { token: null, source: null });
});

test('settings token wins and is trimmed', () => {
  reset();
  settings.CURSOR_ACCESS_TOKEN = '  from-settings  ';
  assert.deepEqual(resolveCursorToken(), { token: 'from-settings', source: 'settings' });
});

test('env token used when settings is blank', () => {
  reset();
  process.env.CURSOR_ACCESS_TOKEN = 'from-env';
  assert.deepEqual(resolveCursorToken(), { token: 'from-env', source: 'env' });
});

test('settings token takes precedence over env', () => {
  reset();
  settings.CURSOR_ACCESS_TOKEN = 'from-settings';
  process.env.CURSOR_ACCESS_TOKEN = 'from-env';
  assert.equal(resolveCursorToken().source, 'settings');
});

test('falls back to the Cursor DB when settings and env are empty', () => {
  reset();
  writeCursorDb('jwt-from-db');
  assert.deepEqual(resolveCursorToken(), { token: 'jwt-from-db', source: 'db' });
});

test('env token takes precedence over the Cursor DB', () => {
  reset();
  writeCursorDb('jwt-from-db');
  process.env.CURSOR_ACCESS_TOKEN = 'from-env';
  assert.equal(resolveCursorToken().source, 'env');
  reset();
});

// ---- testCursorToken: live-API validation (fetch stubbed) ----
function stubFetch(impl) {
  const orig = global.fetch;
  global.fetch = impl;
  return () => { global.fetch = orig; };
}

test('testCursorToken returns no-token result without calling the API', async () => {
  reset();
  // Cursor DB may hold a token from earlier tests; blow away HOME lookup by
  // asserting fetch is never reached when there is genuinely nothing to resolve.
  let called = false;
  const restore = stubFetch(async () => { called = true; return { status: 200, json: async () => ({}) }; });
  try {
    // remove the DB the earlier tests wrote so resolution is truly empty
    fs.rmSync(path.join(FAKE_HOME, '.config'), { recursive: true, force: true });
    const r = await testCursorToken('');
    assert.deepEqual(r, { ok: false, error: 'no token found', source: null });
    assert.equal(called, false);
  } finally { restore(); }
});

test('testCursorToken reports a provided token valid on HTTP 200', async () => {
  reset();
  let seenAuth = null;
  const restore = stubFetch(async (_url, opts) => {
    seenAuth = opts.headers.Authorization;
    return { status: 200, json: async () => ({ usage: 1 }) };
  });
  try {
    const r = await testCursorToken('  my-token  ');
    assert.deepEqual(r, { ok: true, status: 200, source: 'provided' });
    assert.equal(seenAuth, 'Bearer my-token'); // trimmed
  } finally { restore(); }
});

test('testCursorToken surfaces the API error message on non-200', async () => {
  reset();
  const restore = stubFetch(async () => ({
    status: 401,
    text: async () => JSON.stringify({ message: 'invalid token' }),
  }));
  try {
    const r = await testCursorToken('bad');
    assert.deepEqual(r, { ok: false, status: 401, error: 'invalid token', source: 'provided' });
  } finally { restore(); }
});

test('testCursorToken falls back to the effective token when arg is blank', async () => {
  reset();
  settings.CURSOR_ACCESS_TOKEN = 'stored-token';
  let seenAuth = null;
  const restore = stubFetch(async (_url, opts) => {
    seenAuth = opts.headers.Authorization;
    return { status: 200, json: async () => ({}) };
  });
  try {
    const r = await testCursorToken('');
    assert.deepEqual(r, { ok: true, status: 200, source: 'settings' });
    assert.equal(seenAuth, 'Bearer stored-token');
  } finally { restore(); reset(); }
});

test('testCursorToken reports network errors', async () => {
  reset();
  const restore = stubFetch(async () => { throw new Error('ECONNREFUSED'); });
  try {
    const r = await testCursorToken('tok');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'ECONNREFUSED');
    assert.equal(r.source, 'provided');
  } finally { restore(); }
});
