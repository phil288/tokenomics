// Tests for the on-demand deep-analysis aggregations (src/analysis.js) and the
// caveman activity source. Each builds real fixtures (SQLite / jsonl / json) in
// a temp dir and drives the actual code — mirroring test/collectors.test.js.
//
// IMPORTANT: baseline.js reads TOKENOMICS_DATA_DIR at require time, so we pin it
// to a temp dir BEFORE requiring anything that pulls baseline in. Node runs each
// test file in its own process, so this is isolated.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-an-data-'));
process.env.TOKENOMICS_DATA_DIR = DATA_DIR;

const analysis = require('../src/analysis');
const baseline = require('../src/baseline');
const { collectActivity } = require('../src/collectors');

// Force a baseline with an exact cut time (bypasses Date.now nondeterminism).
function setCut(t) {
  fs.writeFileSync(path.join(DATA_DIR, 'baseline.json'), JSON.stringify({ t }));
  baseline.loadBaseline();
}
afterEach(() => { baseline.clearBaseline(); delete process.env.RTK_DATA_HOME; });

// ---- RTK fixtures ----
const RTK_COLS = 'timestamp TEXT, original_cmd TEXT, rtk_cmd TEXT, project_path TEXT, '
  + 'input_tokens INTEGER, output_tokens INTEGER, saved_tokens INTEGER, savings_pct REAL, exec_time_ms INTEGER';

function makeRtkDb(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-an-rtk-'));
  fs.mkdirSync(path.join(dir, 'rtk'));
  const db = new DatabaseSync(path.join(dir, 'rtk', 'history.db'));
  db.exec(`CREATE TABLE commands (id INTEGER PRIMARY KEY, ${RTK_COLS})`);
  const stmt = db.prepare('INSERT INTO commands (timestamp, original_cmd, rtk_cmd, project_path, '
    + 'input_tokens, output_tokens, saved_tokens, savings_pct, exec_time_ms) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const r of rows) {
    stmt.run(r.ts, r.orig, r.rtk || `rtk ${r.orig}`, r.proj || '',
      r.in, r.out, Math.max(0, r.in - r.out), r.in ? ((r.in - r.out) / r.in) * 100 : 0, r.ms || 0);
  }
  db.close();
  process.env.RTK_DATA_HOME = dir;
  return dir;
}

test('rtkProjects aggregates gain/loss/net per project, unknown bucket, net-sorted', () => {
  makeRtkDb([
    { ts: '2026-06-19T10:00:00+00:00', orig: 'git status', proj: '/home/u/a', in: 1000, out: 200 }, // gain 800
    { ts: '2026-06-19T10:01:00+00:00', orig: 'git log', proj: '/home/u/a', in: 500, out: 100 },     // gain 400
    { ts: '2026-06-19T10:02:00+00:00', orig: 'cargo build', proj: '', in: 100, out: 250 },           // loss 150, unknown
  ]);
  const { projects } = analysis.rtkProjects();
  assert.equal(projects.length, 2);
  assert.equal(projects[0].path, '/home/u/a');   // net 1200, sorts first
  assert.equal(projects[0].commands, 2);
  assert.equal(projects[0].gain, 1200);
  assert.equal(projects[0].net, 1200);
  const unknown = projects.find(p => p.path === '(unknown)');
  assert.equal(unknown.loss, 150);
  assert.equal(unknown.net, -150);
});

test('rtkLosses returns only output>input rows, worst-first', () => {
  makeRtkDb([
    { ts: '2026-06-19T10:00:00+00:00', orig: 'grep foo', in: 100, out: 400 }, // lost 300
    { ts: '2026-06-19T10:01:00+00:00', orig: 'git status', in: 1000, out: 50 }, // gain, excluded
    { ts: '2026-06-19T10:02:00+00:00', orig: 'ls -la', in: 100, out: 120 },    // lost 20
  ]);
  const { rows, total_loss_rows } = analysis.rtkLosses({ limit: 50 });
  assert.equal(total_loss_rows, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].original_cmd, 'grep foo');
  assert.equal(rows[0].lost, 300);
  assert.equal(rows[1].lost, 20);
});

