#!/usr/bin/env bash
#
# Rotate the control-plane infrastructure tokens in one place, atomically.
#
# Managed tokens (random server-side secrets, NOT user API keys):
#   INTERNAL_API_TOKEN      — gate on internal /api/v1/* calls (X-Internal-Token)
#   AUTOMATION_API_TOKEN    — n8n automation endpoints (X-Automation-Token)
#   BROWSER_SERVICE_TOKEN   — control-plane → browser-service auth (X-Browser-Token)
#
# User API keys (Claude, Google, Metricon, Platrum, ElevenLabs) live in the
# encrypted /setup secret store and are NOT touched here — rotate those via the
# setup wizard.
#
# Usage: bash /opt/company-control-plane/scripts/linux/rotate-tokens.sh [name...]
#   No args  -> rotate all managed tokens.
#   Names    -> rotate only the listed tokens (e.g. INTERNAL_API_TOKEN).
set -euo pipefail

ENV_FILE=/etc/company-control-plane/control-plane.env
BROWSER_UNIT=/etc/systemd/system/starlab-browser-service.service
TS=$(date +%Y%m%d-%H%M%S)

ALL=(INTERNAL_API_TOKEN AUTOMATION_API_TOKEN BROWSER_SERVICE_TOKEN)
TARGETS=("$@")
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=("${ALL[@]}")

cp "$ENV_FILE" "$ENV_FILE.bak-$TS"
[ -f "$BROWSER_UNIT" ] && cp "$BROWSER_UNIT" "$BROWSER_UNIT.bak-$TS"
echo "==> Backup: $ENV_FILE.bak-$TS"

set_env_var() {
  local name="$1" value="$2"
  if grep -qE "^${name}=" "$ENV_FILE"; then
    sed -i "s|^${name}=.*|${name}=${value}|" "$ENV_FILE"
  else
    echo "${name}=${value}" >> "$ENV_FILE"
  fi
}

reload_browser=0
for name in "${TARGETS[@]}"; do
  case "$name" in
    BROWSER_SERVICE_TOKEN) new=$(openssl rand -hex 24) ;;
    *) new=$(openssl rand -hex 32) ;;
  esac
  set_env_var "$name" "$new"
  echo "    rotated $name"
  if [ "$name" = "BROWSER_SERVICE_TOKEN" ] && [ -f "$BROWSER_UNIT" ]; then
    sed -i "s|^Environment=BROWSER_SERVICE_TOKEN=.*|Environment=BROWSER_SERVICE_TOKEN=${new}|" "$BROWSER_UNIT"
    reload_browser=1
  fi
done

chmod 600 "$ENV_FILE"

echo "==> Restarting consumers"
if [ "$reload_browser" = "1" ]; then
  systemctl daemon-reload
  systemctl restart starlab-browser-service.service || true
fi
systemctl restart company-control-plane-api.service company-control-plane-telegram-bot.service
sleep 4

echo "==> Health"
for svc in company-control-plane-api company-control-plane-telegram-bot starlab-browser-service; do
  if systemctl list-unit-files | grep -q "$svc"; then
    printf '%s: %s\n' "$svc" "$(systemctl is-active "$svc".service)"
  fi
done
echo "==> Token rotation complete ($TS). Old env backed up; remove .bak files once verified."
