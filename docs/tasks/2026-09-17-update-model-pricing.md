# Update model pricing table

**Date:** 2026-09-17
**Status:** done

## Context
`DEFAULT_PRICING` (`src/settings.js`) and the client `PRICING` table
(`src/web/pricing.js`) still carried Claude 4-generation prefixes
(`claude-opus-4`, `claude-sonnet-4`, `claude-haiku-4`, `claude-fable-5`)
and Sonnet's stale intro rate ($3/$15). Anthropic's Sonnet 5 intro pricing
ended 2026-08-31 and moved to $2/$10; the deployed Claude generation is now
Opus 5 / Sonnet 5 / Haiku 4.5 / Fable 5.1, so the old `-4` prefixes no
longer `startsWith`-match any model id the tools actually report — those
rows had gone silently dead (cost falls back to $0/unpriced for any
`claude-opus-5-*` etc. model string).

## Decisions
- **Renamed stale prefixes to the live model generation** rather than
  deleting the Claude rows outright: Claude is very much still in use,
  it's the *prefix* that had rotted, not the model family.
  - `claude-opus-4` → `claude-opus-5` (price unchanged, $5/$25)
  - `claude-sonnet-4` → `claude-sonnet-5` (price $3/$15 → **$2/$10**)
  - `claude-haiku-4` → `claude-haiku-4-5` (price unchanged, $1/$5)
  - `claude-fable-5` → `claude-fable-5-1` (price unchanged, $10/$50; old
    prefix technically still matched via `startsWith` but renamed for
    precision/consistency with the others)
- `cursor-opus` / `cursor-sonnet` / `cursor-haiku` mirror the underlying
  Anthropic model cost Cursor bills at BYOK/on-demand, so `cursor-sonnet`
  moved with it ($3/$15 → $2/$10); `cursor-opus`/`cursor-haiku` unchanged.
  `cursor-small` left as-is — no evidence it's unused or repriced.
- **Gemini/Antigravity rows left unchanged.** Fetched `ai.google.dev`
  pricing directly: `gemini-3.5-flash` is $1.50/$9.00 and `gemini-3.1-pro`
  is $2.00/$12.00 — both already matched the table exactly. Considered
  adding rows for `gemini-3.8/3.7-flash` ($0.75/$3.75) but there's no
  evidence Tokenomics' collectors ever report those model ids, so no row
  was added for a model nothing emits.
- All values still hand-satisfy the derived-rate formula in
  `derivePricingRates` (cache read 0.1×, cache write-5m 1.25×, write-1h 2×,
  output 5× for Claude/Cursor) — verified by the existing
  `test/pricing.test.js` formula assertion rather than eyeballing.

