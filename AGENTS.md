<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule (NON-NEGOTIABLE)

**Every command line MUST be prefixed with `rtk`** — no exceptions, in this project and all projects. This is a hard requirement, not a suggestion.

If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use, so there is never a reason to omit it.

- Applies to **every** command, including each segment of a chain (`&&`, `||`, `|`).
- Applies even to commands RTK does not have a dedicated filter for (it passes through unchanged).
- No "this one is simple/read-only so I'll skip rtk" — still prefix it.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->

---

# Tokenomics Agent Guide

This guide is for AI coding agents (Claude Code, Antigravity, or other LLM-based assistants) working on the **Tokenomics** codebase. It outlines the project's architecture, patterns, constraints, and development guidelines.

## 1. Project Overview

**Tokenomics** is a lightweight, real-time dashboard that monitors token usage and cost savings from three AI development tools:
- **RTK (Rust Token Killer)**: Proxies and optimizes CLI interactions.
- **Caveman**: Ultra-compressed Claude Code communication mode.
- **Headroom**: Context optimization layer and proxy.

The application is structured as a **single-file backend** (`server.js`) and a **modular ES-module frontend** (`index.html`, `index.css`, and the `src/web/*.js` modules), keeping the codebase extremely lean, fast, and easy to modify.

## 2. Key Architecture & File Layout

- **`server.js`**:
  - Starts an HTTP server on the configured `PORT` (default: `3000`).
  - Implements a custom Server-Sent Events (SSE) server (`/api/events`) to stream real-time token statistics to the browser.
  - All routes match on the **path only** (`req.url` stripped of its query string) — query strings like `/?filter=rtk` or `/web/main.js?v=123` must never 404. `/web/*.js` serving is traversal-guarded by a resolve + prefix check (the route regex alone still admits `..`). `POST /api/settings` caps the request body at 1 MB (413 beyond that).
  - Spawns subprocesses and reads files on a timer (`REFRESH_MS`, default: `10000`) to collect tool data.
  - Records compact snapshots of historical data to `data/history.jsonl` every minute (`HISTORY_INTERVAL_MS`, default: `60000`), capped at `HISTORY_MAX` (default: `5000`) entries.
  - Serves a family of **on-demand deep-analysis endpoints** under `/api/analysis/*` (§7). These are **not** part of the 10 s SSE loop — they run only when the browser's Analysis tab fetches them, because they read SQLite row-by-row and tail multi-MB logs.
- **`src/analysis.js`** (CommonJS): all `/api/analysis/*` aggregations. Event-shaped — reads the tools' own ledgers (RTK SQLite, caveman JSONL, Headroom savings history + log tails) and filters to the baseline cut (§6). Requires `collectors.js` (shared helpers: `rtkDataHomes`, `tailFileSync`, `cavemanHistoryPath`, headroom path resolvers, `parseProxyPerfLine`/`parseSessionStatLine`) and `baseline.js` (`getBaseline`) — no require cycle.
- **Collector modules**: `src/collectors.js` is the small public facade/orchestrator. Tool-specific logic lives in `collectors-rtk.js`, `collectors-caveman.js`, `collectors-headroom.js`, `collectors-cursor.js`, `collectors-antigravity.js`, and `collectors-activity.js`; shared home/path/I/O helpers live in `collector-utils.js`. Keep `collectors.js` under 500 lines and add new collector behavior to the relevant tool module rather than growing the facade.
- **`index.html`**:
  - The HTML layout structure. Links to `/index.css` and loads `/web/main.js` as an ES module.
- **`index.css`**:
  - The styling system with a customized, clean theme stylesheet with dark, light, and automatic theme support.
- **`src/web/*.js`** — the client-side dashboard, split into ES modules (served by `server.js` under `/web/`):
  - `main.js` — entry point: wires the `/api/events` SSE stream to the renderers, owns the refresh countdown + live clock, and bootstraps every other module.
  - `cards.js` — small public facade for per-card renderers. Card implementation is split by family: `cards-core.js` (RTK/Caveman/hero), `cards-common.js` (shared model/user/progress helpers), `cards-cursor.js`, `cards-antigravity.js`, `cards-claude.js`, `cards-headroom.js`, and `cards-version.js`. Keep `cards.js` under 500 lines and add new card behavior to the relevant module rather than growing the facade.
  - `charts.js` — the RTK daily bar chart and history trend lines (**Chart.js**, loaded from a CDN).
  - `pricing.js` — the client `PRICING` matrix and per-model cost/weight math.
  - `format.js` — pure formatting helpers (token/USD/time formatting).
  - `pace.js` — quota **consumption pacing** (§8). Pure and **import-free** by design so the CJS test suite can load it (see `test/pace.test.js`).
  - `notify.js` — desktop **pacing alerts** (§8): browser `Notification` when a bar burns through a share of its budget. Also import-free, for the same test loader.
  - `theme.js` — dark/light/auto theme switching. `layout.js` — free-drag card layout. `settings.js` — settings modal. `state.js` — shared mutable state.
  - `activity.js` — the Activity tab feed **and** the generic dashboard tab switcher (`activateView()`, hash-driven). On every view change it dispatches a `viewchange` `CustomEvent` on `window` so lazily-loaded views can fetch on open without `activity.js` importing them.
  - `analysis.js` — the **Analysis tab**: RTK / Caveman / Headroom drill-downs. Fetches the four `/api/analysis/*` endpoints (throttled ~30 s, only while its view is visible) plus renders SSE-derived charts (RTK period/exec/pct from `state.lastStats.rtk`; Headroom spend tiles from `savings.lifetime`) and the quota-over-time chart from `/api/history`. Owns its own Chart.js registry and registers a redraw hook with `charts.js` (`registerRedraw`) so theme flips repaint it. Escapes all tool-derived strings (`esc()`).
