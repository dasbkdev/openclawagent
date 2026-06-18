#!/usr/bin/env bash
#
# Deploy control-plane from the git checkout on the server.
# Source of truth: /opt/starlab-repo (branch server). Runtime:
# /opt/company-control-plane. Syncs only git-tracked code dirs; never touches
# runtime data, secrets, or public/downloads installers.
#
# Health-gated: after restart it verifies both services are active and the API
# /health endpoint is ok; on failure it rolls the code back to the previous
# commit, restarts, and exits non-zero.
#
# Usage: bash /opt/company-control-plane/scripts/linux/deploy-from-git.sh
set -euo pipefail

REPO=/opt/starlab-repo
RUNTIME=/opt/company-control-plane
BROWSER_RUNTIME=/opt/starlab-browser-service
SERVICE_USER=company-control-plane
BRANCH="${DEPLOY_BRANCH:-server}"
HEALTH_URL="http://127.0.0.1:3099/health"

sync_code() {
  for dir in src test scripts; do
    rsync -a --delete "$REPO/control-plane/$dir/" "$RUNTIME/$dir/"
  done
  cp -f "$REPO/control-plane/package.json" "$RUNTIME/package.json"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$RUNTIME/src" "$RUNTIME/test" "$RUNTIME/scripts" "$RUNTIME/package.json"
  if [ -d "$REPO/control-plane/browser-service" ] && [ -d "$BROWSER_RUNTIME" ]; then
    rsync -a --delete --exclude node_modules "$REPO/control-plane/browser-service/src/" "$BROWSER_RUNTIME/src/"
    cp -f "$REPO/control-plane/browser-service/package.json" "$BROWSER_RUNTIME/package.json"
  fi
}

restart_services() {
  systemctl restart company-control-plane-api.service company-control-plane-telegram-bot.service
  if systemctl list-unit-files | grep -q starlab-browser-service; then
    systemctl restart starlab-browser-service.service || true
  fi
}

# 0 if both services are active AND /health returns ok:true (retried briefly).
check_health() {
  local attempt api bot
  for attempt in 1 2 3 4 5 6; do
    sleep 2
    api=$(systemctl is-active company-control-plane-api.service 2>/dev/null || true)
    bot=$(systemctl is-active company-control-plane-telegram-bot.service 2>/dev/null || true)
    if [ "$api" = "active" ] && [ "$bot" = "active" ]; then
      if curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null | grep -q '"ok":true'; then
        return 0
      fi
    fi
  done
  echo "    api=$api bot=$bot health=$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || echo 'unreachable')"
  return 1
}

echo "==> Fetching ${BRANCH}"
git -C "$REPO" fetch --depth 5 origin "$BRANCH"
OLD=$(git -C "$REPO" rev-parse HEAD)
OLD_SHORT=$(git -C "$REPO" rev-parse --short HEAD)
git -C "$REPO" reset --hard "origin/${BRANCH}"
NEW=$(git -C "$REPO" rev-parse --short HEAD)
echo "    ${OLD_SHORT} -> ${NEW}"

echo "==> Syncing control-plane + browser-service code"
sync_code

echo "==> Running tests"
cd "$RUNTIME"
TEST_OUT=$(npm test 2>&1 || true)
if ! grep -qE '^. (tests|pass|fail)' <<<"$TEST_OUT"; then
  echo "!! tests command failed — aborting (no restart, runtime unchanged)" >&2
  exit 1
fi
if grep -qE '^. fail [1-9]' <<<"$TEST_OUT"; then
  echo "!! TESTS FAILED — aborting deploy before restart (investigate)" >&2
  exit 1
fi

echo "==> Restarting services"
restart_services

echo "==> Health gate"
if check_health; then
  echo "    healthy"
  echo "==> Deployed ${NEW}"
  exit 0
fi

echo "!! HEALTH CHECK FAILED on ${NEW} — rolling back to ${OLD_SHORT}" >&2
git -C "$REPO" reset --hard "$OLD"
sync_code
restart_services
if check_health; then
  echo "!! Rolled back to ${OLD_SHORT}; service healthy again. Deploy of ${NEW} aborted." >&2
  exit 1
fi
echo "!! ROLLBACK ALSO UNHEALTHY — manual intervention required (api/bot down)." >&2
exit 2
