#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/company-control-plane}"
CONFIG_DIR="${CONFIG_DIR:-/etc/company-control-plane}"
DATA_DIR="${DATA_DIR:-/var/lib/company-control-plane}"
SERVICE_USER="${SERVICE_USER:-company-control-plane}"
REMOVE_DATA=0
REMOVE_USER=0

usage() {
  cat <<EOF
Usage: sudo ./scripts/linux/uninstall-linux.sh [options]

Options:
  --remove-data   Remove runtime data and config directories.
  --remove-user   Remove the service user after uninstall.
  -h, --help      Show help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --remove-data) REMOVE_DATA=1; shift ;;
    --remove-user) REMOVE_USER=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root, for example with sudo." >&2
  exit 1
fi

for service in company-control-plane-telegram-bot.service company-control-plane-api.service; do
  if systemctl list-unit-files "$service" >/dev/null 2>&1 &&
    systemctl list-unit-files "$service" | grep -q "$service"; then
    systemctl stop "$service" || true
    systemctl disable "$service" || true
  fi
  rm -f "/etc/systemd/system/$service"
done

systemctl daemon-reload

if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
fi

if [ "$REMOVE_DATA" -eq 1 ]; then
  if [ -d "$CONFIG_DIR" ]; then
    rm -rf "$CONFIG_DIR"
  fi
  if [ -d "$DATA_DIR" ]; then
    rm -rf "$DATA_DIR"
  fi
else
  echo "Preserved config directory: $CONFIG_DIR"
  echo "Preserved data directory: $DATA_DIR"
fi

if [ "$REMOVE_USER" -eq 1 ] && id "$SERVICE_USER" >/dev/null 2>&1; then
  userdel "$SERVICE_USER" || true
fi

echo "Uninstall complete."
