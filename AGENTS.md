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

The application is structured as a **single-file backend** (`server.js`) and a **modular frontend** (`index.html`, `index.css`, `app.js`), keeping the codebase extremely lean, fast, and easy to modify.

## 2. Key Architecture & File Layout

- **`server.js`**:
  - Starts an HTTP server on the configured `PORT` (default: `3000`).
  - Implements a custom Server-Sent Events (SSE) server (`/api/events`) to stream real-time token statistics to the browser.
  - Spawns subprocesses and reads files on a timer (`REFRESH_MS`, default: `10000`) to collect tool data.
  - Records compact snapshots of historical data to `data/history.jsonl` every minute (`HISTORY_INTERVAL_MS`, default: `60000`), capped at `HISTORY_MAX` (default: `5000`) entries.
- **`index.html`**:
  - The HTML layout structure. Links to `/index.css` and `/app.js`.
- **`index.css`**:
  - The styling system with a customized, clean theme stylesheet with dark, light, and automatic theme support.
- **`app.js`**:
  - The client-side dashboard logic.
  - Subscribes to the `/api/events` SSE stream to receive live data updates.
  - Renders time-series trends (tokens saved, cost over time, quota utilization) using the **Chart.js** library loaded from a CDN.
- **`data/`** (gitignored):
  - Created at runtime to store the `history.jsonl` file.

## 3. Critical Constraints & Rules

When modifying or expanding Tokenomics, agents **must** adhere to the following rules:

### 🚫 Zero External Runtime Dependencies
The project prides itself on having **zero runtime dependencies** (other than Node.js built-ins).
- **Do NOT** add standard npm dependencies (e.g., `express`, `dotenv`, `axios`, `cors`) to `package.json`.
- All web operations, routing, SSE streaming, child process orchestration, and file reads must continue to use Node.js standard library APIs (`http`, `fs`, `path`, `child_process`, `os`).

### 🔄 Keep Cost & Model Lists in Sync
Both `server.js` and `app.js` define pricing matrices for Claude, Gemini/Antigravity, and Cursor models:
- In `server.js`: `const PRICING` array defines model prefixes and token costs / cache multiplier values.
- In `app.js`: `const PRICING` array handles the representation on the client side.
- **If you add a new model or update pricing, you must modify BOTH files to keep them perfectly in sync.**

### 🎨 Design & Visual Excellence
- The UI is designed to feel responsive, premium, and clean (using sleek gradients, card shadows, theme transitions, and progress bar animations).
- Avoid modifying the layout in a way that breaks responsiveness on smaller viewports.
- Keep the custom styled scrollbars, tooltip formats, and transitions intact.

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
- Reads and parses `~/.headroom/subscription_state.json`.

### 4. Cursor
- Queries the Connect RPC endpoint `https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` to fetch account quotas and billing cycles.
- Authenticates using the `cursorAuth/accessToken` JWT token extracted from Cursor's local SQLite store (`~/.config/Cursor/User/globalStorage/state.vscdb`) or the `CURSOR_ACCESS_TOKEN` environment variable.

## 5. Development & Verification Workflow

### Running Locally
- Run the server in development mode using Node's watch mode (restarts the server automatically when `server.js` changes):
  ```bash
  rtk npm run dev
  ```
- Frontend modifications (`index.html`, `index.css`, `app.js`) are served directly from the disk. **Simply edit the files and refresh your browser** to see the changes.

### Environment Variables
For testing different scenarios, you can override settings:
- `PORT` (default: `3000`)
- `REFRESH_MS` (default: `10000`)
- `HISTORY_INTERVAL_MS` (default: `60000`)
- `HISTORY_MAX` (default: `5000`)
- `RTK_DATA_HOME` (forces a single RTK directory path)