test('rtkLosses clamps limit to 1..200', () => {
  makeRtkDb([{ ts: '2026-06-19T10:00:00+00:00', orig: 'x', in: 1, out: 9 }]);
  assert.equal(analysis.rtkLosses({ limit: 9999 }).rows.length <= 200, true);
  assert.equal(analysis.rtkLosses({ limit: 0 }).rows.length, 1); // clamped up to 1
});

test('rtkCommandTypes groups by type, splits multiplexers, tracks passthrough', () => {
  makeRtkDb([
    { ts: '2026-06-19T10:00:00+00:00', orig: 'git status -sb', in: 1000, out: 200, ms: 10 },
    { ts: '2026-06-19T10:01:00+00:00', orig: 'git status', in: 500, out: 100, ms: 20 },
    { ts: '2026-06-19T10:02:00+00:00', orig: 'git commit -m x', in: 300, out: 300, ms: 5 }, // passthrough
    { ts: '2026-06-19T10:03:00+00:00', orig: 'grep -r foo', in: 400, out: 100, ms: 8 },
  ]);
  const { types } = analysis.rtkCommandTypes();
  const gitStatus = types.find(t => t.type === 'git status');
  assert.equal(gitStatus.commands, 2);
  assert.equal(gitStatus.gain, 1200);
  assert.equal(gitStatus.avg_time_ms, 15);
  const gitCommit = types.find(t => t.type === 'git commit');
  assert.equal(gitCommit.passthrough, 1);
  assert.equal(gitCommit.passthrough_rate, 100);
  assert.ok(types.find(t => t.type === 'grep'));
});

test('commandType strips leading rtk and options', () => {
  assert.equal(analysis.commandType('rtk git status -sb'), 'git status');
  assert.equal(analysis.commandType('grep -r foo'), 'grep');
  assert.equal(analysis.commandType('cargo build --release'), 'cargo build');
  assert.equal(analysis.commandType(''), '(unknown)');
});

test('RTK baseline cut drops pre-reset rows (mixed +00:00 / Z suffixes)', () => {
  makeRtkDb([
    { ts: '2026-06-19T10:00:00+00:00', orig: 'git old', proj: '/p', in: 1000, out: 100 }, // before cut
    { ts: '2026-06-19T12:00:00Z', orig: 'git new', proj: '/p', in: 1000, out: 100 },       // after cut
  ]);
  setCut(Date.parse('2026-06-19T11:00:00Z'));
  const { projects, since } = analysis.rtkProjects();
  assert.equal(since, Date.parse('2026-06-19T11:00:00Z'));
  assert.equal(projects.length, 1);
  assert.equal(projects[0].commands, 1); // only the post-reset row
  assert.equal(projects[0].gain, 900);
});

// ---- Caveman ----
function writeCaveman(lines) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tok-an-cav-')), 'hist.jsonl');
  fs.writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  process.env.CAVEMAN_HISTORY_PATH = p;
  return p;
}

test('cavemanAnalysis: latest-per-session table, by-model/mode sums, growth series', () => {
  writeCaveman([
    { ts: 1000, session_id: 's1', mode: 'full', model: 'claude-opus-4-8', output_tokens: 100, est_saved_tokens: 50, est_saved_usd: 0.01 },
    { ts: 2000, session_id: 's1', mode: 'full', model: 'claude-opus-4-8', output_tokens: 300, est_saved_tokens: 200, est_saved_usd: 0.04 },
    { ts: 1500, session_id: 's2', mode: 'ultra', model: 'claude-sonnet-5', output_tokens: 80, est_saved_tokens: 500, est_saved_usd: 0.02 },
  ]);
  const d = analysis.cavemanAnalysis({ series: 10 });
  assert.equal(d.sessions.length, 2);
  // s2 saved 500 > s1 latest 200 → s2 first
  assert.equal(d.sessions[0].session_id, 's2');
  assert.equal(d.sessions[0].est_saved_tokens, 500);
  const s1 = d.sessions.find(s => s.session_id === 's1');
  assert.equal(s1.est_saved_tokens, 200); // latest row only
  assert.equal(s1.events, 2);
  // by_model sums the LATEST-per-session rows
  const opus = d.by_model.find(m => m.model === 'claude-opus-4-8');
  assert.equal(opus.est_saved_tokens, 200);
  assert.equal(d.by_mode.find(m => m.mode === 'full').sessions, 1);
  // growth series: s1 has 2 points ordered by ts
  const g1 = d.series.find(s => s.session_id === 's1');
  assert.equal(g1.points.length, 2);
  assert.equal(g1.points[0].est_saved_tokens, 50);
  assert.equal(g1.points[1].est_saved_tokens, 200);
});

