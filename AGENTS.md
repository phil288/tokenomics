# Tokenomics Agent Guide (`AGENTS.md`)

Welcome! This document is designed for AI coding agents (such as Claude Code, Antigravity, or other LLM-based assistants) working on the **Tokenomics** codebase. It outlines the project's architecture, patterns, constraints, and development guidelines.

---

## 1. Project Overview

**Tokenomics** is a lightweight, real-time dashboard that monitors token usage and cost savings from three AI development tools:
- **RTK (Rust Token Killer)**: Proxies and optimizes CLI interactions.
- **Caveman**: Ultra-compressed Claude Code communication mode.
- **Headroom**: Context optimization layer and proxy.

The application is structured as a **single-file backend** (`server.js`) and a **modular frontend** (`index.html`, `index.css`, `app.js`), keeping the codebase extremely lean, fast, and easy to modify.

---

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

---

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

---

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

---

## 5. Development & Verification Workflow

### Running Locally
- Run the server in development mode using Node's watch mode (restarts the server automatically when `server.js` changes):
  ```bash
  npm run dev
  ```
- Frontend modifications (`index.html`, `index.css`, `app.js`) are served directly from the disk. **Simply edit the files and refresh your browser** to see the changes.

### Environment Variables
For testing different scenarios, you can override settings:
- `PORT` (default: `3000`)
- `REFRESH_MS` (default: `10000`)
- `HISTORY_INTERVAL_MS` (default: `60000`)
- `HISTORY_MAX` (default: `5000`)
- `RTK_DATA_HOME` (forces a single RTK directory path)
