// ---- pricing matrix & per-model cost/weight math ----
// NOTE: keep this PRICING table in sync with the PRICING array in server.js.

export const MODE_COLORS = {
  full: '#d4a72c', ultra: '#f97316', lite: '#fbbf24',
  'wenyan-lite': '#a78bfa', 'wenyan-full': '#8b5cf6',
  'wenyan-ultra': '#7c3aed', wenyan: '#8b5cf6',
  off: '#6b7280', commit: '#58a6ff', review: '#3fb950', compress: '#38bdf8',
};

// cache reads are billed ~10% of input price → ~90% saved vs uncached
export function cacheSavings(wt) {
  return Math.round((wt.cache_reads || 0) * 0.9);
}

// Universal Claude billing ratios (in units of that model's input token):
// output 5×, cache-read 0.1×, cache-write-5m 1.25×, cache-write-1h 2×.
export function modelRaw(m) {
  return (m.input || 0) + (m.output || 0) + (m.cache_reads || 0) + (m.cache_writes_total || 0);
}
export function modelWeighted(m) {
  const writes5m = m.cache_writes_5m || 0;
  const writes1h = m.cache_writes_1h || 0;
  // fall back to total at 1.25× if the 5m/1h split is absent
  const writeW = (writes5m || writes1h) ? writes5m * 1.25 + writes1h * 2 : (m.cache_writes_total || 0) * 1.25;
  return Math.round((m.input || 0) * 1 + (m.output || 0) * 5 + (m.cache_reads || 0) * 0.1 + writeW);
}

// USD per million tokens by category. Matched to model name by prefix.
// cache rates: read 0.1×, write-5m 1.25×, write-1h 2× of input price.
// Mutated in place (length=0 + push) when settings update — keep the identity.
export const PRICING = [
  ['claude-opus-4', { in: 5, out: 25, cr: 0.50, cw5: 6.25, cw1: 10 }],
  ['claude-sonnet-4', { in: 3, out: 15, cr: 0.30, cw5: 3.75, cw1: 6 }],
  ['claude-haiku-4', { in: 1, out: 5, cr: 0.10, cw5: 1.25, cw1: 2 }],
  ['claude-fable-5', { in: 10, out: 50, cr: 1.00, cw5: 12.50, cw1: 20 }],
  ['antigravity-3.5-flash', { in: 1.5, out: 9, cr: 0.15, cw5: 1.875, cw1: 3.0 }],
  ['gemini-3.5-flash', { in: 1.5, out: 9, cr: 0.15, cw5: 1.875, cw1: 3.0 }],
  ['antigravity-3.1-pro', { in: 2, out: 12, cr: 0.20, cw5: 2.50, cw1: 4.0 }],
  ['gemini-3.1-pro', { in: 2, out: 12, cr: 0.20, cw5: 2.50, cw1: 4.0 }],
  ['cursor-opus', { in: 5, out: 25, cr: 0.50, cw5: 6.25, cw1: 10 }],
  ['cursor-sonnet', { in: 3, out: 15, cr: 0.30, cw5: 3.75, cw1: 6 }],
  ['cursor-haiku', { in: 1, out: 5, cr: 0.10, cw5: 1.25, cw1: 2 }],
  ['cursor-small', { in: 0.1, out: 0.5, cr: 0.01, cw5: 0.125, cw1: 0.2 }],
];
export function priceFor(name) {
  for (const [prefix, p] of PRICING) if (name.startsWith(prefix)) return p;
  return null;
}
// real (weighted) cost — cache reads/writes at discounted/premium rates
export function modelUsd(name, m) {
  const p = priceFor(name);
  if (!p) return null;
  const writes5m = m.cache_writes_5m || 0;
  const writes1h = m.cache_writes_1h || 0;
  const writeUsd = (writes5m || writes1h)
    ? writes5m * p.cw5 + writes1h * p.cw1
    : (m.cache_writes_total || 0) * p.cw5;
  return ((m.input || 0) * p.in + (m.output || 0) * p.out + (m.cache_reads || 0) * p.cr + writeUsd) / 1e6;
}
// raw cost — every cache token billed at full input price (no caching)
export function modelUsdRaw(name, m) {
  const p = priceFor(name);
  if (!p) return null;
  const cacheAll = (m.cache_reads || 0) + (m.cache_writes_total || 0);
  return ((m.input || 0) * p.in + (m.output || 0) * p.out + cacheAll * p.in) / 1e6;
}
