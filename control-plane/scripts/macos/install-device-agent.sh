#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL_DIR="${HOME}/Library/Application Support/CompanyControlPlaneAgent"
CONFIG_DIR="${INSTALL_DIR}/config"
LOG_DIR="${INSTALL_DIR}/logs"
NODE_DIR="${INSTALL_DIR}/node"
LABEL="com.company.control-plane.device-agent"
USER_PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
DAEMON_PLIST="/Library/LaunchDaemons/${LABEL}.plist"
PLIST="${USER_PLIST}"
CONTROL_PLANE_URL="https://starlabagent.pp.ua"
DEVICE_AGENT_ID=""
DEVICE_AGENT_USER_ID=""
DEVICE_AGENT_DISPLAY_NAME=""
DEVICE_AGENT_TOKEN=""
DEVICE_AGENT_INTERVAL_SECONDS="60"
DEVICE_AGENT_LABELS="{}"
DEVICE_AGENT_CAPABILITIES="heartbeat"
RUN_AS_DAEMON=0
START_NOW=0

usage() {
  cat <<EOF
Usage: ./scripts/macos/install-device-agent.sh [options]

Options:
  --source-root PATH
  --install-dir PATH
  --control-plane-url URL
  --device-id ID
  --user-id USER_ID
  --display-name NAME
  --token TOKEN
  --interval-seconds N
  --labels JSON
  --capabilities CSV
  --run-as-daemon
  --start-now
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root) SOURCE_ROOT="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --control-plane-url) CONTROL_PLANE_URL="$2"; shift 2 ;;
    --device-id) DEVICE_AGENT_ID="$2"; shift 2 ;;
    --user-id) DEVICE_AGENT_USER_ID="$2"; shift 2 ;;
    --display-name) DEVICE_AGENT_DISPLAY_NAME="$2"; shift 2 ;;
    --token) DEVICE_AGENT_TOKEN="$2"; shift 2 ;;
    --interval-seconds) DEVICE_AGENT_INTERVAL_SECONDS="$2"; shift 2 ;;
    --labels) DEVICE_AGENT_LABELS="$2"; shift 2 ;;
    --capabilities) DEVICE_AGENT_CAPABILITIES="$2"; shift 2 ;;
    --run-as-daemon) RUN_AS_DAEMON=1; shift ;;
    --start-now) START_NOW=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "${RUN_AS_DAEMON}" -eq 1 ]]; then
  PLIST="${DAEMON_PLIST}"
fi

CONFIG_DIR="${INSTALL_DIR}/config"
LOG_DIR="${INSTALL_DIR}/logs"
NODE_DIR="${INSTALL_DIR}/node"

if [[ -z "${DEVICE_AGENT_USER_ID}" ]]; then
  echo "--user-id is required" >&2
  exit 2
fi

if [[ -z "${DEVICE_AGENT_ID}" ]]; then
  HOST="$(hostname | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-')"
  DEVICE_AGENT_ID="${DEVICE_AGENT_USER_ID}-${HOST}"
fi

if [[ -z "${DEVICE_AGENT_DISPLAY_NAME}" ]]; then
  DEVICE_AGENT_DISPLAY_NAME="${DEVICE_AGENT_USER_ID} on $(hostname)"
fi

mkdir -p "${INSTALL_DIR}/src" "${CONFIG_DIR}" "${LOG_DIR}"
if [[ "${RUN_AS_DAEMON}" -eq 1 ]]; then
  sudo mkdir -p "/Library/LaunchDaemons"
else
  mkdir -p "${HOME}/Library/LaunchAgents"
fi
cp "${SOURCE_ROOT}/src/device-agent.js" "${INSTALL_DIR}/src/device-agent.js"
cp "${SOURCE_ROOT}/package.json" "${INSTALL_DIR}/package.json"