- The three dashboard views are tabs in one page (`#view-overview` / `#view-activity` / `#view-analysis`), not separate routes.
- **Overview board layout.** One `.board` grid (`repeat(3, 1fr)`) holding **six** direct children: the three LLM usage cards (`#claude-card`, `#cursor-card`, `#antigravity-card`) across the top row, then three `.board-col` columns (`.bcol-1` RTK+Caveman, `.bcol-2` Headroom, `.bcol-3` Trends). Above 1100 px each of those six is **pinned with an explicit `grid-area`** — a card the user disables is `display:none`, and auto-placement would otherwise pull a column up into the top row. Narrower breakpoints drop to 2/1 columns and auto flow. Keep it **one** `.board` element: `layout.js` free-drag positions are absolute and keyed by card id within that single container, so markup reordering never disturbs a user's saved `CARD_LAYOUT` (`.board.arranged .board-col { display: contents }` makes the column nesting irrelevant). Contract test: `test/board-layout.test.js`.
- **`data/`** (gitignored):
  - Created at runtime to store the `history.jsonl` file.
  - Can be moved with `TOKENOMICS_DATA_DIR`; machine-wide macOS installs put it under `/Users/Shared/tokenomics-data` with root-only (`700`) permissions because settings may contain credentials.

## 3. Critical Constraints & Rules

When modifying or expanding Tokenomics, agents **must** adhere to the following rules:

