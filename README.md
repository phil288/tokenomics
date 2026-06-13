# Tokenomics

Real-time browser dashboard for [RTK](https://github.com/rtk-ai/rtk), Caveman, and
Headroom token-savings stats — live updates over SSE, time-series history graphs,
per-model raw / real / saved **cost** tracking, and light / dark / auto themes.

Zero runtime dependencies (Node.js built-ins only). Charts via Chart.js CDN.

> ⚠️ **Supported Models.** Tokenomics supports Claude models (Anthropic), Gemini / Antigravity models (Google), and Cursor models. The cost math uses model-specific pricing and cache ratios. Other LLM providers (OpenAI / Codex, etc.) are **not** yet supported. If you'd like to use another provider, contributions are very welcome — see [Contributing](#contributing).

## Prerequisites

Tokenomics **reads the output** of three tools you install separately:

| Tool | Reads | Install |
|------|-------|---------|
| RTK (Rust Token Killer) | `rtk gain -g -a` | https://github.com/rtk-ai/rtk |
| Headroom | `~/.headroom/subscription_state.json` | `pipx install headroom-ai` |
| Caveman | `~/.claude/.caveman-active` + `.caveman-history.jsonl` | Claude Code plugin |

Any subset works — missing tools just show "No data" on their card.
Requires **Node.js ≥ 18**.

## Quick start

```bash
git clone https://github.com/<your-username>/tokenomics.git
cd tokenomics
node server.js          # then open http://localhost:3000
```

Or via npm:

```bash
npm start
```

## Development

Frontend changes (`index.html`, `index.css`, `app.js`) are served fresh on every request — just **refresh
the browser**, no restart. For backend changes (`server.js`), use watch mode (auto-
restarts on save):

```bash
systemctl --user stop tokenomics   # if running as a service, free the port
npm run dev                        # node --watch server.js
```

## Run as a service (Linux / systemd)

Run Tokenomics in the background so it survives logout and restarts on failure.

**1. Create the unit** (adjust `WorkingDirectory` and the `node` path to your setup):

```ini
# ~/.config/systemd/user/tokenomics.service
[Unit]
Description=Tokenomics Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/tokenomics
ExecStart=/usr/bin/env node %h/tokenomics/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

**2. Enable and start:**

```bash
systemctl --user daemon-reload
systemctl --user enable --now tokenomics.service
loginctl enable-linger "$USER"   # keep running without an active login
```

**3. Manage:**

```bash
systemctl --user status tokenomics      # check status
systemctl --user restart tokenomics     # restart
systemctl --user stop tokenomics        # stop
journalctl --user -u tokenomics -f      # tail logs
```

## Configuration

Tokenomics supports configuration via both environment variables (for server behavior) and an interactive settings dashboard panel in the browser.

### 1. Interactive UI Settings (⚙️)

Clicking the gear icon (⚙️) in the top-right corner of the dashboard allows you to configure settings on the fly. These are persisted locally to `data/settings.json` on the server:

- **Enable Cursor Stats**: Toggle the query and display of Cursor usage statistics.
- **Cursor Access Token**: Input a custom Cursor API access token or JWT. If left blank, Tokenomics automatically extracts the active session JWT from your local Cursor SQLite database (`~/.config/Cursor/User/globalStorage/state.vscdb`) or the `CURSOR_ACCESS_TOKEN` environment variable.
- **RTK Data Home**: Specify a custom directory path for RTK database aggregation.
- **Headroom Savings JSON Path**: Specify a custom path to Headroom's `subscription_state.json` file.
- **Dynamic Model Pricing**: View and customize the pricing matrix (USD per million tokens) and caching multipliers (Input, Output, Cache Reads, Cache Writes 5m, Cache Writes 1h) for any LLM prefix dynamically without restarting the server.

### 2. Environment Variables

Server-level configurations can be specified using environment variables (e.g. in your systemd service unit or shell):

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `3000` | HTTP port |
| `REFRESH_MS` | `10000` | live push / countdown interval (ms) |
| `HISTORY_INTERVAL_MS` | `60000` | history record cadence (ms) |
| `HISTORY_MAX` | `5000` | max retained history points (~3.5 days at 60s) |
| `RTK_DATA_HOME` | auto | pin RTK to a single data dir instead of aggregating all of them |

> **RTK across launchers:** RTK stores its DB under `$XDG_DATA_HOME/rtk`, and different
> launchers set `XDG_DATA_HOME` differently (a VSCode *snap* uses
> `~/snap/code/<rev>/.local/share`, a plain service has none → `~/.local/share`). So your
> usage can be split across several `history.db` files. Tokenomics finds **every** RTK
> database (deduped by real path), runs `rtk gain -g -a` against each, and **merges** the
> totals and daily/weekly/monthly breakdowns — so no project or launcher is missed. Set
> `RTK_DATA_HOME` to pin a single location instead.

## Data sources

| Card | Source |
|------|--------|
| RTK | `rtk gain -g -a`, merged across all discovered `history.db` files |
| Caveman | `~/.claude/.caveman-active` + `~/.claude/.caveman-history.jsonl` (latest per session) |
| Headroom | `~/.headroom/subscription_state.json` |

## History / graphs

The server records a compact snapshot every 60s to `data/history.jsonl` (per-tool
savings, per-model raw / weighted tokens, raw / real / saved cost in USD, quota %).
The dashboard's history charts draw line graphs over a selectable range (1h / 6h /
24h / all). The file is capped at the last 5000 points and is gitignored.

## Endpoints

| Route | Purpose |
|-------|---------|
| `GET /` | dashboard HTML |
| `GET /api/stats` | one-shot live snapshot |
| `GET /api/events` | SSE stream (push every `REFRESH_MS`) |
| `GET /api/history` | recorded time-series |

## How cost is computed

Per-model billable cost uses public per-million-token rates with the standard
Claude cache ratios (cache read ≈ 0.1× input, cache write ≈ 1.25×/2× input):

- **Raw** — every cache token billed at full input price (i.e. as if no caching)
- **Real** — the actual bill, with cache discounts applied
- **Saved** — `raw − real`, the money caching saved you

## Contributing

Contributions are welcome — especially **support for other LLM providers**.
Tokenomics was developed and tested with Claude only; adding OpenAI / Codex,
Gemini, or others mainly means extending the per-model pricing table and cache
ratios (in `server.js` and `app.js`) and confirming the corresponding tool
output is parsed correctly. Open an issue or PR.

## License

Licensed under the **Apache License 2.0** — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Tokenomics does not bundle or redistribute RTK, Headroom, or Caveman — it only
reads their public CLI output and on-disk state. Each tool remains under its own
license (Caveman: MIT · Headroom: Apache-2.0 · RTK: see its repo). Apache-2.0 was
chosen as the most attribution-preserving license compatible with all three.

## Credits

- **RTK (Rust Token Killer)** — token-optimizing CLI proxy
- **Headroom** — context optimization layer / proxy
- **Caveman** — ultra-compressed Claude Code communication mode
