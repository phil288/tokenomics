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
const pricing = new Function(`${PRICING_JS.replace(/^export /gm, '')}\nreturn { derivePricingRates, PRICING };`)();
const { derivePricingRates, PRICING } = pricing;
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

function assertMatchesDerived(rows, label) {
  assert.ok(Array.isArray(rows) && rows.length > 0, `${label} must be a non-empty array`);
  for (const [prefix, cost] of rows) {
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
