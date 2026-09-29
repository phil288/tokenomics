# RTK card showing 0 tokens saved

**Date:** 2026-09-29
**Status:** done

## Context
RTK card read "0 tokens saved all-time", tokens in 0, avg savings 0 %, while the
daily bars and the per-user row (660M) showed RTK working. RTK itself (v0.50.0)
and the Claude Code `rtk hook claude` hook were fine: `rtk gain` had rows up to
today.

Two causes stacked:
1. `listSnapShareDirs()` read every `~/snap/code/<rev>` dir. snapd copies the
   data dir on each refresh, so revisions 264 and 266 were duplicates of the same
   RTK DB; `current` was deduped by realpath but numbered revs were summed. The
   reset baseline (2026-09-18) captured this inflated aggregate: 6.06B saved,
   101k cmds.
2. RTK prunes rows older than `history_days = 90`. Its totals shrink over time
   (watched the snap DB drop 30,159 → 27,199 cmds within an hour as July rows
   aged out). Baseline subtraction `max(0, now − atReset)` then clamps to 0.

## Decisions
- Snap: read only the active revision (`current` target, else highest numeric).
  Rejected: content-hash dedupe of DBs — revisions diverge byte-wise after one
  write, and old revs are never live anyway.
- Baseline: while a baseline is active, compute the RTK summary from SQLite rows
  with `ts >= baseline.t` (`collectRtkSince`) instead of subtracting. Immune to
  pruning and to data-home changes. Rejected: re-capturing / deleting the
  baseline — user data, and the next pruning would break it again.
- Activity gain/loss totals use the same reader (same bug class).
- Daily/weekly/monthly reset-bucket subtraction left as-is: pruning only hits
  rows > 90 days old, so the reset-period buckets are stable unless the reset
  is older than that.

## What changed
- `src/collectors-rtk.js`: `activeSnapRevision()`, `listSnapShareDirs()` single
  revision; new `collectRtkSince(cutMs)` → `{ summary, totals }` or `null`.
- `src/collectors.js`: `collectStats()` passes `{ rtkSince }` to `applyBaseline`.
- `src/baseline.js`: `applyBaseline(stats, opts)` replaces RTK summary from
  rows when given; `applyActivityBaseline` skips offset when `rtk.since` set.
- `server.js`: `/api/activity` uses `collectRtkSince` when a baseline exists.
- Tests: `test/rtk-snap-revisions.test.js` (new), `test/baseline.test.js` (+3).
- `AGENTS.md` §4.1 and §6.

## Evidence
- Before: live SSE `rtk.summary.total_saved = 0`, `total_input = 0`.
- After: `total_saved = 7,909,793`, 15,105 cmds since reset, `summary_since: "rows"`;
  `/api/activity` gain 7,909,793. Matches a direct SQLite sum of post-reset rows.
- Un-baselined aggregate now 2.68B (was multi-counted).
- `rtk node --test`: 307/307 pass.

## Corrections
- First hypothesis was a parser break from RTK 0.50.0's new "Recovery hints"
  preamble. Wrong: `parseTextRTK` handles it; per-home totals parsed fine.

## Left undone
- `parseTextRTK` reads the Time column with `parseInt` ("2.7s" → 2 → shown as
  "2 ms"). Row-based path reports correct ms while a baseline is active; the
  un-baselined path still has the unit bug.
- A reset older than RTK's `history_days` will under-count (rows are gone).

## How to verify
```bash
rtk node --test
rtk proxy curl -sN --max-time 4 localhost:3000/api/events
```
Check `rtk.summary.total_saved > 0` and `rtk.summary_since == "rows"` with a baseline active.
