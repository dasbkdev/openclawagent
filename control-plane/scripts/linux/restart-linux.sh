#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root, for example with sudo." >&2
  exit 1
fi

systemctl daemon-reload
systemctl restart company-control-plane-api.service

if systemctl list-unit-files company-control-plane-telegram-bot.service >/dev/null 2>&1 &&
  systemctl list-unit-files company-control-plane-telegram-bot.service | grep -q company-control-plane-telegram-bot.service; then
  systemctl restart company-control-plane-telegram-bot.service
fi

systemctl --no-pager --full status company-control-plane-api.service || true
systemctl --no-pager --full status company-control-plane-telegram-bot.service || true
