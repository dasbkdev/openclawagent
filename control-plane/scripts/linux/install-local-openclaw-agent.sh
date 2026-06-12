#!/usr/bin/env bash
set -euo pipefail

CONTROL_PLANE_URL="${1:-https://starlabagent.pp.ua}"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
INSTALL_DIR="${INSTALL_DIR:-/opt/starlab-openclaw-agent}"
CONFIG_DIR="${CONFIG_DIR:-/etc/starlab-openclaw-agent}"
SERVICE_NAME="starlab-openclaw-agent"
RUN_USER="${SUDO_USER:-${USER}}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

mkdir -p "${INSTALL_DIR}/src" "${CONFIG_DIR}" "/var/log/starlab-openclaw-agent"
cp "${PROJECT_ROOT}/src/device-agent.js" "${INSTALL_DIR}/src/device-agent.js"
cp "${PROJECT_ROOT}/package.json" "${INSTALL_DIR}/package.json"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required. Install Node.js first, then rerun this script." >&2
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

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<SERVICE
[Unit]
Description=Starlab OpenClaw local employee agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${INSTALL_DIR}
Environment=DEVICE_AGENT_ENV_FILE=${ENV_FILE}
ExecStart=$(command -v node) ${INSTALL_DIR}/src/device-agent.js --app --env-file ${ENV_FILE}
Restart=always
RestartSec=10
StandardOutput=append:/var/log/starlab-openclaw-agent/out.log
StandardError=append:/var/log/starlab-openclaw-agent/err.log

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
systemctl restart "${SERVICE_NAME}.service"

echo "Installed Starlab OpenClaw Agent."
echo "Local app: http://127.0.0.1:4157"
echo "Service: ${SERVICE_NAME}.service"
