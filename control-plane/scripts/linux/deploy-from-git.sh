#!/usr/bin/env bash
#
# Deploy control-plane from the git checkout on the server.
# Source of truth: /opt/starlab-repo (branch server). Runtime:
# /opt/company-control-plane. Syncs only git-tracked code dirs; never touches
# runtime data, secrets, or public/downloads installers.
#
# Usage: bash /opt/company-control-plane/scripts/linux/deploy-from-git.sh
set -euo pipefail

REPO=/opt/starlab-repo
RUNTIME=/opt/company-control-plane
BROWSER_RUNTIME=/opt/starlab-browser-service
SERVICE_USER=company-control-plane
BRANCH="${DEPLOY_BRANCH:-server}"

echo "==> Fetching ${BRANCH}"
git -C "$REPO" fetch --depth 5 origin "$BRANCH"
OLD=$(git -C "$REPO" rev-parse --short HEAD)
git -C "$REPO" reset --hard "origin/${BRANCH}"
NEW=$(git -C "$REPO" rev-parse --short HEAD)
echo "    ${OLD} -> ${NEW}"

echo "==> Syncing control-plane code"
for dir in src test scripts; do
  rsync -a --delete "$REPO/control-plane/$dir/" "$RUNTIME/$dir/"
done
cp -f "$REPO/control-plane/package.json" "$RUNTIME/package.json"
chown -R "$SERVICE_USER:$SERVICE_USER" "$RUNTIME/src" "$RUNTIME/test" "$RUNTIME/scripts" "$RUNTIME/package.json"

echo "==> Running tests"
cd "$RUNTIME"
if ! npm test 2>&1 | grep -E '^. (tests|pass|fail)'; then
  echo "!! tests command failed" >&2
  exit 1
fi
if npm test 2>&1 | grep -qE '^. fail [1-9]'; then
  echo "!! TESTS FAILED — aborting deploy (runtime left on ${NEW}; investigate)" >&2
  exit 1
fi

echo "==> Syncing browser-service (if present in repo)"
if [ -d "$REPO/control-plane/browser-service" ] && [ -d "$BROWSER_RUNTIME" ]; then
  rsync -a --delete --exclude node_modules "$REPO/control-plane/browser-service/src/" "$BROWSER_RUNTIME/src/"
  cp -f "$REPO/control-plane/browser-service/package.json" "$BROWSER_RUNTIME/package.json"
fi

echo "==> Restarting services"
systemctl restart company-control-plane-api.service company-control-plane-telegram-bot.service
if systemctl list-unit-files | grep -q starlab-browser-service; then
  systemctl restart starlab-browser-service.service || true
fi
sleep 4

echo "==> Health"
for svc in company-control-plane-api company-control-plane-telegram-bot; do
  printf '%s: %s\n' "$svc" "$(systemctl is-active "$svc".service)"
done
curl -s http://127.0.0.1:3099/health || true
echo
echo "==> Deployed ${NEW}"
