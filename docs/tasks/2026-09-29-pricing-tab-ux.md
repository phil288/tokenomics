# Pricing tab — friendlier editor

**Date:** 2026-09-29
**Status:** done

## Context
After the pricing refresh the Settings → Pricing tab held 44 rows in one flat
list inside a 650 px modal. Problems seen in the screenshot and code:
- Model prefix column truncated (`claude-sonnet-5…`); six fixed 70 px numeric
  columns took the width.
- Terse headers (`Cache Rd`, `Cw 5m`), a dense paragraph of formula text.
- No way to find a row or to answer "what does model X cost / which row bills it".
- Nothing showed which cells are hand-entered vendor prices, and **Refresh rates**
  silently overwrote them (e.g. Opus 5.5 cache read 0.2 → 0.4).
- Dead rows (a longer prefix listed after its shorter base) were invisible.

## Decisions
- **Group by provider** with section headers + counts. Rejected reordering by
  anything else: `priceFor()` is order-dependent. A stable partition by
  provider is safe because `claude`/`gemini`/`antigravity`/`cursor` never
  prefix one another; a test proves every id resolves to the same row.
- **One search box, two jobs**: filter rows, and — once the query contains a
  dash — show which row bills that model id (or warn it matches nothing → $0).
- **Mark custom cells** (differ from `derivePricingRates`) with an amber tint
  and a tooltip giving the formula value; per-row ↺ resets one row.
- **Confirm before Refresh rates** when custom cells exist. Rejected making
  Refresh skip custom cells: users sometimes want the snap-back.
- **Flag dead rows** (duplicate / shadowed) with `!` + explanation tooltip.
- Widen the modal (880 px) only while the Pricing tab is active; other tabs
  keep the narrow form layout.
- Two-level header ("Prompt cache" → Read / Write 5m / Write 1h), sticky thead,
  table scrolls inside its own container (max 56 vh). Spin buttons removed,
  tabular numerals, monospace prefixes, delete buttons muted until hover.
- Rejected sticky provider headers: needed a measured thead height; not worth it.
- Pure logic lives in import-free `pricing.js` so the CJS test loader can run it.

## What changed
- `index.html` — Pricing panel markup (intro, `<details>` help, toolbar with
  `#pricing-filter`, `#pricing-match`, colgroup + two-row thead, empty state, legend).
- `src/web/pricing.js` — `PRICING_PROVIDERS`, `pricingProvider`,
  `groupPricingRows`, `matchPricingRow`, `analyzePricingRows`.
- `src/web/settings.js` — `renderPricingTable`, `readPricingRows`,
  `refreshPricingState`, `refreshPricingFilter`, `addBlankPricingRow`,
  `confirmRefreshPricingRates`; save selects `tr.px-row`; `.modal-wide` toggle.
- `index.css` — Pricing tab block rewritten; unused `.table-actions` removed.
- Tests: `test/pricing.test.js` (+4 helper tests), `test/settings-tabs.test.js`
  (+3 contract tests; import regex loosened for the multi-line import).
- `AGENTS.md` §3 — editor contract and CSS gotchas.

## Evidence
- `rtk node --test` → 317/317 pass.
- Checked in the browser pane, light and dark: grouping, lookup
  (`cursor-grok-4.7-fast-2026` → billed by `cursor-grok-4.7-fast`), duplicate
  and shadowed flags, help panel, sticky header while scrolling.

## Corrections
- First cut made each header row sticky with a hardcoded 29 px offset; the
  real first-row height differed, so rows showed through a gap. Fixed by making
  `thead` sticky as a unit.
- `[hidden]` did not hide the `!` flags because `.px-flag` sets `display`;
  added a scoped `display:none !important` rule.

## Left undone
- Flag models seen in live usage that match no row (would need the SSE model list).
- Drag-to-reorder rows; today a shadowed row must be deleted and re-added.
- On phone widths the table scrolls horizontally inside its container.

## How to verify
```bash
rtk node --test test/pricing.test.js test/settings-tabs.test.js
```
Open Settings → Pricing; type `claude-opus-5-5-20260101` in the search box.
