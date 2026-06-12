#!/usr/bin/env bash
set -euo pipefail
ACTOR="$(node - <<'NODE'
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('/var/lib/company-control-plane/control-plane.json','utf8'));
const user = state.users.find((item) => item.telegram && item.telegram.telegramUserId);
process.stdout.write(String(user?.telegram?.telegramUserId || ''));
NODE
)"
test -n "$ACTOR"
curl -fsS -H "x-actor-telegram-id: $ACTOR" http://127.0.0.1:3099/api/v1/device-actions | head -60
echo
curl -fsS -H "x-actor-telegram-id: $ACTOR" 'http://127.0.0.1:3099/api/v1/device-commands?limit=3' | head -80
