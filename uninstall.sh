#!/bin/sh
# Tokenomics uninstaller — stop the service and remove it.
#
#   curl -fsSL https://raw.githubusercontent.com/phil288/tokenomics/main/uninstall.sh | sh
#
# Environment overrides:
#   TOKENOMICS_DIR   install location to remove   (default: $HOME/tokenomics)
#   PURGE=1          also delete the checkout dir without prompting
#   KEEP_FILES=1     keep the checkout dir, remove only the service

set -eu

DIR="${TOKENOMICS_DIR:-$HOME/tokenomics}"
PURGE="${PURGE:-0}"
KEEP_FILES="${KEEP_FILES:-0}"

info() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$1" >&2; }

# --- remove the systemd service ---------------------------------------------
if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  if systemctl --user list-unit-files tokenomics.service >/dev/null 2>&1; then
    info "Stopping and disabling tokenomics.service"
    systemctl --user disable --now tokenomics.service >/dev/null 2>&1 || true
  fi
  if [ -f "$UNIT_DIR/tokenomics.service" ]; then
    rm -f "$UNIT_DIR/tokenomics.service"
    systemctl --user daemon-reload
    info "Removed $UNIT_DIR/tokenomics.service"
  else
    info "No service unit found; nothing to remove."
  fi
else
  warn "systemd --user unavailable; skipping service removal."
fi

# --- remove the checkout -----------------------------------------------------
if [ "$KEEP_FILES" = "1" ]; then
  info "Keeping files at $DIR (KEEP_FILES=1)."
  exit 0
fi

if [ ! -d "$DIR" ]; then
  info "No checkout at $DIR; done."
  exit 0
fi

if [ "$PURGE" != "1" ]; then
  if [ -r /dev/tty ]; then
    printf 'Delete %s and all its data? [y/N] ' "$DIR" > /dev/tty
    read ANS < /dev/tty || ANS=""
    case "$ANS" in
      y|Y|yes|YES) ;;
      *) info "Kept $DIR. Done."; exit 0 ;;
    esac
  else
    info "Kept $DIR (no terminal to confirm). Re-run with PURGE=1 to delete it."
    exit 0
  fi
fi

rm -rf "$DIR"
info "Removed $DIR. Tokenomics uninstalled."
