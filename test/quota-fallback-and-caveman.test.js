const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const COLLECTORS_JS = fs.readFileSync(path.join(ROOT, 'src', 'collectors.js'), 'utf8');
const CLAUDE_CARD_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'cards-claude.js'), 'utf8');
const CAVEMAN_COLLECTOR_JS = fs.readFileSync(path.join(ROOT, 'src', 'collectors-caveman.js'), 'utf8');
const CORE_CARDS_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'cards-core.js'), 'utf8');
const COMMON_CARDS_JS = fs.readFileSync(path.join(ROOT, 'src', 'web', 'cards-common.js'), 'utf8');

test('Claude Headroom fallback is age-limited so stale quota mirrors are withheld', () => {
  assert.match(COLLECTORS_JS, /CLAUDE_QUOTA_FALLBACK_MAX_AGE_MS/);
  assert.match(COLLECTORS_JS, /30 \* 60 \* 1000/);
  assert.match(COLLECTORS_JS, /isFreshEnough\(headroomPolledAt\)/);
  assert.match(COLLECTORS_JS, /fallback_blocked = 'headroom_stale'/);
});

test('Claude card labels quota source and reports stale fallback suppression', () => {
  assert.match(CLAUDE_CARD_JS, /function quotaSource\(d\)/);
  assert.match(CLAUDE_CARD_JS, /Headroom fallback/);
  assert.match(CLAUDE_CARD_JS, /Source: \$\{source\}/);
  assert.match(CLAUDE_CARD_JS, /stale Headroom fallback ignored/);
  assert.match(CLAUDE_CARD_JS, /polledFreshness\(d\.polled_at, quotaSource\(d\)\)/);
});

test('Caveman collector and card distinguish missing telemetry from true zero usage', () => {
  assert.match(CAVEMAN_COLLECTOR_JS, /telemetry_missing: installed && active && !historyRaw && !statusRaw/);
  assert.match(CAVEMAN_COLLECTOR_JS, /history_present: !!historyRaw/);
  assert.match(CAVEMAN_COLLECTOR_JS, /status_present: !!statusRaw/);
  assert.match(CORE_CARDS_JS, /Caveman is installed, but no telemetry ledger is being written/);
  assert.match(COMMON_CARDS_JS, /telemetry missing/);
});
