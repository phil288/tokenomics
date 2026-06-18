#!/bin/sh
# Tokenomics installer — clone, verify, and run the dashboard.
#
#   curl -fsSL https://raw.githubusercontent.com/phil288/tokenomics/main/install.sh | sh
#
# Installs a systemd --user service so the dashboard auto-starts and survives
# reboots. Requires systemd.
#
# Environment overrides:
#   TOKENOMICS_DIR   install location          (default: $HOME/tokenomics)
#   TOKENOMICS_REPO  git URL to clone          (default: https://github.com/phil288/tokenomics.git)
#   PORT             port to serve on          (default: 3000)
#   START=0          clone/update only, do not install the service

set -eu

REPO="${TOKENOMICS_REPO:-https://github.com/phil288/tokenomics.git}"
DIR="${TOKENOMICS_DIR:-$HOME/tokenomics}"
PORT="${PORT:-3000}"
START="${START:-1}"

info() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

# Exit 0 if a TCP port is free to bind, 1 if already in use.
port_free() {
  node -e 'const s=require("net").createServer();s.once("error",e=>process.exit(e.code==="EADDRINUSE"?1:2));s.once("listening",()=>s.close(()=>process.exit(0)));s.listen(Number(process.argv[1]),"0.0.0.0")' "$1"
}

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

# Resolve a free port, prompting the user when the chosen one is taken.
while ! port_free "$PORT"; do
  warn "Port $PORT is already in use."
  [ -r /dev/tty ] || die "No terminal to prompt. Re-run with PORT=<free port>."
  printf 'Enter a different port: ' > /dev/tty
  read NEWPORT < /dev/tty || die "No port entered."
  case "$NEWPORT" in
    ''|*[!0-9]*) warn "Not a number." ;;
    *) [ "$NEWPORT" -ge 1 ] && [ "$NEWPORT" -le 65535 ] && PORT="$NEWPORT" || warn "Port out of range." ;;
  esac
done

# Install + start a systemd --user service (auto-start, reboot-safe).
command -v systemctl >/dev/null 2>&1 || die "systemctl not found; this installer requires systemd."
systemctl --user show-environment >/dev/null 2>&1 || die "systemd --user instance unavailable; cannot install the service."

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
