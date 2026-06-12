#!/usr/bin/env bash
set -euo pipefail

# Build the Starlab-flavoured OpenClaw macOS app from the existing Swift target.
#
# Output:
# - dist/OpenClaw.app
# - dist/OpenClaw-<version>.dmg
#
# For internal builds without an Apple certificate this script defaults to ad-hoc
# signing and skips notarization. For production notarized builds set:
#   SIGN_IDENTITY="Developer ID Application: ..."
#   SKIP_NOTARIZE=0

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

export BUNDLE_ID="${BUNDLE_ID:-com.starlab.openclaw.agent}"
export BUILD_CONFIG="${BUILD_CONFIG:-release}"
export BUILD_ARCHS="${BUILD_ARCHS:-all}"
export ALLOW_ADHOC_SIGNING="${ALLOW_ADHOC_SIGNING:-1}"
export SKIP_NOTARIZE="${SKIP_NOTARIZE:-1}"
export SKIP_DSYM="${SKIP_DSYM:-1}"
export SKIP_DMG="${SKIP_DMG:-1}"
export DMG_VOLUME_NAME="${DMG_VOLUME_NAME:-Starlab OpenClaw Agent}"

"$ROOT_DIR/scripts/package-mac-dist.sh"

VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
APP="$ROOT_DIR/dist/OpenClaw.app"
SOURCE_DMG="$ROOT_DIR/dist/OpenClaw-$VERSION.dmg"
TARGET_DMG="$ROOT_DIR/dist/starlab-openclaw-agent-macos-universal.dmg"

create_simple_dmg() {
  local staging
  staging="$(mktemp -d "$ROOT_DIR/dist/starlab-dmg.XXXXXX")"
  cp -R "$APP" "$staging/OpenClaw.app"
  ln -s /Applications "$staging/Applications"
  rm -f "$SOURCE_DMG" "$TARGET_DMG"
  hdiutil create \
    -volname "$DMG_VOLUME_NAME" \
    -srcfolder "$staging" \
    -ov \
    -format UDZO \
    "$SOURCE_DMG"
  rm -rf "$staging"
}

if [[ ! -f "$SOURCE_DMG" ]]; then
  create_simple_dmg
fi

if [[ -f "$SOURCE_DMG" ]]; then
  cp "$SOURCE_DMG" "$TARGET_DMG"
  echo "Starlab macOS DMG: $TARGET_DMG"
fi
