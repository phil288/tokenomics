// ---- pricing matrix & per-model cost/weight math ----
// NOTE: keep this PRICING table in sync with DEFAULT_PRICING in src/settings.js.

export const MODE_COLORS = {
  full: '#d4a72c', ultra: '#f97316', lite: '#fbbf24',
  'wenyan-lite': '#a78bfa', 'wenyan-full': '#8b5cf6',
  'wenyan-ultra': '#7c3aed', wenyan: '#8b5cf6',
  off: '#6b7280', commit: '#58a6ff', review: '#3fb950', compress: '#38bdf8',
};

// Family billing ratios from that model's input price ($/MTok).
// Claude/Cursor output 5×; Gemini/Antigravity output 6×.
// Cache is universal: read 0.1×, write-5m 1.25×, write-1h 2×.
export function derivePricingRates(prefix, input) {
  const n = Number(input);
  const inVal = Number.isFinite(n) ? n : 0;
  const p = String(prefix || '').toLowerCase();
  const outMul = (p.startsWith('gemini') || p.startsWith('antigravity')) ? 6 : 5;
  const round = (x) => parseFloat(x.toFixed(6));
  return {
    in: round(inVal),
    out: round(inVal * outMul),
    cr: round(inVal * 0.1),
    cw5: round(inVal * 1.25),
    cw1: round(inVal * 2),
  };
}

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
  // Anthropic — platform.claude.com/docs/en/about-claude/pricing (2026-09-29).
  // Longer prefixes first: claude-opus-5-5 must shadow claude-opus-5, etc.
  ['claude-fable-5-1',      { in: 10, out: 50, cr: 0.25, cw5: 12.5, cw1: 20 }],
  ['claude-fable-5',        { in: 10, out: 50, cr: 1,    cw5: 12.5, cw1: 20 }],
  ['claude-mythos-5-1',     { in: 10, out: 50, cr: 0.25, cw5: 12.5, cw1: 20 }],
  ['claude-mythos-5',       { in: 10, out: 50, cr: 1,    cw5: 12.5, cw1: 20 }],
  ['claude-opus-5-5',       { in: 4,  out: 20, cr: 0.2,  cw5: 5,    cw1: 8  }],
  ['claude-opus-5',         { in: 5,  out: 25, cr: 0.5,  cw5: 6.25, cw1: 10 }],
  ['claude-opus-4',         { in: 5,  out: 25, cr: 0.5,  cw5: 6.25, cw1: 10 }],
  ['claude-sonnet-5',       { in: 2,  out: 10, cr: 0.2,  cw5: 2.5,  cw1: 4  }],
  ['claude-sonnet-4',       { in: 3,  out: 15, cr: 0.3,  cw5: 3.75, cw1: 6  }],
  ['claude-haiku-4-5',      { in: 1,  out: 5,  cr: 0.1,  cw5: 1.25, cw1: 2  }],
  // Google — ai.google.dev/gemini-api/docs/pricing. 3.6–3.8 Flash are on
  // introductory pricing through 2026-12-31 ($1.50/$7.50 after).
  ['antigravity-3.8-flash', { in: 0.75, out: 3.75, cr: 0.075, cw5: 0.9375, cw1: 1.5 }],
  ['gemini-3.8-flash',      { in: 0.75, out: 3.75, cr: 0.075, cw5: 0.9375, cw1: 1.5 }],
  ['antigravity-3.7-flash', { in: 0.75, out: 3.75, cr: 0.075, cw5: 0.9375, cw1: 1.5 }],
  ['gemini-3.7-flash',      { in: 0.75, out: 3.75, cr: 0.075, cw5: 0.9375, cw1: 1.5 }],
  ['antigravity-3.6-flash', { in: 0.75, out: 3.75, cr: 0.075, cw5: 0.9375, cw1: 1.5 }],
  ['gemini-3.6-flash',      { in: 0.75, out: 3.75, cr: 0.075, cw5: 0.9375, cw1: 1.5 }],
  ['gemini-3.5-flash-lite', { in: 0.3,  out: 2.5,  cr: 0.03,  cw5: 0.375,  cw1: 0.6 }],
  ['antigravity-3.5-flash', { in: 1.5,  out: 9,    cr: 0.15,  cw5: 1.875,  cw1: 3   }],
  ['gemini-3.5-flash',      { in: 1.5,  out: 9,    cr: 0.15,  cw5: 1.875,  cw1: 3   }],
  ['gemini-3.1-flash-lite', { in: 0.25, out: 1.5,  cr: 0.025, cw5: 0.3125, cw1: 0.5 }],
  ['antigravity-3.1-pro',   { in: 2,    out: 12,   cr: 0.2,   cw5: 2.5,    cw1: 4   }],
  ['gemini-3.1-pro',        { in: 2,    out: 12,   cr: 0.2,   cw5: 2.5,    cw1: 4   }],
  // Cursor — cursor.com/docs/models-and-pricing. Third-party rows mirror the
  // vendor rate; first-party Grok/Composer rows are hand-entered.
  ['cursor-fable-5.1',      { in: 10,  out: 50,  cr: 0.25, cw5: 12.5, cw1: 20 }],
  ['cursor-fable',          { in: 10,  out: 50,  cr: 1,    cw5: 12.5, cw1: 20 }],
  ['cursor-opus-5.5',       { in: 4,   out: 20,  cr: 0.2,  cw5: 5,    cw1: 8  }],
  ['cursor-opus',           { in: 5,   out: 25,  cr: 0.5,  cw5: 6.25, cw1: 10 }],
  ['cursor-sonnet-4',       { in: 3,   out: 15,  cr: 0.3,  cw5: 3.75, cw1: 6  }],
  ['cursor-sonnet',         { in: 2,   out: 10,  cr: 0.2,  cw5: 2.5,  cw1: 4  }],
  ['cursor-haiku',          { in: 1,   out: 5,   cr: 0.1,  cw5: 1.25, cw1: 2  }],
  ['cursor-small',          { in: 0.1, out: 0.5, cr: 0.01, cw5: 0.125, cw1: 0.2 }],
  ['cursor-gpt-5.6-sol',    { in: 4,   out: 20,  cr: 0.4,  cw5: 5,    cw1: 8  }],
  ['cursor-gpt-5.6-terra',  { in: 2,   out: 12,  cr: 0.2,  cw5: 2.5,  cw1: 4  }],
  ['cursor-gpt-5.6-luna',   { in: 0.2, out: 1.2, cr: 0.02, cw5: 0.25, cw1: 0.4 }],
  ['cursor-gpt-5.5',        { in: 5,   out: 30,  cr: 0.5,  cw5: 6.25, cw1: 10 }],
  ['cursor-grok-4.7-500k-fast', { in: 6, out: 18, cr: 1.5, cw5: 7.5, cw1: 12 }],
  ['cursor-grok-4.7-500k',  { in: 4,   out: 12,  cr: 1,    cw5: 5,    cw1: 8  }],
  ['cursor-grok-4.7-fast',  { in: 4,   out: 12,  cr: 1,    cw5: 5,    cw1: 8  }],
  ['cursor-grok-4.7',       { in: 2,   out: 6,   cr: 0.5,  cw5: 2.5,  cw1: 4  }],
  ['cursor-grok-4.6-fast',  { in: 4,   out: 12,  cr: 1,    cw5: 5,    cw1: 8  }],
  ['cursor-grok-4.6',       { in: 2,   out: 6,   cr: 0.5,  cw5: 2.5,  cw1: 4  }],
  ['cursor-grok-4.5-fast',  { in: 4,   out: 18,  cr: 1,    cw5: 5,    cw1: 8  }],
  ['cursor-grok-4.5',       { in: 2,   out: 6,   cr: 0.5,  cw5: 2.5,  cw1: 4  }],
  ['cursor-composer-2.5-fast', { in: 3, out: 15, cr: 0.5,  cw5: 3.75, cw1: 6  }],
  ['cursor-composer-2.5',   { in: 0.5, out: 2.5, cr: 0.2,  cw5: 0.625, cw1: 1 }],
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

