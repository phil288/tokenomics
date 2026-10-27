# Pace note — show elapsed days instead of day index

**Date:** 2026-10-27
**Status:** done

## Context
User reported the Claude weekly bars showing `day 6/7` while they believed it was day 5. Live data: weekly `resets_at` = 2026-10-28T20:59Z (Wed 21:59 CET), so the window started Wed 21 Oct 21:59 CET; at Tue 27 Oct 15:28 CET, 5d 17.5h had elapsed. `computePace` index = `floor(5.73) + 1 = 6` — mathematically correct (6th day in progress), but read as an off-by-one by anyone counting completed days or calendar days.

## Decisions
- Keep the budget model unchanged (whole current unit's allowance available at its start → budget still 6 × 14.3% = 86%).
- Change only the display: `5.7/7 days elapsed` (hours for the 5h session: `1.2/5 hours elapsed`).
- Floor to one decimal, not round — 5.97 days must not display `6.0` while still in day 6.
- Day index kept in the tooltip (`day 6 of 7 · …`) to explain the budget multiplier.
- Rejected: changing `index` to 0-based / completed days — would shift the budget and the notify.js dedupe stamp.

## What changed
- `src/web/pace.js`: `computePace` returns `elapsedUnits`; `paceNote` renders it.
- `test/pace.test.js`: updated note assertion; new test for floor, hours unit, zero elapsed.
- `AGENTS.md` §8: note format + rationale.

## Evidence
`rtk node --test` green.

## Corrections
The reported "day 6 instead of 5" was not a calculation bug; the window is anchored to the reset instant, not the calendar week.

## Left undone
Nothing.

## How to verify
`rtk node --test test/pace.test.js`; reload dashboard → Claude weekly bars read `N.N/7 days elapsed`.
