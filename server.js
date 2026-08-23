const http = require('http');
const fs = require('fs');
const path = require('path');
const { getSettings, updateSettings } = require('./src/settings');
const { collectStats, collectStatsRaw, pollAntigravity, pollClaude, collectActivity, collectRtkTotals, resolveCursorToken, testCursorToken } = require('./src/collectors');
const { history, recordSnapshot, clearHistory } = require('./src/history');
const { captureBaseline, clearBaseline, applyActivityBaseline } = require('./src/baseline');
const analysis = require('./src/analysis');
const { pollVersion } = require('./src/version');

// On-demand deep-analysis routes (never in the SSE loop). Each handler gets the
// parsed query params and returns a JSON-serializable payload; baseline
// filtering happens inside src/analysis.js.
const ANALYSIS_ROUTES = {
  'rtk/projects': () => analysis.rtkProjects(),
  'rtk/losses': (q) => analysis.rtkLosses({ limit: q.get('limit') }),
  'rtk/commands': () => analysis.rtkCommandTypes(),
  'caveman': (q) => analysis.cavemanAnalysis({ series: q.get('series') }),
  'headroom/models': (q) => analysis.headroomModels({ points: q.get('points') }),
  'headroom/ops': (q) => analysis.headroomOps({ bytes: q.get('bytes') }),
};

const PORT = Number(process.env.PORT) || 3000;
const REFRESH_MS = Number(process.env.REFRESH_MS) || 10000;
const HISTORY_INTERVAL_MS = Number(process.env.HISTORY_INTERVAL_MS) || 60000;
const ANTIGRAVITY_POLL_MS = Number(process.env.ANTIGRAVITY_POLL_MS) || 300000;
// `claude /usage` costs ~11s per call (longer than the SSE refresh), so the
// Claude quota poll gets its own slow timer too.
const CLAUDE_POLL_MS = Number(process.env.CLAUDE_POLL_MS) || 300000;
// Tags change rarely + unauthenticated GitHub API is rate-limited, so the
// update check runs on a slow timer (default 1h) out of the fast SSE loop.
const VERSION_POLL_MS = Number(process.env.VERSION_POLL_MS) || 3600000;

const clients = new Set();

