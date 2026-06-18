#!/bin/sh
# Tokenomics installer — clone, verify, and run the dashboard.
#
#   curl -fsSL https://raw.githubusercontent.com/phil288/tokenomics/main/install.sh | sh
#
# Environment overrides:
#   TOKENOMICS_DIR   install location          (default: $HOME/tokenomics)
#   TOKENOMICS_REPO  git URL to clone          (default: https://github.com/phil288/tokenomics.git)
#   PORT             port to serve on          (default: 3000)
#   SERVICE=1        install+start a systemd --user service instead of running in foreground
#   START=0          clone/update only, do not start anything

set -eu

REPO="${TOKENOMICS_REPO:-https://github.com/phil288/tokenomics.git}"
DIR="${TOKENOMICS_DIR:-$HOME/tokenomics}"
PORT="${PORT:-3000}"
START="${START:-1}"
SERVICE="${SERVICE:-0}"

info() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

# --- prerequisites -----------------------------------------------------------
command -v git  >/dev/null 2>&1 || die "git not found. Install git and re-run."
command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node.js >= 18 and re-run."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 18 ] 2>/dev/null || die "Node.js >= 18 required (found $(node -v 2>/dev/null || echo none))."

# --- fetch source ------------------------------------------------------------
if [ -d "$DIR/.git" ]; then
  info "Updating existing checkout at $DIR"
  git -C "$DIR" pull --ff-only
else
  [ -e "$DIR" ] && die "$DIR exists but is not a git checkout. Move it or set TOKENOMICS_DIR."
  info "Cloning $REPO -> $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

info "Tokenomics installed at $DIR"

# --- run ---------------------------------------------------------------------
if [ "$START" = "0" ]; then
  info "Skipping start (START=0). Run it with:  PORT=$PORT node \"$DIR/server.js\""
  exit 0
fi

if [ "$SERVICE" = "1" ]; then
  command -v systemctl >/dev/null 2>&1 || die "systemctl not found; cannot install service. Re-run without SERVICE=1."
  UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  mkdir -p "$UNIT_DIR"
  NODE_BIN="$(command -v node)"
  cat > "$UNIT_DIR/tokenomics.service" <<EOF
[Unit]
Description=Tokenomics Dashboard
After=network.target

[Service]
Type=simple
Environment=PORT=$PORT
WorkingDirectory=$DIR
ExecStart=$NODE_BIN $DIR/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now tokenomics.service
  loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || warn "could not enable linger; service stops on logout."
  info "Service running. Dashboard: http://localhost:$PORT"
  info "Manage:  systemctl --user status|restart|stop tokenomics"
  exit 0
fi

info "Starting Tokenomics on http://localhost:$PORT  (Ctrl-C to stop)"
cd "$DIR"
exec env PORT="$PORT" node server.js
