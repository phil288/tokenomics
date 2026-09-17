# RTK / Headroom update notifications

**Date:** 2026-09-17
**Status:** done

## Context
Tokenomics already self-checks for a newer app release (`src/version.js`, GitHub tags, banner in `index.html`). It had no equivalent check for the two CLI tools it depends on (RTK, Headroom) — a user could be running a stale `rtk`/`headroom` build with no signal on the dashboard. Asked to add a periodic check (every couple hours) with a UI notification.

## Decisions
- **Reused the self-update pattern instead of inventing a new one.** `src/tool-versions.js` imports `normalizeVersion`/`compareVersions`/`pickLatestTag` from `src/version.js` rather than duplicating semver logic.
- **Separate module and separate banner, not a generalization of `src/version.js`.** `collectVersion()`'s shape and every call site are covered by an existing structural-contract test suite (`test/version.test.js`) that asserts exact strings (e.g. `version: collectVersion()`). Reshaping it into a multi-tool checker would have broken that contract for no benefit — rejected in favor of a second, parallel module (`tool-versions.js`) and a second banner (`#tool-update-banner`) reusing the same `.update-banner` CSS class.
- **Latest-version source differs per tool — no shared registry:**
  - RTK is a static binary with no package-manager listing. Found its GitHub repo (`rtk-ai/rtk`) via `strings $(which rtk) | grep github.com` (the binary embeds a `github.com/rtk-ai/rtk/issues` string). Latest = max semver GitHub tag, same as the app's own check.
  - Headroom installs via pipx under PyPI name **`headroom-ai`** (confirmed with `pip index versions headroom-ai` — matched the installed `headroom --version` output; the plain `headroom` PyPI package is a different, unrelated project at a much lower version). Latest = `info.version` from PyPI's JSON API.
- **Gated per-tool on the existing `RTK_ENABLED`/`HEADROOM_ENABLED` settings** so a disabled card doesn't spend a network poll checking a tool the user isn't tracking.
- **Polling cadence: 2h default (`TOOL_VERSIONS_POLL_MS`)**, requested as "couple of hours." Kept as its own timer/module rather than reusing `VERSION_POLL_MS` (1h) — independent tools, independent cadence, and it stays consistent with how `pollAntigravity`/`pollClaude`/`pollVersion` are each on their own timer already.
- **One banner, multiple rows** rather than one banner per tool — avoids two near-identical bars stacking when both RTK and Headroom are behind at once. Dismissal key is a sorted `tool:latest` join so a further release of *either* tool re-shows the banner even after an older combo was dismissed (generalizes the existing single-tool dismissal-by-latest-version pattern).

## What changed
- `src/tool-versions.js` (new): `TOOLS` config (rtk, headroom) with `getCurrent`/`fetchLatest`/`enabled`/`url` per tool, `pollToolVersions()` (parallel poll, cache-on-success, stale-keep-last-on-failure), `collectToolVersions()` (sync cache read).
- `src/collectors.js`: `stats.tool_versions = collectToolVersions()`, alongside the existing `stats.version`.
- `server.js`: `TOOL_VERSIONS_POLL_MS` (default `7200000`), `setInterval(pollToolVersions, ...)` + one poll at startup — same shape as the existing `VERSION_POLL_MS`/`pollVersion` wiring.
- `src/web/cards-version.js`: `renderToolUpdatesBanner(toolVersions)` (one `<span class="ub-row">` per tool with `update_available`), `toolUpdatesDismissKey(toolVersions)`.
- `src/web/cards.js`: re-exports the two new functions from `cards-version.js` (kept as a separate `export` line from the existing `renderUpdateBanner` export — a structural-contract test in `version.test.js` regex-matches that exact original line).
- `src/web/main.js`: imports the two new functions, calls `renderToolUpdates(stats.tool_versions)` alongside the existing `renderUpdate(stats.version)`; `renderToolUpdates()` mirrors `renderUpdate()`'s sessionStorage-dismissal logic under a different key (`tool-update-dismissed`).
- `index.html`: second banner div `#tool-update-banner`, same `.update-banner` class as `#update-banner`.
- `index.css`: `.ub-rows` (column flex, for stacking multiple tool rows) and `.ub-row` (one tool's line) — the rest of `.update-banner`'s styling is shared/reused as-is.
- `AGENTS.md` (symlinked from `CLAUDE.md`): new §4.7 "RTK / Headroom update check", plus the two new env vars added to the environment-variables list.
- `test/tool-versions.test.js` (new, 10 tests): `TOOLS` shape, safe pre-poll default, `stats.tool_versions` wiring, server timer wiring (including the exact default-value regex), banner/CSS/`index.html` structural contract, and logic tests for `renderToolUpdatesBanner`/`toolUpdatesDismissKey` (loaded via a small CJS-shim since `cards-version.js` is an ES module and this repo has no bundler in the test path).

## Evidence
- Live poll against the real tools on this machine: `node -e "require('./src/tool-versions').pollToolVersions().then(...)"` → both tools resolved correctly and reported `update_available: false` (both installs are current — `rtk 0.49.0` / `v0.49.0` tag, `headroom-ai 0.37.0` / PyPI `0.37.0`).
- `compareVersions('0.48.0','0.49.0')` → `-1`, confirming ordering logic would flip `update_available: true` for a behind install.
- Full suite: `rtk node --test` → 295 tests, 283 → 293 passing after the fix below; the 2 remaining failures (`GET /api/cursor/token` gate, cursor-token reveal wiring) pre-date this branch — present in `git status` on `main` before this work started, untouched by any file this task modified.
- Started the server on a throwaway port (3100, via a temporary `.claude/launch.json` removed after) and confirmed `/api/events` SSE frames carry `tool_versions` with the expected shape.
- Visually verified in the Browser pane: injected a synthetic two-row "update available" state into `#tool-update-banner` — renders as a two-line banner (RTK row, Headroom row), each with its own "Release notes →" link, single dismiss button, no layout breakage, correct in dark theme.

## Corrections
- Initial `cards.js` edit combined the new exports onto the existing `renderUpdateBanner` export line — broke `test/version.test.js`'s exact-string regex match against that line. Fixed by keeping the original export line untouched and adding the two new exports as a separate `export {...}` line.

## Left undone
- No settings-modal control to disable the tool-update banner independently of the RTK/Headroom cards themselves — it inherits `RTK_ENABLED`/`HEADROOM_ENABLED`, which was judged sufficient (if you've hidden the card, you don't get its update check either).
- No retry/backoff beyond "try again next timer tick" on a failed poll — matches every other slow-poller in this codebase (`pollAntigravity`, `pollClaude`, `pollVersion`).

## How to verify
```bash
rtk node --test test/tool-versions.test.js
rtk node --test
node -e "require('./src/tool-versions').pollToolVersions().then(v=>console.log(JSON.stringify(v,null,2)))"
```