async function pushStats() {
  if (clients.size === 0) return;
  const stats = await collectStats();
  const data = `data: ${JSON.stringify(stats)}\n\n`;
  for (const res of [...clients]) {
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
setInterval(() => pollClaude().catch(err => console.error('Claude poll failed:', err)), CLAUDE_POLL_MS);
setInterval(() => pollVersion().catch(err => console.error('Version poll failed:', err)), VERSION_POLL_MS);

// Run initial history recording task on startup
recordHistory().catch(err => console.error('Initial history record failed:', err));
pollAntigravity().catch(err => console.error('Initial Antigravity poll failed:', err));
pollClaude().catch(err => console.error('Initial Claude poll failed:', err));
pollVersion().catch(err => console.error('Initial version poll failed:', err));

const server = http.createServer(async (req, res) => {
  // Match routes on the path only — a refresh carries the client's filter as a
  // query string (e.g. /?filter=rtk), which must still resolve to index.html.
  const pathname = req.url.split('?')[0];
  if (pathname === '/') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      res.end(html);
    } catch (err) {
      res.writeHead(500);
      res.end('index.html not found');
    }
  } else if (pathname === '/index.css') {
    try {
      const css = fs.readFileSync(path.join(__dirname, 'index.css'));
      res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-cache' });
      res.end(css);
    } catch (err) {
      res.writeHead(404);
      res.end('index.css not found');
    }
  } else if (/^\/web\/[\w./-]+\.js$/.test(pathname)) {
    // Serve the ES-module frontend from src/web/. The regex narrows the
    // charset, but still admits ".." — the prefix-check below is what
    // actually bars traversal.
    const webDir = path.join(__dirname, 'src', 'web');
    const file = path.join(webDir, pathname.slice('/web/'.length));
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
  } else if (pathname === '/api/stats') {
    const stats = await collectStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } else if (pathname === '/api/history' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(history));
  } else if (pathname === '/api/activity' && req.method === 'GET') {
    // Per-operation before→after token feed. Lazy (not in the SSE loop) since it
    // tails Headroom's large proxy.log; reads RTK's SQLite + Headroom logs.
    const limit = Number(new URL(req.url, 'http://localhost').searchParams.get('limit')) || 50;
    const rows = await collectActivity({ limit });
    // rtk: full-history gain/loss totals (whole DB, not just the loaded window).
    const rtk = collectRtkTotals();
    // Honour an active reset baseline: only show events after the reset, and
    // offset the lifetime gain/loss totals by their value at reset.
    const payload = applyActivityBaseline({ rows, rtk });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  } else if (pathname.startsWith('/api/analysis/') && req.method === 'GET') {
    // Deep-analysis drill-downs. On-demand only — the Analysis view fetches
    // these when visible; nothing here runs on the 10s SSE loop.
    const handler = ANALYSIS_ROUTES[pathname.slice('/api/analysis/'.length)];
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown analysis endpoint' }));
      return;
    }
    try {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const payload = handler(q);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (pathname === '/api/history/reset' && req.method === 'POST') {
    // Reset all stats: wipe the recorded trend history AND capture the current
    // absolute tool totals as a baseline. From now on every reading is shown
    // minus this baseline, so the headline numbers start at zero — without ever
    // touching the tools' own ledgers (fully reversible via DELETE /api/baseline).
    // UI-only confirmation header: the dashboard sends it after its confirm()
    // dialog, so a stray scripted POST cannot silently capture a new baseline.
    if (req.headers['x-tokenomics-reset-confirm'] !== 'manual') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Reset requires the X-Tokenomics-Reset-Confirm: manual header' }));
      return;
    }
    const raw = await collectStatsRaw();
    captureBaseline(raw, collectRtkTotals());
    clearHistory();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } else if (pathname === '/api/baseline' && req.method === 'DELETE') {
    // Restore the absolute (all-time) view: drop the reset baseline. Trend
    // history is not resurrected — only future readings return to raw totals.
    clearBaseline();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } else if (pathname === '/api/cursor/token' && req.method === 'GET') {
    // On-demand reveal of the effective Cursor token (settings → env → DB).
    // Kept OUT of /api/settings so the JWT never rides the routine settings
    // fetch — the UI asks for it only when the user clicks reveal on an empty
    // field. Honours the CURSOR_ENABLED gate.
    if (getSettings().CURSOR_ENABLED === false) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token: null, source: null }));
    } else {
      const { token, source } = resolveCursorToken();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token: token || null, source }));
    }
  } else if (pathname === '/api/cursor/test' && req.method === 'POST') {
    // Validate a Cursor token against the live API. Body { token } is optional —
    // blank tests the effective (settings/env/DB) token, so the user can check
    // either a value they just typed OR the stored one before saving.
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 1e6) {   // a JWT is a few KB; anything near 1MB is garbage
        tooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });
    req.on('end', async () => {
      if (tooLarge) return;
      let token = '';
      if (body) {
        try { token = JSON.parse(body).token || ''; }
        catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON: ' + err.message }));
          return;
        }
      }
      try {
        const result = await testCursorToken(token);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  } else if (pathname === '/api/settings' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getSettings()));
  } else if (pathname === '/api/settings' && req.method === 'POST') {
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      // Settings payloads are tiny (toggles + pricing rows); anything near a
      // megabyte is garbage — refuse instead of buffering unbounded input.
      if (body.length > 1e6) {
        tooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const parsed = JSON.parse(body);
        const updated = updateSettings(parsed);
        // Re-enabling Antigravity: kick off an immediate poll so the card
        // repopulates now instead of waiting for the next 5-min tick.
        if (updated.ANTIGRAVITY_ENABLED !== false) {
          pollAntigravity().catch(err => console.error('Antigravity poll failed:', err));
        }
        // Same for Claude: re-enabling should repopulate the card immediately
        // rather than after the next slow tick.
        if (updated.CLAUDE_ENABLED !== false) {
          pollClaude().catch(err => console.error('Claude poll failed:', err));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, settings: updated }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON: ' + err.message }));
      }
    });
  } else if (pathname === '/api/events') {
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
