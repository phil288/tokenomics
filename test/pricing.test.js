// Pricing matrix + derivePricingRates (src/web/pricing.js). The module is
// browser ESM and the package is commonjs, so it is loaded by stripping
// `export` and evaluating it — that only works because pricing.js is
// import-free. Isolated data dir so requiring src/settings.js cannot touch
// the real settings.json.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
process.env.TOKENOMICS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-px-'));

const PRICING_JS = fs.readFileSync(path.join(ROOT, 'src/web/pricing.js'), 'utf8');
// eslint-disable-next-line no-new-func
const pricing = new Function(`${PRICING_JS.replace(/^export /gm, '')}\nreturn { derivePricingRates, PRICING, priceFor, pricingProvider, groupPricingRows, matchPricingRow, analyzePricingRows };`)();
const { derivePricingRates, PRICING, priceFor, pricingProvider, groupPricingRows, matchPricingRow, analyzePricingRows } = pricing;
const { DEFAULT_PRICING } = require('../src/settings');

test('Claude and Cursor output is 5× input; cache is 0.1 / 1.25 / 2×', () => {
  assert.deepEqual(derivePricingRates('claude-opus-4', 5), {
    in: 5, out: 25, cr: 0.5, cw5: 6.25, cw1: 10,
  });
  assert.deepEqual(derivePricingRates('cursor-small', 0.1), {
    in: 0.1, out: 0.5, cr: 0.01, cw5: 0.125, cw1: 0.2,
  });
});

test('Gemini and Antigravity output is 6× input', () => {
  assert.deepEqual(derivePricingRates('gemini-3.5-flash', 1.5), {
    in: 1.5, out: 9, cr: 0.15, cw5: 1.875, cw1: 3,
  });
  assert.deepEqual(derivePricingRates('antigravity-3.1-pro', 2), {
    in: 2, out: 12, cr: 0.2, cw5: 2.5, cw1: 4,
  });
});

test('unknown prefix uses the Claude 5× output family', () => {
  assert.equal(derivePricingRates('unknown-model', 4).out, 20);
  assert.equal(derivePricingRates('', 4).out, 20);
});

test('non-numeric input is treated as zero', () => {
  assert.deepEqual(derivePricingRates('claude-haiku-4', ''), {
    in: 0, out: 0, cr: 0, cw5: 0, cw1: 0,
  });
  assert.deepEqual(derivePricingRates('claude-haiku-4', 'nope'), {
    in: 0, out: 0, cr: 0, cw5: 0, cw1: 0,
  });
});

test('float rounding does not leak binary residues', () => {
  // 3 * 0.1 is 0.30000000000000004 in IEEE; the helper must return 0.3.
  assert.equal(derivePricingRates('claude-sonnet-4', 3).cr, 0.3);
});

// Cursor's own xAI (Grok/Composer) models and Gemini 3.7/3.8 Flash's
// introductory rate are billed at their real published rates, which don't
// follow the generic 5×/6× output + 0.1/1.25/2× cache formula (e.g. Grok
// 4.6 is in:2/out:6 — 3×, cache-read 0.25× input, not 0.1×; Gemini 3.7/3.8
// Flash intro pricing is out:5× input, not Gemini's usual 6×). These are
// legitimate hand-entered overrides, not drift — see AGENTS.md §3 "Keep
// Cost & Model Lists in Sync".
//
// Also exempt (published rates, platform.claude.com pricing / cursor.com
// models-and-pricing / ai.google.dev pricing, checked 2026-09-29):
// - Claude Fable 5.1 / Mythos 5.1 cache reads are 0.025× input ($0.25), and
//   Opus 5.5 cache reads are 0.05× input ($0.20) — not the 0.1× default.
// - GPT-5.5 / 5.6 Terra / 5.6 Luna output is 6× input (5.5: $5/$30), not the
//   5× Cursor-family default. Gemini 3.5 Flash-Lite output is 8.33× ($0.30/$2.50);
//   Gemini 3.6 Flash is on the same intro rate as 3.7/3.8.
const FORMULA_EXEMPT_PREFIXES = new Set([
  'claude-fable-5-1',
  'claude-mythos-5-1',
  'claude-opus-5-5',
  'cursor-fable-5.1',
  'cursor-opus-5.5',
  'cursor-gpt-5.6-terra',
  'cursor-gpt-5.6-luna',
  'cursor-gpt-5.5',
  'cursor-grok-4.7-500k-fast',
  'cursor-grok-4.7-500k',
  'cursor-grok-4.7-fast',
  'cursor-grok-4.7',
  'antigravity-3.6-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'cursor-grok-4.6-fast',
  'cursor-grok-4.6',
  'cursor-grok-4.5-fast',
  'cursor-grok-4.5',
  'cursor-composer-2.5-fast',
  'cursor-composer-2.5',
  'antigravity-3.8-flash',
  'gemini-3.8-flash',
  'antigravity-3.7-flash',
  'gemini-3.7-flash',
]);