test('cavemanAnalysis: series clamped, baseline cut filters rows', () => {
  writeCaveman([
    { ts: 1000, session_id: 'old', mode: 'full', model: 'm', output_tokens: 10, est_saved_tokens: 10 },
    { ts: 5000, session_id: 'new', mode: 'full', model: 'm', output_tokens: 10, est_saved_tokens: 90 },
  ]);
  setCut(3000);
  const d = analysis.cavemanAnalysis({ series: 999 });
  assert.equal(d.since, 3000);
  assert.equal(d.sessions.length, 1);
  assert.equal(d.sessions[0].session_id, 'new');
});

// ---- Headroom models ----
function writeSavings(history) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tok-an-hr-')), 'proxy_savings.json');
  fs.writeFileSync(p, JSON.stringify({ lifetime: {}, history }));
  process.env.HEADROOM_SAVINGS_PATH = p;
  return p;
}

test('headroomModels groups per model, keeps last point exact, sorts by saved', () => {
  writeSavings([
    { timestamp: '2026-06-19T10:00:00Z', provider: 'anthropic', model: 'opus', total_tokens_saved: 100, compression_savings_usd: 1 },
    { timestamp: '2026-06-19T11:00:00Z', provider: 'anthropic', model: 'opus', total_tokens_saved: 300, compression_savings_usd: 3 },
    { timestamp: '2026-06-19T10:30:00Z', provider: 'anthropic', model: 'sonnet', total_tokens_saved: 50, compression_savings_usd: 0.5 },
  ]);
  const { models, total_points_raw } = analysis.headroomModels({ points: 300 });
  assert.equal(total_points_raw, 3);
  assert.equal(models[0].model, 'opus'); // 300 > 50
  const opus = models[0];
  assert.equal(opus.points[opus.points.length - 1].saved_tokens, 300);
});

test('headroomModels downsamples to <= points, keeping last', () => {
  const hist = [];
  for (let i = 0; i < 100; i++) {
    hist.push({ timestamp: new Date(Date.UTC(2026, 5, 19, 0, i)).toISOString(), provider: 'a', model: 'opus', total_tokens_saved: i, compression_savings_usd: 0 });
  }
  writeSavings(hist);
  const { models } = analysis.headroomModels({ points: 10 });
  assert.ok(models[0].points.length <= 10);
  assert.equal(models[0].points[models[0].points.length - 1].saved_tokens, 99);
});

test('headroomModels rebases cumulative series at reset', () => {
  writeSavings([
    { timestamp: '2026-06-19T10:00:00Z', provider: 'a', model: 'opus', total_tokens_saved: 100, compression_savings_usd: 1 },
    { timestamp: '2026-06-19T12:00:00Z', provider: 'a', model: 'opus', total_tokens_saved: 500, compression_savings_usd: 5 },
  ]);
  setCut(Date.parse('2026-06-19T11:00:00Z'));
  const { models } = analysis.headroomModels({ points: 300 });
  // last point rebased: 500 - 100 (pre-reset value) = 400
  const last = models[0].points[models[0].points.length - 1];
  assert.equal(last.saved_tokens, 400);
  assert.equal(last.saved_usd, 4);
});

