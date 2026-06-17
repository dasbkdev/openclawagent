#!/usr/bin/env bash
set -euo pipefail

# Turnkey publish of a desktop-agent artifact (.exe / .dmg / .deb) to production
# and refresh of the update manifest (releases.json) with a verified SHA-256.
#
# Flow:
#   1. Bump version/notes in desktop-releases.config.json (single source of truth).
#   2. Run:  publish-desktop-release.sh /path/to/starlab-openclaw-agent-macos-universal.dmg
#
# The script uploads the artifact, regenerates releases.json ON THE SERVER from
# the real uploaded file (so the SHA-256 always matches what users download),
# backs up the previous manifest, and verifies the public HTTPS download.
#
# Env overrides:
#   SERVER      (default root@195.238.122.228)
#   SSH_KEY     (default ~/.ssh/starlab_server)
#   REMOTE_DIR  (default /opt/company-control-plane/public/downloads)
#   PUBLIC_BASE (default https://starlabagent.pp.ua)
#   OWNER       (default company-control-plane:company-control-plane)
#   DRY_RUN=1   print actions without touching production

SERVER="${SERVER:-root@195.238.122.228}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/starlab_server}"
REMOTE_DIR="${REMOTE_DIR:-/opt/company-control-plane/public/downloads}"
PUBLIC_BASE="${PUBLIC_BASE:-https://starlabagent.pp.ua}"
OWNER="${OWNER:-company-control-plane:company-control-plane}"
DRY_RUN="${DRY_RUN:-0}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/desktop-releases.config.json"
GENERATOR="$SCRIPT_DIR/make-releases-manifest.mjs"

artifact="${1:-}"
if [[ -z "$artifact" ]]; then
  echo "usage: $(basename "$0") <local-artifact-path>" >&2
  exit 2
fi
if [[ ! -f "$artifact" ]]; then
  echo "error: artifact not found: $artifact" >&2
  exit 1
fi

base="$(basename "$artifact")"
# The basename must match a "file" declared in the config, or the manifest
# generator will not pick it up.
if ! grep -q "\"$base\"" "$CONFIG"; then
  echo "error: $base is not declared in $CONFIG (add it under platforms.<name>.file)" >&2
  exit 1
fi

SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$SERVER")
SCP=(scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new)

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY: $*"
  else
    "$@"
  fi
}

echo "==> Publishing $base to $SERVER:$REMOTE_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"

# 1) Back up the current manifest.
run "${SSH[@]}" "cp -a '$REMOTE_DIR/releases.json' '$REMOTE_DIR/releases.json.bak-$stamp' 2>/dev/null || true"

# 2) Upload the artifact and the generator + config (so the SHA is computed
#    server-side from the byte-identical deployed file).
run "${SCP[@]}" "$artifact" "$SERVER:$REMOTE_DIR/$base"
run "${SCP[@]}" "$GENERATOR" "$CONFIG" "$SERVER:/tmp/"

# 3) Regenerate the manifest on the server against the real downloads dir.
run "${SSH[@]}" "node /tmp/make-releases-manifest.mjs --config /tmp/desktop-releases.config.json --downloads '$REMOTE_DIR' --out '$REMOTE_DIR/releases.json'"

# 4) Fix ownership and clean up the temp copies.
run "${SSH[@]}" "chown $OWNER '$REMOTE_DIR/$base' '$REMOTE_DIR/releases.json'; rm -f /tmp/make-releases-manifest.mjs /tmp/desktop-releases.config.json"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "==> DRY_RUN complete (nothing changed)"
  exit 0
fi

# 5) Verify the public download + manifest.
echo "==> Verifying $PUBLIC_BASE/downloads/$base"
http_code="$(curl -s -o /dev/null -w '%{http_code}' -I "$PUBLIC_BASE/downloads/$base")"
remote_len="$(curl -s -I "$PUBLIC_BASE/downloads/$base" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-length"{print $2}')"
local_len="$(wc -c < "$artifact" | tr -d ' ')"
echo "    HTTP $http_code, content-length=$remote_len (local=$local_len)"
if [[ "$http_code" != "200" || "$remote_len" != "$local_len" ]]; then
  echo "error: public download mismatch (code=$http_code remote=$remote_len local=$local_len)" >&2
  exit 1
fi
echo "==> releases.json now serves:"
curl -s "$PUBLIC_BASE/downloads/releases.json"
echo
echo "==> Done."