function assertMatchesDerived(rows, label) {
  assert.ok(Array.isArray(rows) && rows.length > 0, `${label} must be a non-empty array`);
  for (const [prefix, cost] of rows) {
    if (FORMULA_EXEMPT_PREFIXES.has(prefix)) continue;
    const derived = derivePricingRates(prefix, cost.in);
    assert.deepEqual(
      { in: cost.in, out: cost.out, cr: cost.cr, cw5: cost.cw5, cw1: cost.cw1 },
      derived,
      `${label} row ${prefix} must match derivePricingRates`,
    );
  }
}

test('client PRICING defaults match derivePricingRates', () => {
  assertMatchesDerived(PRICING, 'PRICING');
});

test('server DEFAULT_PRICING matches derivePricingRates and the client table', () => {
  assertMatchesDerived(DEFAULT_PRICING, 'DEFAULT_PRICING');
  assert.equal(DEFAULT_PRICING.length, PRICING.length);
  for (let i = 0; i < PRICING.length; i++) {
    assert.equal(DEFAULT_PRICING[i][0], PRICING[i][0], `prefix mismatch at row ${i}`);
  }
});

test('server and client tables carry identical costs, not just prefixes', () => {
  assert.deepEqual(DEFAULT_PRICING, PRICING);
});

test('no row is shadowed by an earlier, shorter prefix', () => {
  // priceFor() returns the first startsWith hit, so a longer prefix listed
  // after its shorter base (claude-opus-5 before claude-opus-5-5) is dead.
  PRICING.forEach(([prefix], i) => {
    for (const [earlier] of PRICING.slice(0, i)) {
      assert.ok(!prefix.startsWith(earlier), `${prefix} is shadowed by ${earlier}`);
    }
  });
});

test('real model ids resolve to their published rates', () => {
  const cases = [
    ['claude-opus-5-5', { in: 4, out: 20, cr: 0.2 }],
    ['claude-opus-5', { in: 5, out: 25, cr: 0.5 }],
    ['claude-opus-4-8', { in: 5, out: 25, cr: 0.5 }],
    ['claude-sonnet-5-5', { in: 2, out: 10, cr: 0.2 }],
    ['claude-sonnet-4-6', { in: 3, out: 15, cr: 0.3 }],
    ['claude-fable-5-1', { in: 10, out: 50, cr: 0.25 }],
    ['claude-fable-5', { in: 10, out: 50, cr: 1 }],
    ['claude-haiku-4-5', { in: 1, out: 5, cr: 0.1 }],
    ['gemini-3.5-flash-lite', { in: 0.3, out: 2.5, cr: 0.03 }],
    ['gemini-3.5-flash', { in: 1.5, out: 9, cr: 0.15 }],
    ['cursor-grok-4.7-500k-fast', { in: 6, out: 18, cr: 1.5 }],
    ['cursor-grok-4.7', { in: 2, out: 6, cr: 0.5 }],
  ];
  for (const [name, want] of cases) {
    const p = priceFor(name);
    assert.ok(p, `${name} has a price`);
    assert.deepEqual({ in: p.in, out: p.out, cr: p.cr }, want, name);
  }
});