// ---- Headroom ops (strategy/transform/client + cache trend) ----
test('headroomOps aggregates strategies, transforms, clients, cache trend; flags partial window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-an-ops-'));
  const stats = path.join(dir, 'session_stats.jsonl');
  fs.writeFileSync(stats, [
    JSON.stringify({ type: 'compress', input_tokens: 400, output_tokens: 180, savings_percent: 55, strategy: 'router:dedup', timestamp: 1781870000 }),
    JSON.stringify({ type: 'compress', input_tokens: 200, output_tokens: 100, savings_percent: 50, strategy: 'router:dedup', timestamp: 1781870001 }),
    JSON.stringify({ type: 'retrieve', hash: 'x', timestamp: 1781870002 }),
  ].join('\n') + '\n');
  const log = path.join(dir, 'proxy.log');
  fs.writeFileSync(log, [
    '2026-06-19 14:29:19,130 - headroom.proxy - INFO - [hr_1] PERF model=claude-opus-4-8 msgs=2 tok_before=6000 tok_after=1000 tok_saved=5000 cache_read=5000 cache_write=0 cache_hit_pct=90 transforms=router:noop client=claude-code',
    '2026-06-19 14:30:19,130 - headroom.proxy - INFO - [hr_2] PERF model=claude-opus-4-8 msgs=2 tok_before=4000 tok_after=1000 tok_saved=3000 cache_read=3000 cache_write=0 cache_hit_pct=80 transforms=router:noop client=claude-code',
  ].join('\n') + '\n');
  process.env.HEADROOM_SESSION_STATS_PATH = stats;
  process.env.HEADROOM_PROXY_LOG_PATH = log;

  const d = analysis.headroomOps({ bytes: 65536 });
  const dedup = d.strategies.find(s => s.strategy === 'router:dedup');
  assert.equal(dedup.events, 2);
  assert.equal(dedup.before, 600);
  assert.equal(dedup.saved, 320);
  const noop = d.transforms.find(t => t.transform === 'router:noop');
  assert.equal(noop.requests, 2);
  assert.equal(noop.saved, 8000);
  const cc = d.clients.find(c => c.client === 'claude-code');
  assert.equal(cc.requests, 2);
  assert.equal(d.cache_trend.length, 2);
  assert.equal(d.window_partial, false); // 64 KB window > tiny fixture

  delete process.env.HEADROOM_SESSION_STATS_PATH;
  delete process.env.HEADROOM_PROXY_LOG_PATH;
});

test('headroomOps clamps byte window to 64KB..8MB', () => {
  process.env.HEADROOM_SESSION_STATS_PATH = '/nonexistent';
  process.env.HEADROOM_PROXY_LOG_PATH = '/nonexistent';
  assert.equal(analysis.headroomOps({ bytes: 10 }).window_bytes, 65536);
  assert.equal(analysis.headroomOps({ bytes: 99999999 }).window_bytes, 8388608);
  delete process.env.HEADROOM_SESSION_STATS_PATH;
  delete process.env.HEADROOM_PROXY_LOG_PATH;
});

// ---- caveman activity source (collectActivity) ----
test('collectActivity emits caveman rows: before = output + saved', async () => {
  writeCaveman([
    { ts: 1781870000000, session_id: 'sess-abcdef12', mode: 'full', model: 'claude-opus-4-8', output_tokens: 200, est_saved_tokens: 800, est_saved_usd: 0.012 },
  ]);
  process.env.RTK_DATA_HOME = path.join(os.tmpdir(), 'no-such-rtk');
  process.env.HEADROOM_SESSION_STATS_PATH = '/nonexistent';
  process.env.HEADROOM_PROXY_LOG_PATH = '/nonexistent';
  const rows = await collectActivity({ limit: 50 });
  const cav = rows.filter(r => r.source === 'caveman');
  assert.equal(cav.length, 1);
  assert.equal(cav[0].before, 1000); // 200 output + 800 saved
  assert.equal(cav[0].after, 200);
  assert.equal(cav[0].saved, 800);
  const info = Object.fromEntries(cav[0].info.map(([k, v]) => [k, v]));
  assert.equal(info['mode'], 'full');
  assert.equal(info['model'], 'claude-opus-4-8');
  delete process.env.CAVEMAN_HISTORY_PATH;
  delete process.env.HEADROOM_SESSION_STATS_PATH;
  delete process.env.HEADROOM_PROXY_LOG_PATH;
});
