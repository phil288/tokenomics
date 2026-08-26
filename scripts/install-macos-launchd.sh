#!/bin/zsh
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer only supports macOS launchd. Use your OS service manager instead." >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

TOKENOMICS_SRC="$(cd "$(dirname "$0")/.." && pwd)"
TOKENOMICS_DIR="${TOKENOMICS_DIR:-/Users/Shared/tokenomics}"
TOKENOMICS_DATA_DIR="${TOKENOMICS_DATA_DIR:-/Users/Shared/tokenomics-data}"
TOKENOMICS_HOMES="${TOKENOMICS_HOMES:-/Users/username1,/Users/username2}"
PORT="${PORT:-8788}"
NODE_BIN="${NODE_BIN:-/usr/bin/env node}"
PLIST="/Library/LaunchDaemons/com.tokenomics.dashboard.plist"

mkdir -p "${TOKENOMICS_DIR}" "${TOKENOMICS_DATA_DIR}"

rsync -a --delete \
  --exclude '.git' \
  --exclude 'data' \
  "${TOKENOMICS_SRC}/" "${TOKENOMICS_DIR}/"

chown -R root:wheel "${TOKENOMICS_DIR}" "${TOKENOMICS_DATA_DIR}"
chmod -R a+rX "${TOKENOMICS_DIR}" "${TOKENOMICS_DATA_DIR}"
chmod 700 "${TOKENOMICS_DATA_DIR}"

node_cmd=("${(@s: :)NODE_BIN}")
cat > "${PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.tokenomics.dashboard</string>

  <key>ProgramArguments</key>
  <array>
EOF

for arg in "${node_cmd[@]}"; do
  print "    <string>${arg}</string>" >> "${PLIST}"
done

cat >> "${PLIST}" <<EOF
    <string>${TOKENOMICS_DIR}/server.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${TOKENOMICS_DIR}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>/Users/Shared</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PORT</key>
    <string>${PORT}</string>
    <key>TOKENOMICS_HOMES</key>
    <string>${TOKENOMICS_HOMES}</string>
    <key>TOKENOMICS_DATA_DIR</key>
    <string>${TOKENOMICS_DATA_DIR}</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${TOKENOMICS_DATA_DIR}/tokenomics.log</string>
  <key>StandardErrorPath</key>
  <string>${TOKENOMICS_DATA_DIR}/tokenomics.err.log</string>
</dict>
</plist>
EOF

chown root:wheel "${PLIST}"
chmod 0644 "${PLIST}"

launchctl bootout system "${PLIST}" >/dev/null 2>&1 || true
launchctl bootstrap system "${PLIST}"
launchctl enable system/com.tokenomics.dashboard
launchctl kickstart -k system/com.tokenomics.dashboard

echo "Tokenomics service installed: http://localhost:${PORT}"
echo "Homes: ${TOKENOMICS_HOMES}"