NODE_BIN="$(command -v node || true)"
if [[ -z "${NODE_BIN}" ]]; then
  ARCH="$(uname -m)"
  case "${ARCH}" in
    arm64) NODE_ARCH="arm64" ;;
    x86_64) NODE_ARCH="x64" ;;
    *) echo "Unsupported macOS architecture: ${ARCH}" >&2; exit 1 ;;
  esac
  NODE_VERSION="v22.22.3"
  NODE_TARBALL="node-${NODE_VERSION}-darwin-${NODE_ARCH}.tar.xz"
  NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}"
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${TMP_DIR}"' EXIT
  echo "Downloading portable Node.js ${NODE_VERSION} for ${NODE_ARCH}"
  curl -fsSL "${NODE_URL}" -o "${TMP_DIR}/${NODE_TARBALL}"
  rm -rf "${NODE_DIR}"
  mkdir -p "${NODE_DIR}"
  tar -xJf "${TMP_DIR}/${NODE_TARBALL}" -C "${NODE_DIR}" --strip-components 1
  NODE_BIN="${NODE_DIR}/bin/node"
fi

ENV_FILE="${CONFIG_DIR}/device-agent.env"
cat > "${ENV_FILE}" <<EOF
CONTROL_PLANE_URL=${CONTROL_PLANE_URL}
DEVICE_AGENT_ID=${DEVICE_AGENT_ID}
DEVICE_AGENT_USER_ID=${DEVICE_AGENT_USER_ID}
DEVICE_AGENT_DISPLAY_NAME=${DEVICE_AGENT_DISPLAY_NAME}
DEVICE_AGENT_TOKEN=${DEVICE_AGENT_TOKEN}
DEVICE_AGENT_INTERVAL_SECONDS=${DEVICE_AGENT_INTERVAL_SECONDS}
DEVICE_AGENT_LABELS=${DEVICE_AGENT_LABELS}
DEVICE_AGENT_CAPABILITIES=${DEVICE_AGENT_CAPABILITIES}
EOF
chmod 600 "${ENV_FILE}"

USER_NAME_BLOCK=""
if [[ "${RUN_AS_DAEMON}" -eq 1 ]]; then
  SERVICE_USER="$(id -un)"
  USER_NAME_BLOCK="  <key>UserName</key>
  <string>${SERVICE_USER}</string>"
fi

TMP_PLIST="$(mktemp)"
cat > "${TMP_PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
${USER_NAME_BLOCK}
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${INSTALL_DIR}/src/device-agent.js</string>
    <string>--env-file</string>
    <string>${ENV_FILE}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${INSTALL_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/device-agent.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/device-agent.err.log</string>
</dict>
</plist>
PLIST

if [[ "${RUN_AS_DAEMON}" -eq 1 ]]; then
  sudo cp "${TMP_PLIST}" "${PLIST}"
  sudo chown root:wheel "${PLIST}"
  sudo chmod 644 "${PLIST}"
else
  cp "${TMP_PLIST}" "${PLIST}"
fi
rm -f "${TMP_PLIST}"

if [[ "${START_NOW}" -eq 1 ]]; then
  if [[ "${RUN_AS_DAEMON}" -eq 1 ]]; then
    UID_VALUE="$(id -u)"
    launchctl bootout "gui/${UID_VALUE}" "${USER_PLIST}" >/dev/null 2>&1 || true
    rm -f "${USER_PLIST}"
    sudo launchctl bootout system "${PLIST}" >/dev/null 2>&1 || true
    sudo launchctl bootstrap system "${PLIST}"
    sudo launchctl enable "system/${LABEL}" >/dev/null 2>&1 || true
    sudo launchctl kickstart -k "system/${LABEL}" >/dev/null 2>&1 || true
  else
    UID_VALUE="$(id -u)"
    launchctl bootout "gui/${UID_VALUE}" "${PLIST}" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/${UID_VALUE}" "${PLIST}"
    launchctl enable "gui/${UID_VALUE}/${LABEL}" >/dev/null 2>&1 || true
    launchctl kickstart -k "gui/${UID_VALUE}/${LABEL}" >/dev/null 2>&1 || true
  fi
fi

echo "Installed device agent:"
echo "  ${PLIST}"
echo "  ${ENV_FILE}"
