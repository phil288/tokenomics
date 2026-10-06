'use strict';
// Newer Headroom builds write `logs/proxy-<port>.log` and leave `logs/proxy.log`
// frozen. The resolver must tail whichever live log was written most recently.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

delete process.env.HEADROOM_PROXY_LOG_PATH;
const { headroomProxyLogPath } = require('../src/collectors-headroom');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

function home(files) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-log-'));
  dirs.push(h);
  const logs = path.join(h, '.headroom', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  for (const [name, ageSecs] of Object.entries(files)) {
    const p = path.join(logs, name);
    fs.writeFileSync(p, 'x');
    const t = Date.now() / 1000 - ageSecs;
    fs.utimesSync(p, t, t);
  }
  return h;
}

test('prefers the newest port-suffixed log over a stale proxy.log', () => {
  const h = home({ 'proxy.log': 86400, 'proxy-8787.log': 5, 'proxy-8787.log.1': 0, 'proxy.log.1': 0 });
  assert.equal(headroomProxyLogPath(h), path.join(h, '.headroom', 'logs', 'proxy-8787.log'));
});

test('keeps proxy.log when it is the live one', () => {
  const h = home({ 'proxy.log': 1, 'proxy-8787.log': 86400 });
  assert.equal(headroomProxyLogPath(h), path.join(h, '.headroom', 'logs', 'proxy.log'));
});

test('falls back to the default path when no log dir exists', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-log-'));
  dirs.push(h);
  assert.equal(headroomProxyLogPath(h), path.join(h, '.headroom', 'logs', 'proxy.log'));
});

test('an explicit override always wins', () => {
  const h = home({ 'proxy-8787.log': 1 });
  process.env.HEADROOM_PROXY_LOG_PATH = '/tmp/custom.log';
  try {
    assert.equal(headroomProxyLogPath(h), '/tmp/custom.log');
  } finally {
    delete process.env.HEADROOM_PROXY_LOG_PATH;
  }
});
