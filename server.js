const http = require('http');
const fs = require('fs');
const path = require('path');
const { getSettings, updateSettings } = require('./src/settings');
const { collectStats, pollAntigravity, collectActivity } = require('./src/collectors');
const { history, recordSnapshot, clearHistory } = require('./src/history');
const { pollVersion } = require('./src/version');

const PORT = Number(process.env.PORT) || 3000;
const REFRESH_MS = Number(process.env.REFRESH_MS) || 10000;
const HISTORY_INTERVAL_MS = Number(process.env.HISTORY_INTERVAL_MS) || 60000;
const ANTIGRAVITY_POLL_MS = Number(process.env.ANTIGRAVITY_POLL_MS) || 300000;
// Tags change rarely + unauthenticated GitHub API is rate-limited, so the
// update check runs on a slow timer (default 1h) out of the fast SSE loop.
const VERSION_POLL_MS = Number(process.env.VERSION_POLL_MS) || 3600000;

const clients = new Set();

async function pushStats() {
  if (clients.size === 0) return;
  const stats = await collectStats();
  const data = `data: ${JSON.stringify(stats)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { clients.delete(res); }
  }
}

async function recordHistory() {
  try {
    const stats = await collectStats();
    recordSnapshot(stats);
  } catch (err) {
    console.error('History record task failed:', err.message);
  }
}

// Set up periodic tasks
setInterval(pushStats, REFRESH_MS);
setInterval(recordHistory, HISTORY_INTERVAL_MS);
// Antigravity is polled on a slow timer of its own: each poll spawns the heavy
// agy binary over a PTY (~15-20s), so it must stay out of the fast SSE loop.
setInterval(() => pollAntigravity().catch(err => console.error('Antigravity poll failed:', err)), ANTIGRAVITY_POLL_MS);
setInterval(() => pollVersion().catch(err => console.error('Version poll failed:', err)), VERSION_POLL_MS);

// Run initial history recording task on startup
recordHistory().catch(err => console.error('Initial history record failed:', err));
pollAntigravity().catch(err => console.error('Initial Antigravity poll failed:', err));
pollVersion().catch(err => console.error('Initial version poll failed:', err));

const server = http.createServer(async (req, res) => {
  if (req.url === '/') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      res.end(html);
    } catch (err) {
      res.writeHead(500);
      res.end('index.html not found');
    }
  } else if (req.url === '/index.css') {
    try {
      const css = fs.readFileSync(path.join(__dirname, 'index.css'));
      res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-cache' });
      res.end(css);
    } catch (err) {
      res.writeHead(404);
      res.end('index.css not found');
    }
  } else if (/^\/web\/[\w./-]+\.js$/.test(req.url)) {
    // Serve the ES-module frontend from src/web/. The regex already bars
    // traversal chars; resolve + prefix-check keeps it airtight.
    const webDir = path.join(__dirname, 'src', 'web');
    const file = path.join(webDir, req.url.slice('/web/'.length));
    if (!file.startsWith(webDir + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    try {
      const js = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' });
      res.end(js);
    } catch (err) {
      res.writeHead(404);
      res.end('module not found');
    }
  } else if (req.url === '/api/stats') {
    const stats = await collectStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } else if (req.url === '/api/history' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(history));
  } else if (req.url.startsWith('/api/activity') && req.method === 'GET') {
    // Per-operation before→after token feed. Lazy (not in the SSE loop) since it
    // tails Headroom's large proxy.log; reads RTK's SQLite + Headroom logs.
    const limit = Number(new URL(req.url, 'http://localhost').searchParams.get('limit')) || 50;
    const rows = await collectActivity({ limit });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows));
  } else if (req.url === '/api/history/reset' && req.method === 'POST') {
    // Reset all stats: wipe the recorded trend history. Live tool totals are
    // owned by the tools themselves and simply repopulate on the next refresh.
    clearHistory();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } else if (req.url === '/api/settings' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getSettings()));
  } else if (req.url === '/api/settings' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const updated = updateSettings(parsed);
        // Re-enabling Antigravity: kick off an immediate poll so the card
        // repopulates now instead of waiting for the next 5-min tick.
        if (updated.ANTIGRAVITY_ENABLED !== false) {
          pollAntigravity().catch(err => console.error('Antigravity poll failed:', err));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, settings: updated }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON: ' + err.message }));
      }
    });
  } else if (req.url === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(':ok\n\n');
    clients.add(res);

    const stats = await collectStats();
    res.write(`data: ${JSON.stringify(stats)}\n\n`);

    const ping = setInterval(() => {
      try { res.write(':ping\n\n'); } catch { clearInterval(ping); clients.delete(res); }
    }, 15000);

    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Tokenomics → http://localhost:${PORT}`);
});
