# LLM Token Monitor

Real-time browser dashboard for [RTK](https://github.com/rtk-ai/rtk), Caveman, and
Headroom token-savings stats — live updates over SSE, time-series history graphs,
per-model raw/real/saved **cost** tracking, and light/dark/auto themes.

Zero runtime dependencies (Node.js built-ins only). Charts via Chart.js CDN.

## Prerequisites

The dashboard **reads the output** of three tools you install separately:

| Tool | Provides | Install |
|------|----------|---------|
| RTK (Rust Token Killer) | `rtk gain -f json -a` | see https://github.com/rtk-ai/rtk |
| Headroom | `~/.headroom/subscription_state.json` | `pipx install headroom-ai` |
| Caveman | `~/.claude/.caveman-active` + `.caveman-history.jsonl` | Claude Code plugin |

Any subset works — missing tools just show "No data" on their card.
Requires **Node.js ≥ 18**.

## Run once (test)

```bash
node server.js          # then open http://localhost:3000
```

## Install as systemd user service

**1. Create the service file:**

```bash
cat > ~/.config/systemd/user/llm-token-monitor.service << 'EOF'
[Unit]
Description=LLM Token Monitoring Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/phil/dev/personal/llm-token-monitoring
ExecStart=/home/phil/.nvm/versions/node/v26.3.0/bin/node /home/phil/dev/personal/llm-token-monitoring/server.js
Restart=on-failure
RestartSec=5
Environment=HOME=/home/phil
Environment=PATH=/home/phil/.local/bin:/home/phil/.nvm/versions/node/v26.3.0/bin:/usr/local/bin:/usr/bin:/bin
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF
```

**2. Enable and start:**

```bash
systemctl --user daemon-reload
systemctl --user enable llm-token-monitor.service
systemctl --user start llm-token-monitor.service
```

**3. Keep running after logout (optional):**

```bash
loginctl enable-linger phil
```

## Manage

```bash
systemctl --user status llm-token-monitor   # check status
systemctl --user restart llm-token-monitor  # restart
systemctl --user stop llm-token-monitor     # stop
journalctl --user -u llm-token-monitor -f   # tail logs
```

## Data sources

| Card | Source |
|------|--------|
| RTK | `rtk gain -f json -a` |
| Caveman | `~/.claude/.caveman-active` + `~/.claude/.caveman-history.jsonl` |
| Headroom | `~/.headroom/subscription_state.json` |

## History / graphs

The server records a compact snapshot every 60s to `data/history.jsonl` (per-tool
savings, per-model raw/weighted tokens, raw/real/saved cost in USD, quota %). The
dashboard's **History** section draws line charts over a selectable range (1h/6h/24h/all).

- Endpoint: `GET /api/history` → array of snapshot rows
- File is capped at the last 5000 points (~3.5 days) and is gitignored.

## Endpoints

| Route | Purpose |
|-------|---------|
| `GET /` | dashboard HTML |
| `GET /api/stats` | one-shot live snapshot |
| `GET /api/events` | SSE stream (push every `REFRESH_MS`) |
| `GET /api/history` | recorded time-series |

## Environment variables

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `3000` | HTTP port |
| `REFRESH_MS` | `10000` | live push / countdown interval |
| `HISTORY_INTERVAL_MS` | `60000` | history record cadence |
| `HISTORY_MAX` | `5000` | max retained history points |

## License

Licensed under the **Apache License 2.0** — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

This project does not bundle or redistribute RTK, Headroom, or Caveman — it only
reads their public CLI output and on-disk state. Each tool remains under its own
license (Caveman: MIT · Headroom: Apache-2.0 · RTK: see its repo). Apache-2.0 was
chosen as the most attribution-preserving license compatible with all three.

## Credits

- **RTK (Rust Token Killer)** — token-optimizing CLI proxy
- **Headroom** — context optimization layer / proxy
- **Caveman** — ultra-compressed Claude Code communication mode
