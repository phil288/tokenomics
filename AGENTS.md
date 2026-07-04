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
  - Spawns subprocesses and reads files on a timer (`REFRESH_MS`, default: `10000`) to collect tool data.
  - Records compact snapshots of historical data to `data/history.jsonl` every minute (`HISTORY_INTERVAL_MS`, default: `60000`), capped at `HISTORY_MAX` (default: `5000`) entries.
- **`index.html`**:
  - The HTML layout structure. Links to `/index.css` and loads `/web/main.js` as an ES module.
- **`index.css`**:
  - The styling system with a customized, clean theme stylesheet with dark, light, and automatic theme support.
- **`src/web/*.js`** — the client-side dashboard, split into ES modules (served by `server.js` under `/web/`):
  - `main.js` — entry point: wires the `/api/events` SSE stream to the renderers, owns the refresh countdown + live clock, and bootstraps every other module.
  - `cards.js` — per-card HTML renderers (RTK, Caveman, Cursor, Antigravity, Claude, Headroom, hero).
  - `charts.js` — the RTK daily bar chart and history trend lines (**Chart.js**, loaded from a CDN).
  - `pricing.js` — the client `PRICING` matrix and per-model cost/weight math.
  - `format.js` — pure formatting helpers (token/USD/time formatting).
  - `theme.js` — dark/light/auto theme switching. `layout.js` — free-drag card layout. `settings.js` — settings modal. `state.js` — shared mutable state.
- **`data/`** (gitignored):
  - Created at runtime to store the `history.jsonl` file.

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
Both `server.js` and `src/web/pricing.js` define pricing matrices for Claude, Gemini/Antigravity, and Cursor models:
- In `server.js`: `const PRICING` array defines model prefixes and token costs / cache multiplier values.
- In `src/web/pricing.js`: the exported `PRICING` array handles the representation on the client side.
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
- Since different launchers (like snaps) specify different `XDG_DATA_HOME` paths, `server.js` scans candidate shared directories (e.g. `~/.local/share`, `~/snap/code/<rev>/.local/share`), finds all active SQLite history databases, queries each individually using `rtk gain -g -a`, and merges the daily, weekly, and monthly totals dynamically.
- Pinned to a specific folder if `RTK_DATA_HOME` is set.

### 2. Caveman
- Reads `~/.claude/.caveman-active` to determine the active mode.
- Parses the JSON lines file `~/.claude/.caveman-history.jsonl` to calculate session counts, total output tokens, and estimated USD saved. Only the latest log entry per `session_id` is counted.

### 3. Headroom
- Headroom keeps **two** files (per its filesystem-contract); `collectHeadroom()` reads both:
  - **Savings ledger** — `~/.headroom/proxy_savings.json` (`HEADROOM_SAVINGS_PATH`). Authoritative source, matching what `headroom perf` reports: `lifetime.tokens_saved`, `lifetime.compression_savings_usd`, `lifetime.requests`, `display_session.savings_percent`. The Headroom card headline, the hero "Headroom" chip, and the history "saved" trend lines all come from here.
  - **Subscription state** — `~/.headroom/subscription_state.json` (`HEADROOM_SUBSCRIPTION_STATE_PATH`). Holds quota windows (`latest.five_hour` / `seven_day`, used by the Claude card) and raw `window_tokens` telemetry. ⚠️ `window_tokens` is **rolling per quota window and resets each window** — it is *usage telemetry, not savings*. Never treat `window_tokens.cache_reads` as a cumulative saving (old code did `cache_reads × 0.9`, producing a phantom sawtooth that did not match `headroom perf`).
- `collectHeadroom()` returns the subscription object with the savings ledger attached as `.savings`.
- Note: a reset **baseline** (see §6) is subtracted from `window_tokens` for *display* ("usage since reset"), but the underlying collector value is still the raw rolling telemetry — never build a saving out of it.

### 4. Cursor
- Queries the Connect RPC endpoint `https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` to fetch account quotas and billing cycles.
- Authenticates using the `cursorAuth/accessToken` JWT token extracted from Cursor's local SQLite store (`~/.config/Cursor/User/globalStorage/state.vscdb`) or the `CURSOR_ACCESS_TOKEN` environment variable.

### 5. Antigravity
- There is **no local usage file** for Antigravity — its only reliable usage source is the `agy` CLI's interactive `/usage` slash command (which only renders inside a real TUI; `agy --print/-i "/usage"` treats it as an agent prompt and does not work).
- `src/agy-usage.py` drives `agy` headlessly: it allocates a **PTY** via Python's `pty` module, sets a window size (bubbletea quits without one), waits for the TUI to settle, types `/usage`, captures the rendered panel, and prints it. `collectors.js` then strips ANSI and parses it (`parseAgyUsage`) into per-model-group quota (Gemini vs Claude+GPT; the gauge % is **remaining** quota). Limits are parsed **generically**: every "`<label> Limit`" section `agy` prints becomes an entry in the group's `limits[]` array (`{label, remainingPct, refresh, full}`), and the card renders exactly those bars. The set varies by tier — Starter Quota shows only a weekly limit; others may add a 5-hour or other window — so nothing is hardcoded and a phantom 0% bar can't appear.
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
- `REFRESH_MS` (default: `10000`)
- `HISTORY_INTERVAL_MS` (default: `60000`)
- `HISTORY_MAX` (default: `5000`)
- `ANTIGRAVITY_POLL_MS` (default: `300000` — how often the heavy `agy` `/usage` poll runs)
- `RTK_DATA_HOME` (forces a single RTK directory path)

