# Widget layout still reset randomly — make clamping paint-only

**Date:** 2026-09-20
**Status:** done

## Context

[2026-09-19](2026-09-19-widget-layout-random-reset.md) (commit `8189da3`) addressed
one trigger of "the widgets keep resetting": `placeUnmappedVisible()` trusting an
implausibly narrow board measurement. That fix added a `boardWidth < MIN_W` bail,
but left the underlying design intact: `placeUnmappedVisible()` still **rewrote and
persisted** saved positions whenever a saved card's `x + w` exceeded the currently
measured board width — and it runs on **every** SSE render tick (10 s), every
`viewchange`, and every provider visibility toggle.

So any *plausible but temporarily smaller* width still corrupted the layout with no
user action:

- a vertical scrollbar appearing as card content grows (board `clientWidth` drops
  ~15 px) clamps any card sitting flush against the right edge;
- crossing the 1100 px breakpoint (the CSS grid drops to 2/1 columns) clamps
  **every** card, and the clamped values were then POSTed to `/api/settings` —
  permanently destroying a layout captured on a wide screen;
- a board mid-reflow above `MIN_W` but below its real width.

Each of these produced an automatic `persistLayout()`, so the corruption survived
reloads and looked exactly like "it reset itself again".

## Decisions

- **The saved layout map is written only on user-initiated events.** Writes are now
  limited to: drag/resize (`finish()`), `seedBoard()` on entering arrange mode, and
  `placeUnmappedVisible()` assigning a slot to a widget that has *no* saved position.
- **Clamping moved into `applyBoard()` and is render-only.** A saved position that
  does not fit the measured board is clamped for painting and never written back, so
  widening the window restores the user's original placement.
  - *Rejected:* keeping the clamp write but debouncing / requiring N consecutive
    consistent measurements. Still lossy — a genuinely narrow window would still
    overwrite a wide-screen layout, and it makes the bug intermittent rather than gone.
  - *Rejected:* dropping the clamp entirely and painting saved positions as-is.
    Cards would render off-screen on a narrow window with no way to reach them.
- **Below 1101 px the free layout is not applied at all** — `unapplyBoard()` drops
  the board back to native grid flow (removes `.arranged` and the inline
  `left/top/width/height`) while leaving the saved map on disk. This matches the
  breakpoint the CSS already uses and the gate `initSettingsAndPricing()` already
  applied at boot (`window.innerWidth > 1100`); `reapplyCardLayout()` simply never
  honoured it. Arrange mode overrides the gate so a layout can still be edited.
- **Debounced `resize` listener (150 ms)** re-runs `reapplyCardLayout()`, because a
  render-only clamp needs a repaint in *both* directions (shrink and re-widen).

## What changed

- `src/web/layout.js`
  - new `boardWidthOf(b)` (shared width measurement), `freeLayoutViewportOk()`
    (>1100 px gate), `unapplyBoard(b)` (native-grid fallback, touches no map).
  - `placeUnmappedVisible()` — the saved-position clamp/persist loop is gone; it now
    only places widgets with no saved entry. `boardWidth < MIN_W` bail kept.
  - `applyBoard()` — clamps `x`/`w` for paint only.
  - `applyLayout()` / `reapplyCardLayout()` — `unapplyBoard()` when not arranging and
    the viewport is ≤ 1100 px.
  - `initLayout()` — debounced `resize` → `reapplyCardLayout()`.
- `test/layout-placement.test.js` — replaced the stale "keeps saved cards on their
  row" source-contract test with: paint-only clamp + exactly one map write in
  `placeUnmappedVisible()`, narrow-viewport fallback wiring in both entry points,
  `unapplyBoard()` touching no map, resize repaint.
- `AGENTS.md` — §2 layout notes rewritten around the "writes are user-initiated only"
  rule.

## Evidence

- `rtk node --test` → `# tests 299 / # pass 299 / # fail 0`.
- The previous guard's contract test (`test/board-layout.test.js`,
  `placeUnmappedVisible bails on an implausible board-width measurement`) still passes.

## Corrections

The 2026-09-19 record framed the implausible-width measurement as *the* cause. It was
one trigger; the cause was that a passive render tick was allowed to persist layout at
all. Narrowing which measurements are trusted could not fix that class of bug.

## Left undone

- No DOM-level regression test (the project is zero-dependency and has no DOM library),
  so the guarantees are asserted as source contracts, as elsewhere in `test/`.
- `data/settings.json` on an already-running install may still hold a `CARD_LAYOUT`
  corrupted by the old clamp. Not migrated — the user can re-drag or hit ⤺ (reset
  layout).

## How to verify

```bash
rtk node --test
```

Manually: with a saved layout and a card flush against the right edge, narrow the
window below 1100 px (cards fall back to the grid), widen it again, then reload —
the original positions must return.