## What changed
- [src/settings.js](../../src/settings.js) — `DEFAULT_PRICING` rows renamed/repriced.
- [src/web/pricing.js](../../src/web/pricing.js) — `PRICING` rows kept in sync (per the file's own sync-comment contract).
- [test/history.test.js](../../test/history.test.js) — fixture model id `claude-opus-4-20250101` → `claude-opus-5-20250101` (was asserting on a prefix that no longer matches after the rename).
- [test/chart-fallback.test.js](../../test/chart-fallback.test.js) — same fixture fix, `claude-opus-4` → `claude-opus-5`.

## Evidence
- Prices confirmed live: [claude.com/pricing](https://claude.com/pricing) (Opus 5 $5/$25, Sonnet 5 $2/$10, Haiku 4.5 $1/$5, Fable 5.1 $10/$50), [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) (Gemini 3.5 Flash $1.50/$9.00, Gemini 3.1 Pro $2.00/$12.00).
- `rtk node --test` → 295/295 pass after the fixture updates.

## Corrections
- Sonnet's table entry looked "current" at a glance (matched the still-listed 4-gen naming) but was actually the expired intro rate — the prefix rename surfaced it since the two problems (stale prefix, stale price) were bundled in the same row.

## Left undone
- Did not touch `cursor-small`'s pricing — no pricing source was checked for it since there was no signal it changed or is unused.

## Follow-up (same day): new Gemini models + Cursor models added
User flagged the modal screenshot still showed old rows/prices, and asked
for the new Gemini models plus the Cursor models to be added.

**Root cause of the "prices didn't change" report:** `data/settings.json`
(gitignored local runtime state) had its own persisted `PRICING` array from
before this session, which `loadSettings()` merges *over*
`DEFAULT_PRICING` — editing `src/settings.js` alone never reaches a
running instance that has ever saved settings. Fixed by editing
`data/settings.json`'s `PRICING` to match, both for the initial rename/
reprice and again for this addition. Documented as a durable gotcha in
AGENTS.md §3 so it isn't re-discovered by surprise next time.

**Added, confirmed against `ai.google.dev/gemini-api/docs/pricing`:**
- `gemini-3.8-flash` / `antigravity-3.8-flash` — $0.75/$3.75 (introductory,
  through 2026-12-31; standard $1.50/$7.50 takes effect 2027-01-01).
- `gemini-3.7-flash` / `antigravity-3.7-flash` — same $0.75/$3.75 intro rate.
- Kept `gemini-3.5-flash` / `antigravity-3.5-flash` and `-3.1-pro` rows —
  still current, no signal either is retired.

**Added, confirmed against `cursor.com/docs/models-and-pricing`:**
- `cursor-grok-4.6` ($2/$6), `cursor-grok-4.6-fast` ($4/$12)
- `cursor-grok-4.5` ($2/$6), `cursor-grok-4.5-fast` ($4/$18)
- `cursor-composer-2.5` ($0.5/$2.5), `cursor-composer-2.5-fast` ($3/$15)
- Cache-read values taken from the same doc (not derived): grok $0.5/$1,
  composer $0.2/$0.5. Cache-write (5m/1h) columns aren't published by
  Cursor for these, so `cw5`/`cw1` are the project's usual 1.25×/2× of
  input as a placeholder — flagged in AGENTS.md, not asserted as fact.
- **Prefix ordering matters**: `-fast` variant rows are listed *before*
  their base prefix in both tables (`cursor-grok-4.6-fast` before
  `cursor-grok-4.6`), since `priceFor()` matches by `startsWith` and
  returns the first hit — the base row would otherwise shadow the fast one.

**Test formula exemption.** `test/pricing.test.js` asserts every default
row matches `derivePricingRates`'s generic 5×/6× output + 0.1/1.25/2× cache
formula. The new Grok/Composer rows (real vendor prices, e.g. Grok 4.6 is
3× output not 5×, cache-read 0.25× input not 0.1×) and the Gemini 3.7/3.8
Flash intro rate (5× output, not Gemini's usual 6×) genuinely don't fit
that formula — they're correct real numbers, not drift. Added a
`FORMULA_EXEMPT_PREFIXES` allowlist in the test rather than distorting the
prices to pass, or weakening the formula check for every row.

### What changed (follow-up)
- [src/settings.js](../../src/settings.js), [src/web/pricing.js](../../src/web/pricing.js) — 10 new rows added (4 Gemini/Antigravity, 6 Cursor).
- [data/settings.json](../../data/settings.json) — same rows added to the persisted override (gitignored, local-only).
- [test/pricing.test.js](../../test/pricing.test.js) — `FORMULA_EXEMPT_PREFIXES` allowlist.
- [AGENTS.md](../../AGENTS.md) §3 — three new bullets: prefix-ordering-for-collisions, formula-exemption rationale, `data/settings.json` shadowing gotcha.

### Evidence (follow-up)
- [cursor.com/docs/models-and-pricing](https://cursor.com/docs/models-and-pricing), [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing).
- `rtk node --test` → 295/295 pass.

### How to verify (follow-up)
```bash
rtk node --test
rtk grep -n "cursor-grok\|cursor-composer\|gemini-3.8\|gemini-3.7" src/settings.js src/web/pricing.js data/settings.json
```

## How to verify
```bash
rtk node --test
rtk grep -n "claude-opus-5\|claude-sonnet-5\|claude-haiku-4-5\|claude-fable-5-1" src/settings.js src/web/pricing.js
```