### 🛑 Prefix Every Command with `rtk` (NON-NEGOTIABLE)
**Every command line you run MUST start with `rtk`** — no exceptions. This is a hard requirement, not a suggestion (see the [Golden Rule](#golden-rule-non-negotiable) at the top of this file).
- Applies to **every** command, including each segment of a chain (`&&`, `||`, `|`).
- Applies even to commands RTK has no dedicated filter for — it passes them through unchanged, so `rtk` is **always safe**.
- No "this one is read-only/simple, I'll skip it." Still prefix it. Omitting `rtk` leaks tokens for zero benefit.

### 🚫 Zero External Runtime Dependencies
The project prides itself on having **zero runtime dependencies** (other than Node.js built-ins).
- **Do NOT** add standard npm dependencies (e.g., `express`, `dotenv`, `axios`, `cors`) to `package.json`.
- All web operations, routing, SSE streaming, child process orchestration, and file reads must continue to use Node.js standard library APIs (`http`, `fs`, `path`, `child_process`, `os`).

### 🔄 Keep Cost & Model Lists in Sync
Both `src/settings.js` and `src/web/pricing.js` define pricing matrices for Claude, Gemini/Antigravity, and Cursor models:
- In `src/settings.js`: the `DEFAULT_PRICING` array defines model prefixes and token costs / cache multiplier values (served to the client via `/api/settings`; users can override it at runtime, which persists to `data/settings.json`).
- In `src/web/pricing.js`: the exported `PRICING` array is the client-side default (mutated in place when settings load).
- **If you add a new model or update pricing, you must modify BOTH files to keep them perfectly in sync.**

### 🎨 Design & Visual Excellence
- The UI is designed to feel responsive, premium, and clean (using sleek gradients, card shadows, theme transitions, and progress bar animations).
- Avoid modifying the layout in a way that breaks responsiveness on smaller viewports.
- Keep the custom styled scrollbars, tooltip formats, and transitions intact.

### ✅ Every New Feature Ships With Tests (NON-NEGOTIABLE)
**No feature is "done" until it has tests and the full suite passes.** This is a hard requirement.
- Add or extend a `test/*.test.js` file for every new feature, behavior change, or bug fix.
- Tests use the **Node.js built-in test runner** (`node:test` + `node:assert/strict`) — **no test-framework dependency** (respect the zero-dependency rule above).
- Run the full suite with `rtk node --test` (alias: `rtk npm test`) before considering the work complete. It must be green.
- Match the existing patterns:
  - **Backend logic** (`server.js`, `src/*.js`): boot the real code against a temp data dir / free port and drive it — see `test/server.test.js`, `test/settings.test.js`, `test/collectors.test.js`.
  - **Front-end DOM** (`index.html`, `src/web/*.js`): there is **no DOM library** (zero-dep), so assert the HTML/JS *contract* by reading the files and checking structural invariants — see `test/settings-tabs.test.js` (tab↔panel pairing, default active state, field placement, wiring in the JS).
- Isolate side effects: point `TOKENOMICS_DATA_DIR` at a `mkdtempSync` temp dir so real `data/` files are never touched.

### 🧠 Keep Agent Knowledge Current (NON-NEGOTIABLE)
**Every feature, bug fix, architecture change, data-source behavior change, testing pattern, or gotcha discovered while working must update `AGENTS.md` in the same change.** The guide is the project memory for future agents, so stale instructions are treated as an incomplete implementation.
- Update the relevant section when behavior changes, not just when a new section is obvious.
- Record durable knowledge: data contracts, environment variables, reset/baseline semantics, collector quirks, UI wiring expectations, test strategy, and operational constraints.
- Do **not** add noisy changelog entries or temporary debugging notes. Capture what a future agent needs to know to work safely.
- If no `AGENTS.md` update is needed for a change, explicitly verify that the existing guide already covers the behavior before finishing.

## 4. How Data Collection Works

Understanding how each source is resolved is crucial for debugging:

### 1. RTK (Rust Token Killer)
- Resolved by running the CLI command `rtk gain -g -a`.
- Since different launchers (like snaps) specify different `XDG_DATA_HOME` paths, `server.js` scans candidate shared directories (e.g. `~/.local/share`, `~/snap/code/<rev>/.local/share`, and macOS `~/Library/Application Support`), finds all active SQLite history databases, queries each individually using `rtk gain -g -a`, and merges the daily, weekly, and monthly totals dynamically. In multi-home mode (`TOKENOMICS_HOMES`), configured homes are deduped, and RTK probes pass both a matching `HOME` and the discovered `XDG_DATA_HOME` where possible so Linux/Snap and macOS data locations both resolve correctly.
- Pinned to a specific folder if `RTK_DATA_HOME` is set.
- The Analysis view reads the SQLite `commands` table **directly** (via `node:sqlite`, same guarded pattern as `readRtkActivity`/`collectRtkTotals`). Columns of note: **`project_path`** (per-command repo attribution — used only by the analysis view, no other consumer) and **`rtk_cmd`**/`original_cmd` (grouped into command types). **Loss convention:** `saved_tokens < 0` **never occurs** — RTK records a loss as `saved_tokens = 0` with `output_tokens > input_tokens`, so gain/loss is always derived from the input/output delta (matching `collectRtkTotals`). **Timestamp trap:** rows mix `+00:00` and `Z` suffixes, so baseline filtering is done in JS via `Date.parse(ts) >= cut`, **never** by lexicographic SQL string compare against `toISOString()` (`Z` < `+`).

### 2. Caveman
- Reads `~/.claude/.caveman-active` to determine the active mode.
- Parses the JSON lines file at `cavemanHistoryPath()` (`~/.claude/.caveman-history.jsonl`, overridable via `CAVEMAN_HISTORY_PATH` settings/env — used by both `collectCaveman()` and the Analysis reader) to calculate session counts, total output tokens, and estimated USD saved. Only the latest log entry per `session_id` is counted **for the totals**. In `TOKENOMICS_HOMES` mode, each home is read independently and session IDs are namespaced by home before totals are merged.
- The JSONL is actually a **per-session time series** (many rows per `session_id`, appended as the session runs), with `ts` (**ms epoch**), `mode`, `model`, `output_tokens`, `est_saved_tokens`, `est_saved_usd`. `collectCaveman()` collapses it to latest-per-session; the Analysis view reads **all** rows (growth curves, by-model, by-mode). Caveman is also an **Activity feed source** (`collectActivity()`): one row per event line, `before = output_tokens + est_saved_tokens`, `after = output_tokens`.

### 3. Headroom
- Headroom keeps **two** files (per its filesystem-contract); `collectHeadroom()` reads both:
  - **Savings ledger** — `~/.headroom/proxy_savings.json` (`HEADROOM_SAVINGS_PATH`, settings **or** env). Authoritative source, matching what `headroom perf` reports: `lifetime.tokens_saved`, `lifetime.compression_savings_usd`, `lifetime.requests`, `display_session.savings_percent`, plus **`lifetime.total_input_tokens` / `total_input_cost_usd`** (the spend denominator — Analysis "savings as % of spend"). The Headroom card headline, the hero "Headroom" chip, and the history "saved" trend lines all come from here. ⚠️ This file also carries a large per-model **`history[]`** (up to `HISTORY_MAX`-ish cumulative snapshots, MBs) and a `projects` map — **`collectHeadroom()` strips both** before returning, so they never ride the 10 s SSE frame. The per-model `history[]` is served on demand via `/api/analysis/headroom/models` instead (its only consumer).
  - **Subscription state** — `~/.headroom/subscription_state.json` (`HEADROOM_SUBSCRIPTION_STATE_PATH`). Holds quota windows (`latest.five_hour` / `seven_day`, used by the Claude card) and raw `window_tokens` telemetry. ⚠️ raw `window_tokens` **resets whenever the Headroom proxy restarts (e.g. every PC reboot) or a quota window rolls** — it is *usage telemetry, not savings*. Never treat `window_tokens.cache_reads` as a cumulative saving (old code did `cache_reads × 0.9`, producing a phantom sawtooth that did not match `headroom perf`).
- `collectHeadroom()` returns the subscription object with the savings ledger attached as `.savings` — but its `window_tokens` is **not the raw source value**: it is replaced by the persisted local accumulator from `src/headroom-telemetry.js` (state file `data/headroom-telemetry.json`). The accumulator folds in only the newly observed growth of the raw counters (top-level + `by_model`), treats a shrunk counter as a source reset (the whole new value is new usage), and — when the raw source is missing/unreadable — returns the persisted totals **without touching its `last` snapshot** (updating `last` to zeros on a failed read would double-count still-growing raw counters on the next successful read). Result: the card's telemetry survives PC/proxy restarts and window rollovers, and only "resets" via the dashboard's own reset flow (§6 baseline offset — non-destructive; the accumulator file itself is never wiped by a reset).
- The accumulated `window_tokens` is **monotonic** — it only ever grows. This is why `applyBaseline()` subtracts the window baseline unconditionally (no quota-window-identity gating; the old `window_reset_key` guard was removed when the accumulator landed). It is still *usage, not savings* — never build a saving out of it.
- In `TOKENOMICS_HOMES` mode, subscription and savings files are read from every configured home in parallel, numeric lifetime/window counters are summed, and recency fields use the newest timestamp. Per-user status rows are exposed on the card data for RTK, Caveman, Claude, and Headroom.
- **Quota freshness (`latest.polled_at`).** The Claude card's quota bars are only as fresh as Headroom's **last poll of the Anthropic quota API** — if the proxy stops polling, the bars keep rendering the last-seen numbers and look live indefinitely. `latest.polled_at` (ISO, UTC) is that timestamp and is the *only* honest freshness signal: the dashboard's own 10 s refresh says nothing about it. `polledFreshness()` in `src/web/cards-claude.js` renders it as `Updated <ago>` at the top of **both** render paths (quota bars **and** the "poll pending / Headroom unreachable" fallback), tiered `fresh` / `warn` (≥ `POLL_WARN_SECS`, 5 min) / `stale` (≥ `POLL_STALE_SECS`, 30 min), plus `unknown` (red) when the field is missing or unparseable. It rides the existing 1 s `clockTick` repaint in `main.js`, so the age ticks without waiting for an SSE frame — keep the helper pure/idempotent. Styling is `.poll-age[.warn|.stale|.unknown]` in `index.css` using `--muted`/`--warn`/`--danger` so it survives theme flips. Tests: `test/cards-claude-quota.test.js`.

### 4. Cursor
- Queries the Connect RPC endpoint `https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` to fetch account quotas and billing cycles.
- Authenticates using the `cursorAuth/accessToken` JWT token extracted from Cursor's local SQLite store (`~/.config/Cursor/User/globalStorage/state.vscdb`) or the `CURSOR_ACCESS_TOKEN` environment variable.
- **Token resolution is a single shared helper** — `resolveCursorToken()` in `collectors.js` — returning `{ token, source }` (`source` = `'settings' | 'env' | 'db' | null`) with precedence **saved settings → env → Cursor DB** (settings value is trimmed; blank falls through). Both `collectCursor()` and the reveal endpoint use it, so there is one resolution order.
- **Revealing the effective token in the UI:** `GET /api/cursor/token` returns `{ token, source }` on demand (null when `CURSOR_ENABLED === false`, mirroring the collector gate). It is **deliberately not** part of `/api/settings` — the JWT must not ride the routine settings fetch. The settings modal only shows the **manually-saved** `settings.CURSOR_ACCESS_TOKEN`; when the field is empty and the user clicks the eye (reveal), `src/web/settings.js` fetches this endpoint and fills the field with the effective DB/env token (guarded: never clobbers a non-empty field). Saving afterward persists that token into settings as an explicit override. The field is **re-masked on every modal open** (`resetCursorTokenReveal()` in `loadSettingsUI()` forces `type='password'` + the closed-eye icon + clears the test status), so a token revealed in a prior open never reappears in plain text.
- **Testing a token against the live API:** `POST /api/cursor/test` with body `{ token }` (optional) validates a token and returns `{ ok, status?, error?, source }`. Blank body → tests the **effective** token (settings → env → DB), so the user can validate either a value they just typed OR the stored one **before saving**. The "Test token" button (`#test-cursor-token`, status in `#cursor-token-status`) in the Connections tab drives it. Validation goes through `testCursorToken()` in `collectors.js`, which shares the low-level `cursorUsageRequest()` helper with `collectCursor()` (one place the token hits the Cursor RPC — identical auth/error handling); it does **not** apply the `CURSOR_ENABLED` gate (you test a token regardless of whether the card is enabled). The route caps the body at 1 MB (413) and 400s on invalid JSON.
- Tests: `test/cursor-token.test.js` (resolution chain incl. DB branch via a temp `HOME`, **plus** `testCursorToken` valid/invalid/fallback/network with a stubbed `global.fetch`), `test/server.test.js` (both endpoints + gate; the server fixture boots with an empty `HOME` + no `CURSOR_ACCESS_TOKEN` so `/api/cursor/test` resolves nothing and never hits the network), `test/settings-tabs.test.js` (reveal + Test-button wiring).

### 5. Antigravity
- There is **no local usage file** for Antigravity — its only reliable usage source is the `agy` CLI's interactive `/usage` slash command (which only renders inside a real TUI; `agy --print/-i "/usage"` treats it as an agent prompt and does not work).
- The parser keeps agy's own semantics (`remainingPct`, `full` for its "Quota available" line); **`cards-antigravity.js` inverts it to used %** so the card matches every other quota bar. A `full` limit renders 0% with the sub-line `quota used`.
- `src/agy-usage.py` drives `agy` headlessly: it allocates a **PTY** via Python's `pty` module, sets a window size (bubbletea quits without one), waits for the TUI to settle, types `/usage`, captures the rendered panel, and prints it. `collectors.js` then strips ANSI and parses it (`parseAgyUsage`) into per-model-group quota (Gemini vs Claude+GPT; the gauge % is **remaining** quota). Limits are parsed **generically**: every "`<label> Limit`" **or** "`<label> Limit Remaining`" section agy prints becomes an entry in the group's `limits[]` array (`{label, remainingPct, refresh, full}`), and the card renders exactly those bars. The set varies by tier — Starter Quota shows only a weekly limit; others may add a 5-hour or other window — so nothing is hardcoded and a phantom 0% bar can't appear. **Format trap (agy ≥1.1.10):** headers renamed `Weekly Limit` → `Weekly Limit Remaining`, and refresh moved onto the status line (`79% remaining · Refreshes in 142h 43m`). Parser must accept both shapes — matching only `… Limit$` yields groups+models with **empty `limits[]`**, which the card renders as titles with no bars (looks "polled" but blank). Refresh extraction still keys off `Refreshes in …` anywhere on the line.
- Polling is **expensive**: each poll spawns the ~171 MB `agy` binary for ~15–20 s. It therefore runs on its own slow timer (`ANTIGRAVITY_POLL_MS`, default `300000` = 5 min) via `pollAntigravity()`, and `collectStats()` only reads the cached result — it is **not** part of the fast 10 s SSE loop.
- **Requirements**: system `python3` (used only as a PTY driver, no npm dependency added) and `agy` on `PATH` (`~/.local/bin/agy`) with a logged-in Antigravity account.

## 5. Development & Verification Workflow

### Running Locally
- Run the server in development mode using Node's watch mode (restarts the server automatically when `server.js` changes):
  ```bash
  rtk npm run dev
  ```
- Frontend modifications (`index.html`, `index.css`, `src/web/*.js`) are served directly from the disk. **Simply edit the files and refresh your browser** to see the changes.

### Change Checklist
Before finishing any code change:
- Update or confirm tests for the changed behavior.
- Update `AGENTS.md` with any new durable agent knowledge, or confirm the existing guide already covers it.
- Run the full suite with `rtk node --test` and make sure it passes.

### Environment Variables
For testing different scenarios, you can override settings:
- `PORT` (default: `3000`)
- `TOKENOMICS_DATA_DIR` (default: `data/`; use a private root-owned directory for shared LaunchDaemon installs because it can hold settings, baselines, history, and Headroom telemetry)
- `TOKENOMICS_HOMES` (comma-separated home directories to aggregate for machine-wide/multi-user service installs; duplicates are ignored)
- `REFRESH_MS` (default: `10000`)
- `HISTORY_INTERVAL_MS` (default: `60000`)
- `HISTORY_MAX` (default: `5000`)
- `ANTIGRAVITY_POLL_MS` (default: `300000` — how often the heavy `agy` `/usage` poll runs)
- `RTK_DATA_HOME` (forces a single RTK directory path)
- `CAVEMAN_HISTORY_PATH` (overrides the caveman JSONL location — used by collector, activity feed, and Analysis reader; mainly for tests)
- `HEADROOM_SAVINGS_PATH` / `HEADROOM_SUBSCRIPTION_STATE_PATH` / `HEADROOM_SESSION_STATS_PATH` / `HEADROOM_PROXY_LOG_PATH` (override Headroom file locations — settings **or** env; mainly for tests)

## 6. Resetting Stats (Baseline Offset)

**The mental trap:** Tokenomics owns almost no numbers. RTK / Caveman / Headroom totals are read fresh from the tools' own ledgers (`rtk gain`, `.caveman-history.jsonl`, `proxy_savings.json`) on every 10 s refresh. So "reset" cannot mean "delete our stored value" — there is nothing of ours to delete, and anything we wipe repopulates on the next tick. The **only** honest, non-destructive reset is a **baseline offset**.

### How it works — `src/baseline.js`
- On **"Reset all stats"** (`POST /api/history/reset`) the server captures the current **absolute** readings (via `collectStatsRaw()`) into `data/baseline.json` and clears the trend history. The endpoint requires the UI-only confirmation header `X-Tokenomics-Reset-Confirm: manual`; unconfirmed POSTs are rejected (400) so a stray request cannot silently create a new baseline.
- `collectStats()` = `applyBaseline(await collectStatsRaw())`. Every reading is shown **minus** the baseline (clamped at ≥ 0), applied **once** server-side so the SSE stream, recorded history snapshots, and the activity feed all share one consistent offset view. The tools' ledgers are never touched → fully reversible via `DELETE /api/baseline` ("Restore absolute totals").
- The baseline persists to disk and reloads on boot (mirrors `history.js`).

### What is offset vs left alone
- **Offset (cumulative counters):** RTK `summary.total_saved/commands/input/output`; Caveman `total_saved_tokens/output_tokens/saved_usd/session_count`; Headroom `savings.lifetime.tokens_saved/compression_savings_usd/requests` **and** `total_input_tokens/total_input_cost_usd` (spend denominator — so the Analysis "% of spend" ratio stays coherent post-reset).
- **Also offset (subtle, learned the hard way):**
  - **RTK daily chart buckets.** Trimming pre-reset days is not enough: RTK rolls up a whole day into one bucket, so the **reset-day** bucket already contains pre-reset activity and its bar stays full. The baseline snapshots that day's bucket *at reset time* and subtracts it, so the reset-day bar starts at zero and grows.
  - **RTK weekly & monthly buckets.** Same trap as daily, now that the Analysis view charts them: the reset falls inside one weekly and one monthly rollup that already hold pre-reset activity. `snapshotTotals()` captures the reset-**week** and reset-**month** buckets (`b.rtk.week` / `b.rtk.month`), and `applyBaseline()` drops earlier periods + subtracts the reset-period bucket (via the shared `offsetBucket` helper). `savings_pct` is recomputed from the offset totals.
    - **Reset instant is a single source of truth.** `snapshotTotals(stats, now = Date.now())` and `captureBaseline(rawStats, rtkTotals, now = Date.now())` derive **both** `baseline.t` **and** the reset day/week/month bucket match from the same `now` (ms epoch). Production passes nothing (real reset time); **tests must inject a fixed `now`** so the reset-period bucket match doesn't drift with the wall clock — passing a stale hardcoded fixture date while `snapshotTotals` read ambient `new Date()` was exactly the pre-existing bug that made `b.rtk.week` come back `null` once real-today left the fixture's week. Do **not** reintroduce an ambient `new Date()` inside snapshot/apply.
  - **Analysis-view event data** (RTK projects/losses/types, caveman sessions/growth, Headroom model history + ops) is offset in `src/analysis.js` itself — event rows filtered to `ts >= baseline.t` (`Date.parse`, per the timestamp trap in §4.1), and the cumulative per-model Headroom history is **rebased** at each model's value-at-reset. Averages/ratios and quota bars are left alone.
  - **Headroom window telemetry** (`window_tokens` top-level **and** `by_model`). The value reaching `applyBaseline()` is the persisted local accumulator (see §4.3), which is **monotonic** — it never drops on proxy restarts or window rollovers — so the window baseline is subtracted **unconditionally** to show "usage since reset". (No quota-window-identity gating: the old `window_reset_key` guard existed for raw rolling counters and was removed with the accumulator. This is also **not** the old phantom-sawtooth bug: we are not inventing a saving, just shifting a display zero-point.)
- **Left alone (not cumulative counters):** percentages/ratios (`avg_savings_pct` is *recomputed* from the offset totals; `display_session.savings_percent` kept as-is), average exec time, and all quota-utilisation bars.

### The Activity tab (`/api/activity`) is offset separately
The activity feed is a **different endpoint**, not part of `collectStats()`, so `applyBaseline()` doesn't reach it — it needs its own pass, `applyActivityBaseline({ rows, rtk })`, called in the `/api/activity` handler. It's **event-based**, so "reset" means *only show events after the reset*:
- **Rows** are filtered to `ts >= baseline.t`. Rows with **no timestamp** can't be proven post-reset, so they're dropped while a baseline is active.
- The **whole-DB RTK gain/loss totals** (`collectRtkTotals()` → `{ gain, loss, net, gainCmds, lossCmds }`) are offset by their value at reset. Those are captured via `captureBaseline(rawStats, collectRtkTotals())` — passed **in** from `server.js` rather than imported, to avoid a `collectors.js ↔ baseline.js` require cycle — and stored on `baseline.rtkTotals`. `net` is recomputed from the offset `gain - loss`.

### Gotchas
- **Server-side offset ≠ what the browser shows.** The DOM only updates from SSE frames. After a reset the stream carries zeros immediately, but a stale tab / cached JS keeps showing old numbers — **hard-refresh** to confirm. Verify the truth with a raw frame: `curl -sN --max-time 4 localhost:3000/api/events`.
- **Baselines are versioned by their fields.** A baseline captured by an older build lacks `.rtk.day` / `.rtk.week` / `.rtk.month` / `.headroom.window` / `.headroom.total_input_*`; `applyBaseline()` guards each sub-object so it still applies safely, but the newer surfaces (reset-period bars, window telemetry, spend denominator) won't zero until the user **resets again** to capture a richer baseline.
- `data/baseline.json` lives in the gitignored `data/` dir alongside `history.jsonl`; the Headroom telemetry accumulator state lives in `data/headroom-telemetry.json`.

### Tests
- `test/baseline.test.js` — capture/apply/clamp, reset-day **and reset-week/month** bucket subtraction, Headroom spend-denominator offset, old-baseline-without-new-fields guard, window-telemetry offset (kept applying across Headroom's own window rollover), activity-feed offset (`applyActivityBaseline`), persistence.
- `test/analysis.test.js` — the `src/analysis.js` aggregations against real SQLite/JSONL/JSON fixtures: RTK projects/losses/command-types (incl. mixed-suffix baseline cut), caveman sessions/by-model/by-mode/growth, Headroom model grouping + downsample + rebase-at-reset, ops strategy/transform/client + window clamp, and the caveman Activity row shape.
- `test/analysis-view.test.js` — DOM-contract: the Analysis tab/view pair, every element `analysis.js` paints into, main.js bootstrap, the four endpoint paths, the `registerRedraw` hook, and the caveman Activity source.
- `test/headroom-telemetry.test.js` — the accumulator: first-observation seeding, same-window growth, restart-reset survival, post-reset new usage, missing-source reads (no `last` mutation → no double-count), and the `collectHeadroom()` wiring end-to-end.
- `test/server.test.js` — `POST /api/history/reset` writes the baseline + clears history (and is rejected without the confirm header); `DELETE /api/baseline` removes it.
- `test/settings-tabs.test.js` — the "Restore absolute totals" control exists in the Data tab and is wired to `DELETE /api/baseline`.

## 7. Analysis View & On-Demand Endpoints

The **Analysis tab** surfaces data the tools already write but the main cards ignore. All aggregation lives in `src/analysis.js`; `server.js` dispatches `GET /api/analysis/*` through the `ANALYSIS_ROUTES` table (unknown subpath → 404, handler throw → 500 JSON). Everything is **on-demand** — never in the SSE loop — because it reads SQLite rows and tails multi-MB logs.

| Endpoint | Returns | Source & notes |
|---|---|---|
| `GET /api/analysis/rtk/projects` | `{projects[], since}` net-sorted | SQLite `commands.project_path`; empty path → `"(unknown)"` |
| `GET /api/analysis/rtk/losses?limit=50` | `{rows[], total_loss_rows, since}` worst-first | rows where `output>input`; `limit` clamped 1–200 |
| `GET /api/analysis/rtk/commands` | `{types[], since}` | grouped by command type (first token; `git/gh/cargo/npm/pnpm/npx/docker/kubectl/go/rtk` keep their 2nd token); passthrough = `output===input` |
| `GET /api/analysis/caveman?series=10` | `{sessions[], by_model[], by_mode[], series[], since}` | full JSONL read; `series` clamped 1–25, ≤500 pts each |
| `GET /api/analysis/headroom/models?points=300` | `{models[], total_points_raw, since}` | parses `proxy_savings.json.history[]`; uniform-stride downsample (`points` clamped 10–1000, last point kept exact); rebased at reset |
| `GET /api/analysis/headroom/ops?bytes=2MB` | `{strategies[], transforms[], clients[], cache_trend[], window_bytes, window_partial, since}` | tail-window over `session_stats.jsonl` + `proxy.log` (`bytes` clamped 64 KB–8 MB). `window_partial=true` → aggregates cover only the tail; UI labels it "last N MB" |

**Three features need no endpoint** — they render from data already on the SSE stream / `/api/history`: RTK weekly/monthly/exec-time/savings-% trends (`stats.rtk.weekly/.monthly/.daily`), Headroom savings-%-of-spend (`savings.lifetime`), and quota-over-time (`hr.q5/q7` in the minute snapshots).

**Rules for extending:** put new aggregation in `src/analysis.js` (never the SSE path); baseline-filter event rows in JS via `Date.parse(ts) >= getBaseline().t` (§4.1 timestamp trap); clamp every user-supplied limit/points/bytes param; escape tool-derived strings in `src/web/analysis.js` (`esc()`); if a chart is added, it must be rebuilt by the `registerRedraw` hook so theme flips don't leave stale axis colors; and per §3 test rule, extend `test/analysis.test.js` (logic) + `test/analysis-view.test.js` (DOM contract) + `test/server.test.js` (route).

**Panel free-drag (shared arrange mode).** The analysis panels use the **same** arrange mode as the Overview cards — the one `#arrange-btn` (⇲) toggle in the header — not a separate mechanism. `src/web/layout.js` is **multi-board**: `boards()` returns the Overview `.board` plus every `#view-analysis .an-grid`; each grid's direct `.an-block` children are freely draggable + resizable in 2D exactly like `.card`s. Positions persist in **`settings.ANALYSIS_LAYOUT`** = `{ "<block-id>": {x,y,w,h} }` (flat map, same shape as `CARD_LAYOUT`; block ids are `anb-*`, assigned in `index.html`). `layout.js` owns both `setCardLayout` and `setAnalysisLayout`; `settings.js` imports both from there and `persistLayout()` writes `CARD_LAYOUT` + `ANALYSIS_LAYOUT` together (+ `localStorage` mirrors). Gotchas baked into `layout.js`: only **visible** boards are seeded/applied (a hidden view's children have no `offsetParent`); `enterArrange()` **seeds every board in one pass before applying any** (applying makes a grid's children absolute and collapses it, shifting later grids — measuring must finish first); switching views while arranging re-seeds the newly-shown board via the `viewchange` event; and `analysis.js` suppresses table sorting while `isArranging()` (so a header click drags the panel instead of sorting). CSS mirrors the board: `.an-grid.arranged` (absolute children) / `.an-grid.editing` (dashed outline, grab cursor, resize handle) using the `--accent` arrange color.

**Sortable tables.** Every analysis table renders through `mountTable(mountId, cols, rows)` in `analysis.js` — never raw `innerHTML`. Each header is click-to-sort (Enter/Space too): first click sorts (num columns → desc, text → asc), clicking the active column flips. Sort state + raw rows are held per mount id (`tableSort` / `tableStore`) so SSE-tick repaints and refetches preserve the chosen order. Columns are `{ label, num?, cell(r)→html, title?(r), v?(r) }` — `v` is the sortable value (**required as a number** on `num` columns so they sort numerically, not lexically; text sorts via `localeCompare({numeric:true})`). The delegated header-click listener is wired once per mount (`dataset.sortWired`) and survives `innerHTML` repaints.

**Repaint invariants (learned from flicker bugs).** (1) Analysis charts update **in place** — `upsertChart()` reassigns `data`+`options` and calls `.update('none')`; it only destroys/recreates when the chart *type* changes. Never go back to destroy-on-every-paint: it replays the grow animation and looks like the chart is resizing on its own each SSE tick. (2) The 10 s SSE tick repaints **only** `paintLive()` (RTK period/pct/exec charts + Headroom spend tiles, all SSE-derived); the endpoint-backed tables and charts repaint **only** on a real refetch (~30 s), theme flip, or view open — otherwise tables re-render and lose scroll 6×/min. (3) `.an-grid` uses `align-items: start` so a panel is the **same height** in native grid flow and in absolute arrange mode; without it, grid stretches panels to the tallest sibling and toggling arrange resizes the charts / flashes empty space.

**Table CSS invariants (learned from a bug):** analysis tables use `table-layout: fixed` + `width:100%` so they never produce a **horizontal** scrollbar inside a block; `.an-table-wrap` is `overflow-x: hidden; overflow-y: auto; scrollbar-gutter: stable` so the vertical scrollbar reserves its own gutter and never covers the last column. Numeric columns carry the `num` class (fixed 60px); the `.an-grip` sits top-**left** (clear of right-aligned period/unit toggles) and `.an-block-head` has `padding-left` to clear it. `ht()` gained `B`/`T` tiers so billion-scale values fit the narrow fixed columns instead of rendering as thousands-of-`M`.

## 8. Quota Pacing (`src/web/pace.js`)

Every quota bar (Claude, Cursor, Antigravity) also answers *"how much may we still consume?"*. The model is a **flat budget over the window**: `100% / N units = X% per unit`, and the whole current unit's allowance is available as soon as it starts — day 3 of 7 → budget `3 × 14.3% = 42.9%`. Units are **days** for windows ≥ 2 days (weekly quotas, monthly billing cycles) and **hours** below that (the Claude 5 h session).

- `computePace({usedPct, windowSecs, remainingSecs})` → `{unit,count,label,perUnitPct,index,budgetPct,usedPct,spare,over,projectedPct,elapsedFrac}`, or **`null`** when the window length or the reset timing is unknown — callers must render no pace rather than guess. Elapsed is clamped into `[0, windowSecs]`, so a stale poll reporting `remainingSecs > windowSecs` reads as "nothing elapsed", never negative.
- `paceMarker(p)` is the tick on the track; `paceNote(p)` is the line under it (`day 3/7 · 14.3%/day · budget 43% · 26% still available`, red `.over` when `spare < 0`). **Every quota bar on the dashboard fills with USED %** (0 → 100 as you consume), so the tick sits at the budget with no mirroring — `cards-antigravity.js` flips agy's remaining-quota gauge (`usedPct = 100 − remainingPct`, `full` → 0) at the card, not in the collector.
- `.track` is `position: relative` so the absolutely-positioned `.pace-marker` sits on it; the marker is clamped to ≤ 99.4 % because `.track` is `overflow: hidden` and a tick at 100 % would be clipped away.
- Window lengths per source: Claude — constants at the call site (`5 * HOUR`, `7 * DAY`, incl. every discovered `seven_day_<model>`); Antigravity — `windowSecsFromLabel(lim.label)` ("Weekly" → 7 d) with `remainingSecs` from `parseDuration(lim.refresh)` (agy only gives the rendered `"101h 16m"` string; a `full` limit has no refresh string → no pace); Cursor — `monthlyCycle(subscriptionCycleStart)` walks the billing anniversary forward past now, giving the real cycle length (28–31 d) instead of assuming 30.
- `pace.js` is **pure and import-free on purpose**: the package is `type: commonjs`, so `test/pace.test.js` loads it by stripping `export` and evaluating the source. Adding an `import` to it breaks that loader — put anything needing other modules in the card renderers instead.
- Tests: `test/pace.test.js` (math + formatting + the card/CSS wiring contract). Note `test/cards-claude-quota.test.js` asserts `quotaBar(...)` call shapes — its regexes are intentionally left open-ended so the trailing `windowSecs` argument doesn't break them.

### Desktop pacing alerts (`src/web/notify.js`)

Opt-in browser notifications when a bar's usage reaches a share **of its pacing budget** (not of the quota): default **80%** = warning, **100%** = over budget. Settings: `PACE_ALERTS_ENABLED` (default `false`), `PACE_ALERT_WARN_PCT` (80), `PACE_ALERT_OVER_PCT` (100) — server-side in `src/settings.js` (`clampAlertPct`: positive, ≤ 500, else keep the previous value), edited in the settings modal's **Alerts** tab.

- Every quota bar registers itself: `trackPace(key, label, pace)` is called from `quotaBar()` (`cards-claude.js`) and from `usageBar()` whenever `paceOpts.key` is set. `usageBar`'s 6th argument is now the object `{ pace, key, alertLabel, invert }` — not positional pace/invert.
- **Dedupe is per `(key, level, unit stamp)`** — at most one warn + one over per bar per day (per hour for the 5 h session), re-armed when the window's unit advances (a new day raises the budget, so the alert means something again). An `over` alert also consumes that unit's `warn` slot so a jump past the budget doesn't ping twice.
- The stamp is **`round(resetTimeMs / unitMs) + ':' + index`**, *not* the day number — day 3 of next week must alert again, so the window's own reset time identifies the instance (bucketed by the unit so poll jitter can't change it). `computePace` returns `windowSecs`/`remainingSecs` for exactly this.
- **An alert is per event, so the state is mirrored to `localStorage` (`tok-pace-alerts`)** — reloading the dashboard must not replay notifications the user already saw. `store()` swallows the access throw (privacy modes) and falls back to memory-only dedupe. `trackPace(key, label, pace, now = Date.now())` takes an injectable clock for tests.
- Saving settings re-arms (`resetPaceAlerts()`) **only when the alert config actually changed** — an unrelated save (pricing, paths) must not replay alerts.
- Renderers repaint on every SSE tick **and** `clockTick` (1 s for the Claude card), so `trackPace` must stay idempotent — never make firing depend on render count.
- Cursor's **Total** bar passes `alert = false`: it is `max(auto, api)`, so the driving bar already alerts.
- Permission is requested from the settings checkbox / test button (**a user gesture** — browsers reject the prompt otherwise); an unchecked-back checkbox means the user denied it. `notify.js` never throws when `Notification` is absent (`notificationPermission()` → `'unsupported'`).
- Config reaches the notifier via `applyPaceAlertSettings()` in `src/web/settings.js` — at boot (`initSettingsAndPricing`, so alerts work without opening the modal), on modal open, and after save (which also calls `resetPaceAlerts()` so a lowered threshold fires on the current unit instead of waiting for the next one).
- Alerts fire from the dashboard tab, so the page must be open — the Alerts panel says so.
- Tests: `test/notify.test.js` (thresholds, dedupe/re-arm, next-window re-fire, reload-does-not-replay, missing `localStorage`, permission degradation, wiring contract — loads the module with a stubbed `globalThis.Notification` + `globalThis.localStorage`), `test/settings.test.js` (clamping/persistence), `test/settings-tabs.test.js` (the `alerts` tab/panel pair — its `TABS` list must include every tab).
