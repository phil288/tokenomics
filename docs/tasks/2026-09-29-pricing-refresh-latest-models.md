# Pricing refresh — latest models (Sep 2026)

**Date:** 2026-09-29
**Status:** done

## Context
The Pricing tab (`DEFAULT_PRICING` in `src/settings.js`, `PRICING` in
`src/web/pricing.js`) was last refreshed 2026-09-17. Since then Claude Opus 5.5
shipped at a *lower* price than Opus 5, and the table had silent misbilling:

- `claude-opus-5-5` matched the `claude-opus-5` row → billed $5/$25 instead of $4/$20.
- `claude-fable-5-1` cache reads at $1.00; real price is $0.25 (0.025×).
- No row for Opus 4.x, Sonnet 4.x, Fable 5, Mythos → those models priced as `null` (zero cost).
- Cursor Grok 4.7 / GPT-5.6 / Gemini 3.6 Flash and Flash-Lite missing.

## Decisions
- Sources: Anthropic pricing docs, Google Gemini API pricing, Cursor models &
  pricing page (all fetched 2026-09-29).
- Added rows (44 total, was 22): Claude Fable 5, Mythos 5 / 5.1, Opus 5.5,
  Opus 4 (covers 4.5–4.8), Sonnet 4 (covers 4.5/4.6); Gemini/Antigravity 3.6
  Flash, Gemini 3.5 / 3.1 Flash-Lite; Cursor Fable, Fable 5.1, Opus 5.5,
  Sonnet 4, GPT-5.6 Sol/Terra/Luna, GPT-5.5, Grok 4.7 (+ fast, 500k, 500k-fast).
- Longer prefixes are listed before their base (`claude-opus-5-5` before
  `claude-opus-5`), enforced by a new no-shadow test.
- Kept Google's $3.75 output for Gemini 3.7/3.8 Flash (Cursor's page says $3.50;
  Google is the vendor of record).
- Rejected: retired models (Opus 4 / 4.1 at $15/$75, Haiku 3.5) — retired on
  the first-party API; `claude-opus-4` row prices all 4.x at $5/$25.
- Rejected: older GPT (5.0–5.4), Kimi, GLM, Muse — not "latest", no evidence
  the dashboard sees them. Add when they show up in usage.
- Gemini/Grok have no cache-write price; kept the existing 1.25×/2× convention.

## What changed
- `src/settings.js`, `src/web/pricing.js` — tables replaced (identical).
- `test/pricing.test.js` — exemptions for off-formula rows; new tests:
  full server/client deep-equal, no prefix shadowing, real ids → published rates.
- `AGENTS.md` §3 — cache-read multipliers, sources, new test contracts.
- `data/settings.json` (gitignored, local) — its saved `PRICING` was exactly the
  old 22-row default, which would hide the new rows; replaced with the new table.

## Evidence
`rtk node --test` → 310/310 pass (incl. 3 new pricing tests); `test/pricing.test.js` 10/10.

## Left undone
- Gemini 3.6–3.8 Flash intro pricing ends 2026-12-31 → $1.50 / $7.50 / $0.15.
  Update those six rows (and drop them from `FORMULA_EXEMPT_PREFIXES`) in Jan 2027.
- GPT-5.6 Sol is promotional through 2026-11-21; re-check then.
- Fast-mode, US inference-geo 1.1×, Cursor Token Rate not modeled.

## How to verify
```bash
rtk node --test test/pricing.test.js
```
Open Settings → Pricing: `claude-opus-5-5` row shows 4 / 20 / 0.2 / 5 / 8.
