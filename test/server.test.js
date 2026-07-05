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

test('GET / with a filter query string still serves the dashboard (refresh case)', async () => {
  // A page refresh while a source filter is active requests /?filter=rtk — that
  // must resolve to index.html, not 404. Routes match on path, not raw URL.
  const res = await fetch(base + '/?filter=rtk');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
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

test('GET /web/*.js with a query string still serves the module (cache-buster case)', async () => {
  // Module routes must match on path only — /web/main.js?v=123 is still main.js.
  const res = await fetch(base + '/web/main.js?v=123');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
});

test('POST /api/settings rejects oversized payloads with 413', async () => {
  const res = await fetch(base + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RTK_DATA_HOME: 'x'.repeat(1_100_000) }),
  }).catch(() => null);
  // Server may destroy the socket after replying; accept either a clean 413
  // or a reset connection — but never a 200.
  if (res) assert.equal(res.status, 413);
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

test('POST /api/history/reset without the confirm header is rejected and writes no baseline', async () => {
  const baselineFile = path.join(dataDir, 'baseline.json');
  const res = await fetch(base + '/api/history/reset', { method: 'POST' });
  assert.equal(res.status, 400);
  assert.ok(!fs.existsSync(baselineFile), 'unconfirmed reset must not write baseline.json');
});

test('POST /api/history/reset clears history and writes a baseline; DELETE /api/baseline removes it', async () => {
  const baselineFile = path.join(dataDir, 'baseline.json');

  const reset = await fetch(base + '/api/history/reset', {
    method: 'POST',
    headers: { 'X-Tokenomics-Reset-Confirm': 'manual' },
  });
  assert.equal(reset.status, 200);
  assert.equal((await reset.json()).success, true);
  // reset captures the current absolute totals as a baseline on disk...
  assert.ok(fs.existsSync(baselineFile), 'reset should write baseline.json');
  const snap = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  for (const k of ['t', 'rtk', 'caveman', 'headroom']) assert.ok(k in snap, `baseline missing ${k}`);
  // ...and empties the trend history.
  assert.deepEqual(await (await fetch(base + '/api/history')).json(), []);

  const restore = await fetch(base + '/api/baseline', { method: 'DELETE' });
  assert.equal(restore.status, 200);
  assert.equal((await restore.json()).success, true);
  assert.ok(!fs.existsSync(baselineFile), 'DELETE should remove baseline.json');
});

test('GET /api/activity returns { rows, rtk } with capped before→after rows + lifetime totals', async () => {
  const res = await fetch(base + '/api/activity?limit=5');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const data = await res.json();
  assert.ok(!Array.isArray(data) && typeof data === 'object', 'response is an object, not a bare array');
  const { rows, rtk } = data;
  assert.ok(Array.isArray(rows));
  assert.ok(rows.length <= 5, 'limit honored');
  for (const r of rows) {
    for (const k of ['source', 'ts', 'label', 'before', 'after', 'saved', 'pct']) {
      assert.ok(k in r, `activity row missing key: ${k}`);
    }
  }
  // full-history RTK gain/loss tally
  for (const k of ['gain', 'loss', 'net', 'gainCmds', 'lossCmds']) {
    assert.ok(k in rtk, `rtk totals missing key: ${k}`);
    assert.equal(typeof rtk[k], 'number', `rtk.${k} should be numeric`);
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

// ---- Analysis view: on-demand /api/analysis/* endpoints ----

test('GET /api/analysis/* routes return 200 JSON with their documented top-level keys', async () => {
  const cases = [
    ['rtk/projects', ['projects', 'since']],
    ['rtk/losses?limit=5', ['rows', 'total_loss_rows', 'since']],
    ['rtk/commands', ['types', 'since']],
    ['caveman?series=3', ['sessions', 'by_model', 'by_mode', 'series', 'since']],
    ['headroom/models?points=50', ['models', 'total_points_raw', 'since']],
    ['headroom/ops?bytes=65536', ['strategies', 'transforms', 'clients', 'cache_trend', 'window_bytes', 'window_partial']],
  ];
  for (const [sub, keys] of cases) {
    const res = await fetch(`${base}/api/analysis/${sub}`);
    assert.equal(res.status, 200, `${sub} should be 200`);
    const body = await res.json();
    for (const k of keys) assert.ok(k in body, `${sub} missing key ${k}`);
  }
});

test('unknown /api/analysis subpath returns 404', async () => {
  const res = await fetch(base + '/api/analysis/nope');
  assert.equal(res.status, 404);
});

test('/api/analysis/headroom/ops clamps the byte window', async () => {
  const lo = await (await fetch(base + '/api/analysis/headroom/ops?bytes=10')).json();
  assert.equal(lo.window_bytes, 65536);
  const hi = await (await fetch(base + '/api/analysis/headroom/ops?bytes=99999999')).json();
  assert.equal(hi.window_bytes, 8388608);
});

test('Phase 0: /api/stats headroom.savings carries no history/projects (stripped from SSE payload)', async () => {
  const s = await (await fetch(base + '/api/stats')).json();
  const savings = s.headroom && s.headroom.savings;
  if (savings) {
    assert.equal('history' in savings, false, 'history must be stripped');
    assert.equal('projects' in savings, false, 'projects must be stripped');
  }
});
