const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// snapd keeps old ~/snap/code/<rev> dirs as frozen copies of the live data;
// reading every revision multi-counted RTK history (see
// docs/tasks/2026-09-29-rtk-snap-revision-dedupe.md).
function withHome(setup, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-snap-rev-'));
  const saved = {
    TOKENOMICS_HOMES: process.env.TOKENOMICS_HOMES,
    TOKENOMICS_DATA_DIR: process.env.TOKENOMICS_DATA_DIR,
    RTK_DATA_HOME: process.env.RTK_DATA_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  };
  try {
    const home = path.join(root, 'phil');
    setup(home);
    process.env.TOKENOMICS_HOMES = home;
    process.env.TOKENOMICS_DATA_DIR = path.join(root, 'data');
    delete process.env.RTK_DATA_HOME;
    delete process.env.XDG_DATA_HOME;
    for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k];
    const { rtkDataHomes } = require('../src/collectors');
    fn(rtkDataHomes(), home);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k];
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function rtkDb(share) {
  fs.mkdirSync(path.join(share, 'rtk'), { recursive: true });
  fs.writeFileSync(path.join(share, 'rtk', 'history.db'), '');
}

const snapShare = (home, rev) => path.join(home, 'snap', 'code', rev, '.local', 'share');

test('rtkDataHomes reads only the current snap revision, not frozen copies', () => {
  withHome(home => {
    rtkDb(path.join(home, '.local', 'share'));
    rtkDb(snapShare(home, '264'));
    rtkDb(snapShare(home, '266'));
    fs.mkdirSync(path.join(home, 'snap', 'code', 'common'), { recursive: true });
    fs.symlinkSync('264', path.join(home, 'snap', 'code', 'current'));
  }, (homes, home) => {
    assert.deepEqual(homes, [path.join(home, '.local', 'share'), snapShare(home, '264')]);
  });
});

test('rtkDataHomes falls back to the highest snap revision without a current link', () => {
  withHome(home => {
    rtkDb(snapShare(home, '99'));
    rtkDb(snapShare(home, '264'));
    rtkDb(snapShare(home, '1000'));
  }, (homes, home) => {
    assert.deepEqual(homes, [snapShare(home, '1000')]);
  });
});

test('rtkDataHomes ignores a snap dir whose active revision has no RTK db', () => {
  withHome(home => {
    rtkDb(path.join(home, '.local', 'share'));
    rtkDb(snapShare(home, '264'));
    fs.mkdirSync(snapShare(home, '266'), { recursive: true });
    fs.symlinkSync('266', path.join(home, 'snap', 'code', 'current'));
  }, (homes, home) => {
    assert.deepEqual(homes, [path.join(home, '.local', 'share')]);
  });
});

test('collectRtkSince sums only rows at/after the cut, across mixed timestamp suffixes', () => {
  const { DatabaseSync } = require('node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-rtk-since-'));
  const old = process.env.RTK_DATA_HOME;
  try {
    fs.mkdirSync(path.join(dir, 'rtk'));
    const db = new DatabaseSync(path.join(dir, 'rtk', 'history.db'));
    db.exec('CREATE TABLE commands (id INTEGER PRIMARY KEY, timestamp TEXT, input_tokens INTEGER, '
      + 'output_tokens INTEGER, saved_tokens INTEGER, exec_time_ms INTEGER)');
    const ins = db.prepare('INSERT INTO commands (timestamp, input_tokens, output_tokens, saved_tokens, exec_time_ms) VALUES (?,?,?,?,?)');
    ins.run('2026-09-17T10:00:00Z', 9_000, 0, 9_000, 1);          // day before: prefiltered in, cut out
    ins.run('2026-09-18T11:59:59+00:00', 5_000, 0, 5_000, 1);     // 1 s before the cut
    ins.run('2026-09-18T12:00:00Z', 1_000, 200, 800, 10);         // exactly at the cut
    ins.run('2026-09-19T08:00:00.123+00:00', 300, 100, 200, 20);  // gain
    ins.run('2026-09-20T08:00:00Z', 50, 90, 0, 30);               // loss: saved 0, output > input
    db.close();
    process.env.RTK_DATA_HOME = dir;
    for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k];
    const { collectRtkSince } = require('../src/collectors');
    const r = collectRtkSince(Date.parse('2026-09-18T12:00:00Z'));
    assert.deepEqual(r.summary, {
      total_commands: 3, total_input: 1_350, total_output: 390, total_saved: 1_000,
      total_time_ms: 60, avg_savings_pct: (1_000 / 1_350) * 100, avg_time_ms: 20,
    });
    assert.deepEqual(r.totals, { gain: 1_000, loss: 40, net: 960, gainCmds: 2, lossCmds: 1 });
  } finally {
    if (old === undefined) delete process.env.RTK_DATA_HOME; else process.env.RTK_DATA_HOME = old;
    for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectRtkSince returns null when no RTK database can be read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-rtk-none-'));
  const old = process.env.RTK_DATA_HOME;
  try {
    process.env.RTK_DATA_HOME = dir;
    for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k];
    const { collectRtkSince } = require('../src/collectors');
    assert.equal(collectRtkSince(0), null);
  } finally {
    if (old === undefined) delete process.env.RTK_DATA_HOME; else process.env.RTK_DATA_HOME = old;
    for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
