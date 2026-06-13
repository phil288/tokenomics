const http = require('http');
const fs = require('fs');
const path = require('path');
const { getSettings, updateSettings } = require('./src/settings');
const { collectStats } = require('./src/collectors');
const { history, recordSnapshot } = require('./src/history');

const PORT = Number(process.env.PORT) || 3000;
const REFRESH_MS = Number(process.env.REFRESH_MS) || 10000;
const HISTORY_INTERVAL_MS = Number(process.env.HISTORY_INTERVAL_MS) || 60000;

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

// Run initial history recording task on startup
recordHistory().catch(err => console.error('Initial history record failed:', err));

const server = http.createServer(async (req, res) => {
  if (req.url === '/') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (err) {
      res.writeHead(500);
      res.end('index.html not found');
    }
  } else if (req.url === '/api/stats') {
    const stats = await collectStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } else if (req.url === '/api/history') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(history));
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
