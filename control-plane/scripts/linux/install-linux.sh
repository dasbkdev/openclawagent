#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INSTALL_DIR="/opt/company-control-plane"
CONFIG_DIR="/etc/company-control-plane"
DATA_DIR="/var/lib/company-control-plane"
SERVICE_USER="company-control-plane"
HOST_VALUE="127.0.0.1"
PORT_VALUE="3099"
INSTALL_BOT=1
START_NOW=0
NODE_BIN=""

usage() {
  cat <<EOF
Usage: sudo ./scripts/linux/install-linux.sh [options]

Options:
  --source-root PATH     Source directory to install from. Default: current control-plane checkout.
  --install-dir PATH     Install directory. Default: /opt/company-control-plane
  --config-dir PATH      Config directory. Default: /etc/company-control-plane
  --data-dir PATH        Runtime data directory. Default: /var/lib/company-control-plane
  --user NAME            Service user. Default: company-control-plane
  --host HOST            API bind host. Default: 127.0.0.1
  --port PORT            API port. Default: 3099
  --no-bot               Do not install Telegram bot systemd service.
  --start-now            Start services after install.
  -h, --help             Show help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source-root) SOURCE_ROOT="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --user) SERVICE_USER="$2"; shift 2 ;;
    --host) HOST_VALUE="$2"; shift 2 ;;
    --port) PORT_VALUE="$2"; shift 2 ;;
    --no-bot) INSTALL_BOT=0; shift ;;
    --start-now) START_NOW=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run this installer as root, for example with sudo." >&2
    exit 1
  fi
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required." >&2
    exit 1
  fi
}

require_node() {
  require_command node
  local node_version node_major
  NODE_BIN="$(command -v node)"
  node_version="$(node --version)"
  node_major="$(printf '%s' "$node_version" | sed -E 's/^v?([0-9]+).*/\1/')"
  if [ "$node_major" -lt 22 ] 2>/dev/null; then
    echo "Node.js 22+ is required. Found: $node_version" >&2
    exit 1
  fi

  case "$NODE_BIN" in
    /home/*|/root/*)
      echo "Node.js must be installed system-wide for systemd. Found: $NODE_BIN" >&2
      exit 1
      ;;
  esac
}

create_service_user() {
  if id "$SERVICE_USER" >/dev/null 2>&1; then
    return
  fi

  local nologin="/usr/sbin/nologin"
  if [ ! -x "$nologin" ]; then
    nologin="/sbin/nologin"
  fi

  useradd \
    --system \
    --home-dir "$DATA_DIR" \
    --create-home \
    --shell "$nologin" \
    "$SERVICE_USER"
}

copy_app_files() {
  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"

  tar \
    --exclude='./.git' \
    --exclude='./data' \
    --exclude='./dist' \
    --exclude='./node_modules' \
    --exclude='./test' \
    -C "$SOURCE_ROOT" \
    -cf - . | tar -C "$INSTALL_DIR" -xf -

  chown -R root:root "$INSTALL_DIR"
  chmod -R a+rX "$INSTALL_DIR"
}

write_env_file() {
  mkdir -p "$CONFIG_DIR" "$DATA_DIR"
  chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
  chmod 750 "$DATA_DIR"

  local env_file="$CONFIG_DIR/control-plane.env"
  if [ ! -f "$env_file" ]; then
    cat > "$env_file" <<EOF
# Company Control Plane Linux configuration.
# Store secrets through the setup wizard, not in this file.

NODE_ENV=production
HOST=$HOST_VALUE
PORT=$PORT_VALUE

BOOTSTRAP_OWNER_TELEGRAM_ID=dev-nikolay
TOKEN_USAGE_REPORT_TELEGRAM_ID=984834133
METRICON_BASE_URL=http://85.239.49.208:8080

CONTROL_PLANE_DATA_FILE=$DATA_DIR/control-plane.json
CONTROL_PLANE_CONFIG_DIR=$DATA_DIR

ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6
OPENCLAW_DEFAULT_MODEL=anthropic/claude-sonnet-4-6
EOF
    chmod 640 "$env_file"
  fi

  chown -R root:"$SERVICE_USER" "$CONFIG_DIR"
}

write_systemd_unit() {
  local unit_name="$1"
  local script_path="$2"

  cat > "/etc/systemd/system/$unit_name" <<EOF
[Unit]
Description=Company Control Plane ${unit_name}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$CONFIG_DIR/control-plane.env
ExecStart=$NODE_BIN $script_path
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
}

enable_services() {
  systemctl daemon-reload
  systemctl enable company-control-plane-api.service

  if [ "$INSTALL_BOT" -eq 1 ]; then
    systemctl enable company-control-plane-telegram-bot.service
  fi
}

start_services() {
  systemctl restart company-control-plane-api.service

  if [ "$INSTALL_BOT" -eq 1 ]; then
    systemctl restart company-control-plane-telegram-bot.service
  fi
}

require_root
require_command tar
require_command systemctl
require_node

SOURCE_ROOT="$(cd "$SOURCE_ROOT" && pwd)"

echo "Installing Company Control Plane for Linux"
echo "Source: $SOURCE_ROOT"
echo "InstallDir: $INSTALL_DIR"
echo "ConfigDir: $CONFIG_DIR"
echo "DataDir: $DATA_DIR"
echo "Service user: $SERVICE_USER"

create_service_user
copy_app_files
write_env_file

write_systemd_unit \
  "company-control-plane-api.service" \
  "$INSTALL_DIR/src/server.js"

if [ "$INSTALL_BOT" -eq 1 ]; then
  write_systemd_unit \
    "company-control-plane-telegram-bot.service" \
    "$INSTALL_DIR/src/telegram-bot.js"
else
  rm -f /etc/systemd/system/company-control-plane-telegram-bot.service
fi

enable_services

if [ "$START_NOW" -eq 1 ]; then
  start_services
fi

echo
echo "Install complete."
echo "Environment file: $CONFIG_DIR/control-plane.env"
echo "Runtime data: $DATA_DIR"
echo "API service: company-control-plane-api.service"
if [ "$INSTALL_BOT" -eq 1 ]; then
  echo "Telegram service: company-control-plane-telegram-bot.service"
fi
echo
echo "Setup wizard:"
echo "  http://127.0.0.1:$PORT_VALUE/setup"
echo
echo "If using SSH, open the setup wizard through a tunnel:"
echo "  ssh -L $PORT_VALUE:127.0.0.1:$PORT_VALUE <user>@<server-ip>"
