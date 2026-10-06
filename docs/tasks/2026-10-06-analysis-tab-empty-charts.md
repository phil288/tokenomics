# Analysis tab empty (category charts on a linear axis + stale proxy log)

**Date:** 2026-10-06
**Status:** done

## Context
Every chart on the Analysis tab was blank and every x tick read `01:00 AM`.
Two independent causes:

1. `hcBase()` (`src/web/charts.js`) was changed for the Trends range work to a
   **linear timestamp x axis** with a time-formatting tick callback. The
   Analysis draw helpers reuse `hcBase()` but feed **category labels**, so
   Chart.js could not place any point on the linear axis and formatted ticks
   0..n as epoch timestamps (`01:00 AM` = 1970-01-01 in CET).
2. Headroom now logs to `~/.headroom/logs/proxy-8787.log`; `logs/proxy.log`
   stopped being written on 2026-09-30. The resolver still defaulted to
   `proxy.log`, and all its PERF lines predate the 2026-09-18 baseline, so the
   cache-hit chart and "Proxy transforms & clients" table were empty.

## Decisions
- Added a local `anBase()` in `src/web/analysis.js` wrapping `hcBase()` and
  overriding the x axis to `category` (horizontal bars: linear x + category y),
  tooltip title = category label. Rejected: reverting `hcBase()` to category —
  the Trends charts genuinely need the linear timestamp axis.
- `headroomProxyLogPath()` picks the newest-mtime file matching
  `^proxy(-\d+)?\.log$`. Rejected: hardcoding `proxy-8787.log` — port is
  configurable, and older installs still write `proxy.log`.

## What changed
- `src/web/analysis.js` — `anBase()`; `drawBars`/`drawHBars`/`drawLines` use it.
- `src/collectors-headroom.js` — newest-live-log resolver (also fixes the
  Activity feed's Headroom proxy rows, which share the resolver).
- Tests: `test/analysis-view.test.js` (axis contract),
  `test/headroom-proxy-log-path.test.js` (resolver). `AGENTS.md` §4.3 + §7.

## Evidence
- Browser, after fix: RTK period/pct/exec 14 points, Headroom models 356×3,
  quota 720×2, cache-hit 119 points; transforms/clients table populated.
- New resolver test fails on old code (picks `proxy.log`), passes now.
- `rtk node --test`: 322 pass, 0 fail.

## Corrections
- First endpoint check after the edit still returned empty: the `--watch`
  service restarted 4 s *before* `git stash pop` rewrote the files and did not
  restart again. `systemctl --user restart tokenomics.service` fixed it — not a
  code issue.

## Left undone
- Caveman panels stay empty: the caveman ledger's last row is from June 2026,
  before the 2026-09-18 baseline — real "no data since reset", not a bug.
- "Compression by strategy" stays empty: `session_stats.jsonl` holds only
  `retrieve` events, no `compress` events.

## How to verify
```bash
rtk node --test
rtk curl -s localhost:3000/api/analysis/headroom/ops
```
Open `/#analysis`: charts show dated x ticks and data.