// ---- Pricing-tab editor helpers ----

test('pricingProvider buckets prefixes by vendor', () => {
  assert.equal(pricingProvider('claude-opus-5-5'), 'anthropic');
  assert.equal(pricingProvider('gemini-3.8-flash'), 'google');
  assert.equal(pricingProvider('antigravity-3.1-pro'), 'google');
  assert.equal(pricingProvider('cursor-grok-4.7'), 'cursor');
  assert.equal(pricingProvider('my-local-model'), 'other');
  assert.equal(pricingProvider(''), 'other');
});

test('grouping the editor never changes which row bills a model', () => {
  // The editor renders (and saves) rows grouped by provider. That is only
  // safe if the grouped order resolves every model id to the same row.
  const mixed = [
    ['cursor-opus', { in: 5 }], ['my-model', { in: 1 }], ['claude-opus-5-5', { in: 4 }],
    ['gemini-3.5-flash-lite', { in: 0.3 }], ['claude-opus-5', { in: 5 }], ['gemini-3.5-flash', { in: 1.5 }],
  ];
  const regrouped = groupPricingRows(mixed).flatMap((g) => g.rows);
  assert.deepEqual(groupPricingRows(mixed).map((g) => g.key), ['anthropic', 'google', 'cursor', 'other']);
  for (const table of [mixed, PRICING]) {
    const grouped = groupPricingRows(table).flatMap((g) => g.rows);
    assert.equal(grouped.length, table.length);
    for (const [prefix] of table) {
      for (const id of [prefix, `${prefix}-20260101`]) {
        const a = matchPricingRow(table, id);
        const b = matchPricingRow(grouped, id);
        assert.equal(grouped[b][0], table[a][0], `${id} must bill by the same row after grouping`);
      }
    }
  }
  assert.equal(regrouped[0][0], 'claude-opus-5-5', 'relative order inside a group is preserved');
});

test('matchPricingRow uses the first-prefix rule and -1 for no match', () => {
  assert.equal(PRICING[matchPricingRow(PRICING, 'claude-opus-5-5')][0], 'claude-opus-5-5');
  assert.equal(PRICING[matchPricingRow(PRICING, 'cursor-grok-4.7-fast-x')][0], 'cursor-grok-4.7-fast');
  assert.equal(matchPricingRow(PRICING, 'gpt-4o'), -1);
  assert.equal(matchPricingRow(PRICING, '   '), -1);
});

test('analyzePricingRows flags duplicates, shadowed rows and custom cells', () => {
  const rows = [
    ['claude-opus-5', { in: 5, out: 25, cr: 0.5, cw5: 6.25, cw1: 10 }],
    ['claude-opus-5-5', { in: 4, out: 20, cr: 0.2, cw5: 5, cw1: 8 }],
    ['claude-opus-5', { in: 5, out: 25, cr: 0.5, cw5: 6.25, cw1: 10 }],
    ['', { in: 0, out: 0, cr: 0, cw5: 0, cw1: 0 }],
  ];
  const [a, b, c, d] = analyzePricingRows(rows);
  assert.deepEqual(a, { empty: false, duplicateOf: -1, shadowedBy: -1, custom: {} });
  assert.equal(b.shadowedBy, 0, 'opus-5-5 listed after opus-5 is dead');
  assert.deepEqual(b.custom, { cr: 0.4 }, 'opus-5-5 cache read differs from the 0.1× formula');
  assert.equal(c.duplicateOf, 0);
  assert.equal(d.empty, true);
  // The shipped table has no dead rows.
  for (const [i, r] of analyzePricingRows(PRICING).entries()) {
    assert.equal(r.duplicateOf, -1, `${PRICING[i][0]} duplicate`);
    assert.equal(r.shadowedBy, -1, `${PRICING[i][0]} shadowed`);
  }
});
