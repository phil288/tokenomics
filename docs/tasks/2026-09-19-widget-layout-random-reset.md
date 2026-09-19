# Fix: free-drag widget layout randomly resetting

**Date:** 2026-09-19
**Status:** done

## Context
User reported the dashboard's free-drag card/widget layout resets to default
positions "randomly, from time to time" — no consistent repro steps, no
correlation to a specific user action like dragging or opening settings.

Dispatched an investigation subagent to read `src/web/layout.js`,
`src/web/settings.js`, `src/settings.js`, and the `/api/settings` route
before touching anything.

## Decisions

**Root cause: `placeUnmappedVisible()` (`src/web/layout.js`) auto-persists
a bad width measurement taken mid-reflow.**

`reapplyCardLayout()` runs on *every* 10 s SSE render tick (`main.js`'s
`render()`) and on every `viewchange`/provider-visibility toggle — not just
when the user drags something. For any board with a saved layout, it calls
`placeUnmappedVisible()`, which measures `board.clientWidth` live from the
DOM and "clamps" (rewrites) any saved card position whose `x + w` no longer
fits that width — then unconditionally `persistLayout()`s the result
(POSTs to `/api/settings`, writes `data/settings.json`).

The bug: `clientWidth` can be transiently wrong right after a provider
card's `display` toggles, right at the 1100 px breakpoint, or before
first-paint CSS/fonts settle. A narrow bogus reading makes *every* saved
card look like it "doesn't fit," so `placeUnmappedVisible()` clamps them
all to bogus x/w values and immediately persists — no drag, no user
action, environment-timing dependent (matches "randomly, from time to
time" and "survives reload" since it's now the persisted value).

**Fix chosen:** add a sanity floor — `if (boardWidth < MIN_W) return false;`
before any clamp logic runs. A board narrower than one card's minimum
width (`MIN_W = 220`) is never a real 3-column board mid-render; treat it
as "not ready yet" and skip both the clamp and the persist for that tick.
The next tick (10 s later, or the next `viewchange`) re-measures once the
DOM has settled.

**Rejected:** debouncing/requiring two consecutive stable measurements
before trusting a clamp. More robust in theory, but adds state and timers
for a case the floor check already catches; revisit only if the floor
check turns out insufficient in practice.

**Also fixed (secondary hardening, same investigation):**
- `cleanLayout()` in `src/settings.js` (rejects `__proto__`/`constructor`
  keys and non-finite `x/y/w/h`) existed but had **zero call sites** —
  `updateSettings()` only checked `typeof === 'object'` before writing
  `CARD_LAYOUT`/`ANALYSIS_LAYOUT` straight to disk. Wired it in for both.
  Not itself the reset bug, but it means a malformed client payload (e.g.
  `NaN` from `parseFloat(el.style.left)` when a card's inline style was
  never set) no longer reaches `data/settings.json` unsanitized.
- Boot-order in `initSettingsAndPricing()` (`src/web/settings.js`):
  `applySavedProviderVisibility()` was called *before* `setCardLayout()`/
  `setAnalysisLayout()`. It triggers `reapplyCardLayout()`, which today is
  a no-op against an empty `{}` map (confirmed, not the live bug) but is
  fragile — reordered so the layout maps are populated first.
- Rejected touching `setAnalysisLayout()`'s implicit re-application of the
  Overview board (it calls `applyLayout()`, which iterates *all* boards,
  not just analysis ones) — now safe under the same width-floor guard;
  not worth the extra churn to also scope it down.

## What changed
- [src/web/layout.js](../../src/web/layout.js) — `placeUnmappedVisible()`
  bails before clamping/persisting when the measured board width is
  implausibly small (`< MIN_W`).
- [src/settings.js](../../src/settings.js) — `updateSettings()` now runs
  `CARD_LAYOUT`/`ANALYSIS_LAYOUT` through the existing (previously unused)
  `cleanLayout()` sanitizer.
- [src/web/settings.js](../../src/web/settings.js) —
  `initSettingsAndPricing()` reordered: layout maps are set before
  `applySavedProviderVisibility()`/`applyPaceAlertSettings()` run.
- [test/board-layout.test.js](../../test/board-layout.test.js) — new
  contract test asserting the width-floor guard exists and runs before the
  clamp loop.
- [test/settings.test.js](../../test/settings.test.js) — new test
  asserting `updateSettings` strips unsafe keys / non-finite coordinates
  from `CARD_LAYOUT`; fixed an existing `ANALYSIS_LAYOUT` test that used a
  stale, never-real shape (`{rtk: [...]}` array lists) instead of the
  actual flat `{id: {x,y,w,h}}` map both layout maps use.
- [AGENTS.md](../../AGENTS.md) — documented the tick-driven auto-persist
  mechanism, the width-floor guard, the `cleanLayout()` wiring, and the
  boot-order fix under the `layout.js` bullet.

## Evidence
- Full suite before the settings.js `cleanLayout` wiring: 295 tests, 1
  failure (`updateSettings stores an ANALYSIS_LAYOUT object, ignores
  non-objects` — the stale-shape test, unrelated to the fix, now
  surfaced because `cleanLayout` correctly rejects the array-valued shape
  it used).
- After fixing that test's fixture to the real `{id:{x,y,w,h}}` shape and
  adding the two new tests: `rtk node --test` → 297 tests, 297 pass, 0
  fail.

## Corrections
The pre-existing `ANALYSIS_LAYOUT` test in `test/settings.test.js` asserted
a shape (`{rtk: ['an-rtk-projects', ...]}`) that no production code has
ever produced — the real shape, confirmed against `layout.js` and the
`CARD_LAYOUT` sibling test, is the flat `{id: {x,y,w,h}}` map. It only
passed before because `updateSettings()` did a bare `typeof === 'object'`
check with no shape validation. Fixed the fixture rather than loosening
the new sanitizer.

## Left undone
- Cross-tab/reload staleness: `persistLayout()` POSTs the *entire*
  in-memory layout snapshot (not a per-id delta), and the server does a
  full replace, not a merge. Two tabs open at once, or a tab holding a
  stale snapshot across a slow reload, could still overwrite a
  concurrently-saved layout from another tab. Real gap, but a different
  (much rarer, harder to reproduce, and not what was reported) failure
  mode than the tick-driven auto-persist bug fixed here. Left for a
  follow-up if it turns out to matter in practice.
- No retry/self-heal when a `persistLayout()` POST fails (network hiccup):
  errors are swallowed to `console.error`; the local `localStorage` mirror
  is only consulted on load when the server's layout is completely empty,
  not merely stale.

## How to verify
```bash
rtk node --test
```
Manually: open the dashboard, arrange mode, drag a card, exit arrange,
resize the browser window across the 1100 px breakpoint a few times (or
toggle a provider card on/off in Settings → Connections) and confirm the
dragged position survives a page reload.
