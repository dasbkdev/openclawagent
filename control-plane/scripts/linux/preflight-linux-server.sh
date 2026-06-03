#!/usr/bin/env bash
set -u

INSTALL_DIR="${INSTALL_DIR:-/opt/company-control-plane}"
CONFIG_DIR="${CONFIG_DIR:-/etc/company-control-plane}"
DATA_DIR="${DATA_DIR:-/var/lib/company-control-plane}"
API_PORT="${API_PORT:-3099}"
SERVICE_USER="${SERVICE_USER:-company-control-plane}"

CHECKS_FAILED=0
CHECKS_WARNED=0
CHECKS_TOTAL=0

add_check() {
  local status="$1"
  local name="$2"
  local details="${3:-}"

  CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
  case "$status" in
    PASS) printf '\033[32m[PASS]\033[0m %s\n' "$name" ;;
    WARN)
      CHECKS_WARNED=$((CHECKS_WARNED + 1))
      printf '\033[33m[WARN]\033[0m %s\n' "$name"
      ;;
    FAIL)
      CHECKS_FAILED=$((CHECKS_FAILED + 1))
      printf '\033[31m[FAIL]\033[0m %s\n' "$name"
      ;;
    *) printf '[%s] %s\n' "$status" "$name" ;;
  esac

  if [ -n "$details" ]; then
    printf '       %s\n' "$details"
  fi
}

bytes_to_gb() {
  awk -v bytes="$1" 'BEGIN { printf "%.1f GB", bytes / 1024 / 1024 / 1024 }'
}

echo
echo "Company Control Plane Linux Server Preflight"
echo "============================================"

if [ "$(id -u)" -eq 0 ]; then
  add_check PASS "Root privileges" "Running as root."
else
  add_check FAIL "Root privileges" "Run with sudo/root before installing systemd services."
fi

if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  add_check PASS "Linux distribution" "${PRETTY_NAME:-unknown}"
else
  add_check WARN "Linux distribution" "/etc/os-release not found."
fi

if command -v systemctl >/dev/null 2>&1; then
  add_check PASS "systemd" "$(systemctl --version | head -n 1)"
else
  add_check FAIL "systemd" "systemctl is required for the production Linux install."
fi

cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)"
if [ "$cpu_count" -ge 4 ] 2>/dev/null; then
  add_check PASS "CPU" "$cpu_count logical processors. Recommended target met."
elif [ "$cpu_count" -ge 2 ] 2>/dev/null; then
  add_check WARN "CPU" "$cpu_count logical processors. Pilot minimum met; 4+ recommended."
else
  add_check FAIL "CPU" "$cpu_count logical processors. Need at least 2."
fi

mem_kb="$(awk '/MemTotal/ { print $2 }' /proc/meminfo 2>/dev/null || echo 0)"
mem_bytes=$((mem_kb * 1024))
mem_gb="$(awk -v kb="$mem_kb" 'BEGIN { printf "%.1f", kb / 1024 / 1024 }')"
if awk -v gb="$mem_gb" 'BEGIN { exit !(gb >= 8) }'; then
  add_check PASS "RAM" "$(bytes_to_gb "$mem_bytes"). Recommended target met."
elif awk -v gb="$mem_gb" 'BEGIN { exit !(gb >= 4) }'; then
  add_check WARN "RAM" "$(bytes_to_gb "$mem_bytes"). Pilot minimum met; 8+ GB recommended."
else
  add_check FAIL "RAM" "$(bytes_to_gb "$mem_bytes"). Need at least 4 GB."
fi

disk_available_kb="$(df -Pk / 2>/dev/null | awk 'NR == 2 { print $4 }')"
disk_available_bytes=$((disk_available_kb * 1024))
disk_gb="$(awk -v kb="$disk_available_kb" 'BEGIN { printf "%.1f", kb / 1024 / 1024 }')"
if awk -v gb="$disk_gb" 'BEGIN { exit !(gb >= 100) }'; then
  add_check PASS "Disk" "/ has $(bytes_to_gb "$disk_available_bytes") free. Recommended target met."
elif awk -v gb="$disk_gb" 'BEGIN { exit !(gb >= 30) }'; then
  add_check WARN "Disk" "/ has $(bytes_to_gb "$disk_available_bytes") free. Pilot minimum met; 100+ GB recommended."
else
  add_check FAIL "Disk" "/ has $(bytes_to_gb "$disk_available_bytes") free. Need at least 30 GB."
fi

if command -v git >/dev/null 2>&1; then
  add_check PASS "Git" "$(git --version)"
else
  add_check WARN "Git" "Git is missing. Install it before cloning/updating the repository."
fi

if command -v node >/dev/null 2>&1; then
  node_path="$(command -v node)"
  node_version="$(node --version)"
  node_major="$(printf '%s' "$node_version" | sed -E 's/^v?([0-9]+).*/\1/')"
  if [ "$node_major" -lt 22 ] 2>/dev/null; then
    add_check FAIL "Node.js" "$node_version found. Need Node.js 22+."
  elif printf '%s' "$node_path" | grep -Eq '^/(home|root)/'; then
    add_check FAIL "Node.js" "$node_version at $node_path. Install Node.js system-wide for systemd."
  else
    add_check PASS "Node.js" "$node_version at $node_path"
  fi
else
  add_check FAIL "Node.js" "Node.js 22+ is required before installing."
fi

if command -v tailscale >/dev/null 2>&1; then
  add_check PASS "Tailscale" "$(tailscale version | head -n 1)"
else
  add_check WARN "Tailscale" "Tailscale CLI not found. Install and join the company tailnet."
fi

if command -v ss >/dev/null 2>&1; then
  if ss -ltn "( sport = :$API_PORT )" 2>/dev/null | grep -q ":$API_PORT"; then
    add_check WARN "API port $API_PORT" "Something is already listening on this port."
  else
    add_check PASS "API port $API_PORT" "Port is free."
  fi
else
  add_check WARN "API port $API_PORT" "Cannot check port because ss is missing."
fi

if id "$SERVICE_USER" >/dev/null 2>&1; then
  add_check PASS "Service user" "$SERVICE_USER exists."
else
  add_check WARN "Service user" "$SERVICE_USER will be created by installer."
fi

for dir in "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR"; do
  if [ -d "$dir" ]; then
    add_check PASS "Directory $dir" "Exists."
  else
    add_check WARN "Directory $dir" "Will be created by installer."
  fi
done

for service in company-control-plane-api.service company-control-plane-telegram-bot.service; do
  if systemctl list-unit-files "$service" >/dev/null 2>&1 && systemctl list-unit-files "$service" | grep -q "$service"; then
    state="$(systemctl is-enabled "$service" 2>/dev/null || true)"
    add_check PASS "systemd unit $service" "Installed; enabled state: ${state:-unknown}."
  else
    add_check WARN "systemd unit $service" "Not installed yet."
  fi
done

echo
echo "Summary: $CHECKS_FAILED failed, $CHECKS_WARNED warnings, $CHECKS_TOTAL total checks."

if [ "$CHECKS_FAILED" -gt 0 ]; then
  exit 1
fi

exit 0
