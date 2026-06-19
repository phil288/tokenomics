// End-to-end functional tests for the HTTP server. Boots the real server.js as
// a child process against a temp data dir and a free port, then drives every
// route over HTTP. Antigravity + Cursor collection are disabled via a settings
// fixture so the test never spawns the heavy agy binary or hits the network.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
let child, port, base, dataDir;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

// Raw GET that does NOT normalize the path — needed to test the traversal guard.
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-srv-'));
  // Disable expensive/networked collectors before the server boots.
  fs.writeFileSync(
    path.join(dataDir, 'settings.json'),
    JSON.stringify({ ANTIGRAVITY_ENABLED: false, CURSOR_ENABLED: false }),
  );
  port = await getFreePort();
  base = `http://127.0.0.1:${port}`;

  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      TOKENOMICS_DATA_DIR: dataDir,
      REFRESH_MS: '600000',
      HISTORY_INTERVAL_MS: '600000',
      ANTIGRAVITY_POLL_MS: '600000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start in time')), 15000);
    let out = '';
    child.stdout.on('data', d => {
      out += d;
      if (out.includes('Tokenomics →')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error('server exited early, code ' + code)); });
  });
});

after(() => {
  if (child) child.kill('SIGKILL');
});

test('GET / serves the dashboard HTML with the module entry point', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const body = await res.text();
  assert.match(body, /<script type="module" src="\/web\/main\.js">/);
});

test('GET /index.css serves the stylesheet', async () => {
  const res = await fetch(base + '/index.css');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/css/);
});

test('GET /web/*.js serves frontend modules as JavaScript', async () => {
  for (const mod of ['main.js', 'format.js', 'pricing.js', 'cards.js']) {
    const res = await fetch(`${base}/web/${mod}`);
    assert.equal(res.status, 200, `${mod} should be 200`);
    assert.match(res.headers.get('content-type'), /javascript/);
  }
});

test('GET a missing module returns 404', async () => {
  const res = await fetch(base + '/web/does-not-exist.js');
  assert.equal(res.status, 404);
});

test('path traversal via /web/ is blocked', async () => {
  // literal ../ escapes the regex but is caught by the resolve+prefix guard → 403
  const literal = await rawGet('/web/../../server.js');
  assert.equal(literal.status, 403);
  // encoded slashes never match the strict route regex → 404
  const encoded = await rawGet('/web/..%2f..%2fserver.js');
  assert.equal(encoded.status, 404);
});

test('GET /api/settings returns config with pricing and visibility flags', async () => {
  const res = await fetch(base + '/api/settings');
  assert.equal(res.status, 200);
  const cfg = await res.json();
  assert.ok(Array.isArray(cfg.PRICING) && cfg.PRICING.length > 0);
  for (const k of ['RTK_ENABLED', 'CAVEMAN_ENABLED', 'CLAUDE_ENABLED', 'HEADROOM_ENABLED']) {
    assert.equal(typeof cfg[k], 'boolean', `${k} should be boolean`);
  }
});

test('POST /api/settings persists changes and GET reflects them', async () => {
  const layout = { 'rtk-card': { x: 5, y: 6, w: 250 } };
  const post = await fetch(base + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RTK_ENABLED: false, CARD_LAYOUT: layout }),
  });
  assert.equal(post.status, 200);
  const result = await post.json();
  assert.equal(result.success, true);

  const cfg = await (await fetch(base + '/api/settings')).json();
  assert.equal(cfg.RTK_ENABLED, false);
  assert.deepEqual(cfg.CARD_LAYOUT, layout);
});

test('POST /api/settings rejects invalid JSON with 400', async () => {
  const res = await fetch(base + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ not valid json',
  });
  assert.equal(res.status, 400);
});

test('GET /api/history returns a JSON array', async () => {
  const res = await fetch(base + '/api/history');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(await res.json()));
});

test('GET /api/activity returns a capped JSON array of before→after rows', async () => {
  const res = await fetch(base + '/api/activity?limit=5');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const rows = await res.json();
  assert.ok(Array.isArray(rows));
  assert.ok(rows.length <= 5, 'limit honored');
  for (const r of rows) {
    for (const k of ['source', 'ts', 'label', 'before', 'after', 'saved', 'pct']) {
      assert.ok(k in r, `activity row missing key: ${k}`);
    }
  }
});

test('GET /api/stats returns the full stats shape (collectors degrade gracefully)', async () => {
  const res = await fetch(base + '/api/stats');
  assert.equal(res.status, 200);
  const s = await res.json();
  for (const k of ['rtk', 'caveman', 'headroom', 'cursor', 'antigravity', 'visibility', 'last_used', 'timestamp', 'refresh_ms']) {
    assert.ok(k in s, `stats missing key: ${k}`);
  }
  // disabled collectors report it rather than spawning/networking
  assert.equal(s.cursor.disabled, true);
  assert.equal(s.antigravity.disabled, true);
});

test('GET /api/events opens an SSE stream and pushes an initial snapshot', async () => {
  const { status, firstChunk } = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/events', method: 'GET' }, res => {
      res.on('data', c => {
        resolve({ status: res.statusCode, firstChunk: c.toString() });
        req.destroy(); // don't keep the long-lived stream open
      });
    });
    req.on('error', err => { if (err.code !== 'ECONNRESET') reject(err); });
    req.end();
  });
  assert.equal(status, 200);
  assert.match(firstChunk, /^:ok|data:/m);
});

test('unknown routes return 404', async () => {
  const res = await fetch(base + '/totally/unknown');
  assert.equal(res.status, 404);
});
