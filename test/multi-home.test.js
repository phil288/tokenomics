const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('TOKENOMICS_HOMES aggregates Caveman and Headroom state across homes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-multi-home-'));
  const homes = [path.join(root, 'alice'), path.join(root, 'bob')];
  for (const home of homes) {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(home, '.headroom'), { recursive: true });
    fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'rtk'), { recursive: true });
  }

  fs.writeFileSync(path.join(homes[0], '.claude', '.caveman-active'), 'lite\n');
  fs.writeFileSync(path.join(homes[0], '.claude', '.caveman-history.jsonl'),
    JSON.stringify({ session_id: 'a', ts: 1, output_tokens: 100, est_saved_tokens: 40, est_saved_usd: 0.01 }) + '\n');
  fs.writeFileSync(path.join(homes[1], '.claude', '.caveman-active'), 'ultra\n');
  fs.writeFileSync(path.join(homes[1], '.claude', '.caveman-history.jsonl'),
    JSON.stringify({ session_id: 'b', ts: 2, output_tokens: 200, est_saved_tokens: 60, est_saved_usd: 0.02 }) + '\n');

  fs.writeFileSync(path.join(homes[0], '.headroom', 'subscription_state.json'), JSON.stringify({
    window_tokens: { input: 10, output: 5, cache_reads: 30, total_raw: 45, weighted_token_equivalent: 18 },
  }));
  fs.writeFileSync(path.join(homes[1], '.headroom', 'subscription_state.json'), JSON.stringify({
    window_tokens: { input: 20, output: 7, cache_reads: 40, total_raw: 67, weighted_token_equivalent: 31 },
  }));
  fs.writeFileSync(path.join(homes[0], '.headroom', 'proxy_savings.json'), JSON.stringify({
    lifetime: { tokens_saved: 1000, requests: 3, compression_savings_usd: 0.1 },
  }));
  fs.writeFileSync(path.join(homes[1], '.headroom', 'proxy_savings.json'), JSON.stringify({
    lifetime: { tokens_saved: 2000, requests: 4, compression_savings_usd: 0.2 },
  }));

  process.env.TOKENOMICS_HOMES = homes.join(',');
  const { updateSettings } = require('../src/settings');
  updateSettings({ HEADROOM_HEALTH_URL: '' });
  fs.writeFileSync(path.join(homes[0], 'Library', 'Application Support', 'rtk', 'history.db'), '');

  const { collectCaveman, collectHeadroom, configuredHomes, rtkDataHomes } = require('../src/collectors');

  assert.deepEqual(configuredHomes(), homes);
  assert.deepEqual(rtkDataHomes(), [path.join(homes[0], 'Library', 'Application Support')]);

  const caveman = await collectCaveman();
  assert.equal(caveman.session_count, 2);
  assert.equal(caveman.total_output_tokens, 300);
  assert.equal(caveman.total_saved_tokens, 100);
  assert.equal(caveman.total_saved_usd, 0.03);

  const headroom = await collectHeadroom();
  assert.equal(headroom.sources, 2);
  assert.equal(headroom.window_tokens.input, 30);
  assert.equal(headroom.window_tokens.total_raw, 112);
  assert.equal(headroom.savings.lifetime.tokens_saved, 3000);
  assert.equal(headroom.savings.lifetime.requests, 7);
});
