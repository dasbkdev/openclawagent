#!/usr/bin/env bash
set -euo pipefail

CONTROL_PLANE_URL="${1:-https://starlabagent.pp.ua}"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
INSTALL_DIR="${INSTALL_DIR:-/Library/Application Support/StarlabOpenClawAgent}"
CONFIG_DIR="${HOME}/Library/Application Support/StarlabOpenClawAgent"
PLIST="${HOME}/Library/LaunchAgents/com.starlab.openclaw.agent.plist"

mkdir -p "${INSTALL_DIR}/src" "${CONFIG_DIR}" "${HOME}/Library/Logs/StarlabOpenClawAgent"
cp "${PROJECT_ROOT}/src/device-agent.js" "${INSTALL_DIR}/src/device-agent.js"
cp "${PROJECT_ROOT}/package.json" "${INSTALL_DIR}/package.json"

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "Starlab OpenClaw Agent" message "Node.js 22+ is required. Install Node.js first, then rerun installer."'
  exit 1
fi

ENV_FILE="${CONFIG_DIR}/device-agent.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  cat > "${ENV_FILE}" <<ENV
CONTROL_PLANE_URL=${CONTROL_PLANE_URL}
DEVICE_AGENT_INTERVAL_SECONDS=60
DEVICE_AGENT_CAPABILITIES=heartbeat,local-app
ENV
  chmod 0600 "${ENV_FILE}"
fi

cat > "${PLIST}" <<PLIST_XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.starlab.openclaw.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v node)</string>
    <string>${INSTALL_DIR}/src/device-agent.js</string>
    <string>--app</string>
    <string>--env-file</string>
    <string>${ENV_FILE}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${INSTALL_DIR}</string>
  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/StarlabOpenClawAgent/out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/StarlabOpenClawAgent/err.log</string>
</dict>
</plist>
PLIST_XML

launchctl unload "${PLIST}" >/dev/null 2>&1 || true
launchctl load "${PLIST}"
open "http://127.0.0.1:4157" || true

echo "Installed Starlab OpenClaw Agent."
echo "Local app: http://127.0.0.1:4157"
echo "LaunchAgent: ${PLIST}"