## 6. Resetting Stats (Baseline Offset)

**The mental trap:** Tokenomics owns almost no numbers. RTK / Caveman / Headroom totals are read fresh from the tools' own ledgers (`rtk gain`, `.caveman-history.jsonl`, `proxy_savings.json`) on every 10 s refresh. So "reset" cannot mean "delete our stored value" — there is nothing of ours to delete, and anything we wipe repopulates on the next tick. The **only** honest, non-destructive reset is a **baseline offset**.

### How it works — `src/baseline.js`
- On **"Reset all stats"** (`POST /api/history/reset`) the server captures the current **absolute** readings (via `collectStatsRaw()`) into `data/baseline.json` and clears the trend history.
- `collectStats()` = `applyBaseline(await collectStatsRaw())`. Every reading is shown **minus** the baseline (clamped at ≥ 0), applied **once** server-side so the SSE stream, recorded history snapshots, and the activity feed all share one consistent offset view. The tools' ledgers are never touched → fully reversible via `DELETE /api/baseline` ("Restore absolute totals").
- The baseline persists to disk and reloads on boot (mirrors `history.js`).

### What is offset vs left alone
- **Offset (cumulative counters):** RTK `summary.total_saved/commands/input/output`; Caveman `total_saved_tokens/output_tokens/saved_usd/session_count`; Headroom `savings.lifetime.tokens_saved/compression_savings_usd/requests`.
- **Also offset (subtle, learned the hard way):**
  - **RTK daily chart buckets.** Trimming pre-reset days is not enough: RTK rolls up a whole day into one bucket, so the **reset-day** bucket already contains pre-reset activity and its bar stays full. The baseline snapshots that day's bucket *at reset time* and subtracts it, so the reset-day bar starts at zero and grows. Weekly/monthly arrays aren't charted → left intact.
  - **Headroom live window telemetry** (`window_tokens` top-level **and** `by_model`). Even though it "resets each window" on its own (see §4.3), users expect the on-screen "Raw vs weighted by model" / cost numbers to zero on reset too. Offsetting shows "usage since reset" within the current window and clamps to zero after a natural rollover — which reads as reset, so it's consistent. (This is **not** the old phantom-sawtooth bug: we are not inventing a saving, just shifting a display zero-point.)
- **Left alone (not cumulative counters):** percentages/ratios (`avg_savings_pct` is *recomputed* from the offset totals; `display_session.savings_percent` kept as-is), average exec time, and all quota-utilisation bars.

### The Activity tab (`/api/activity`) is offset separately
The activity feed is a **different endpoint**, not part of `collectStats()`, so `applyBaseline()` doesn't reach it — it needs its own pass, `applyActivityBaseline({ rows, rtk })`, called in the `/api/activity` handler. It's **event-based**, so "reset" means *only show events after the reset*:
- **Rows** are filtered to `ts >= baseline.t`. Rows with **no timestamp** can't be proven post-reset, so they're dropped while a baseline is active.
- The **whole-DB RTK gain/loss totals** (`collectRtkTotals()` → `{ gain, loss, net, gainCmds, lossCmds }`) are offset by their value at reset. Those are captured via `captureBaseline(rawStats, collectRtkTotals())` — passed **in** from `server.js` rather than imported, to avoid a `collectors.js ↔ baseline.js` require cycle — and stored on `baseline.rtkTotals`. `net` is recomputed from the offset `gain - loss`.

### Gotchas
- **Server-side offset ≠ what the browser shows.** The DOM only updates from SSE frames. After a reset the stream carries zeros immediately, but a stale tab / cached JS keeps showing old numbers — **hard-refresh** to confirm. Verify the truth with a raw frame: `curl -sN --max-time 4 localhost:3000/api/events`.
- **Baselines are versioned by their fields.** A baseline captured by an older build lacks `.rtk.day` / `.headroom.window`; `applyBaseline()` guards each sub-object so it still applies safely, but the newer surfaces (reset-day bar, window telemetry) won't zero until the user **resets again** to capture a richer baseline.
- `data/baseline.json` lives in the gitignored `data/` dir alongside `history.jsonl`.

### Tests
- `test/baseline.test.js` — capture/apply/clamp, reset-day bucket subtraction, window-telemetry offset, activity-feed offset (`applyActivityBaseline`), persistence.
- `test/server.test.js` — `POST /api/history/reset` writes the baseline + clears history; `DELETE /api/baseline` removes it.
- `test/settings-tabs.test.js` — the "Restore absolute totals" control exists in the Data tab and is wired to `DELETE /api/baseline`.