// ---- pricing-table editor analysis (pure; used by the settings Pricing tab) ----

// Provider section a prefix is listed under. Leading tokens never prefix one
// another across providers, so grouping the editor by provider cannot change
// which row priceFor() picks — relative order inside a group is preserved.
export const PRICING_PROVIDERS = [
  { key: 'anthropic', label: 'Anthropic' },
  { key: 'google', label: 'Google' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'other', label: 'Custom' },
];
export function pricingProvider(prefix) {
  const p = String(prefix || '').trim().toLowerCase();
  if (p.startsWith('claude')) return 'anthropic';
  if (p.startsWith('gemini') || p.startsWith('antigravity')) return 'google';
  if (p.startsWith('cursor')) return 'cursor';
  return 'other';
}

// Stable partition of [prefix, cost] rows into provider order.
export function groupPricingRows(rows) {
  const order = PRICING_PROVIDERS.map((g) => g.key);
  return order
    .map((key) => ({ key, rows: rows.filter(([prefix]) => pricingProvider(prefix) === key) }))
    .filter((g) => g.rows.length > 0);
}

// First row whose prefix the model name starts with — the same rule as
// priceFor(), but over an arbitrary (unsaved) table. -1 when nothing matches.
export function matchPricingRow(rows, name) {
  const n = String(name || '').trim();
  if (!n) return -1;
  return rows.findIndex(([prefix]) => prefix && n.startsWith(prefix));
}

// Per-row diagnostics for the editor:
//   duplicateOf — index of an earlier row with the same prefix (this row is dead)
//   shadowedBy  — index of an earlier, shorter prefix this one starts with (dead)
//   custom      — { field: formulaValue } for cells that differ from derivePricingRates
export function analyzePricingRows(rows) {
  const FIELDS = ['out', 'cr', 'cw5', 'cw1'];
  return rows.map(([prefix, cost], i) => {
    const p = String(prefix || '').trim();
    let duplicateOf = -1;
    let shadowedBy = -1;
    if (p) {
      for (let j = 0; j < i; j++) {
        const q = String(rows[j][0] || '').trim();
        if (!q) continue;
        if (q === p) { duplicateOf = j; break; }
        if (shadowedBy < 0 && p.startsWith(q)) shadowedBy = j;
      }
    }
    const derived = derivePricingRates(p, cost && cost.in);
    const custom = {};
    for (const f of FIELDS) {
      const v = Number(cost && cost[f]);
      if (!Number.isFinite(v) || Math.abs(v - derived[f]) > 1e-9) custom[f] = derived[f];
    }
    return { empty: !p, duplicateOf, shadowedBy, custom };
  });
}
