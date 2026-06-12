#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/agent/openclaw"

node_dir="$(find "$HOME/.local" -maxdepth 1 -type d -name 'node-v24.*-darwin-arm64' | sort -V | tail -n 1)"
VERSION="$("$node_dir/bin/node" -p "require('./package.json').version")"

APP="dist/OpenClaw.app"
SOURCE_DMG="dist/OpenClaw-$VERSION.dmg"
TARGET_DMG="dist/starlab-openclaw-agent-macos-universal.dmg"
RW_DMG="dist/OpenClaw-$VERSION-rw.dmg"
STAGING="$(mktemp -d "dist/starlab-dmg.XXXXXX")"

cleanup() {
  rm -rf "$STAGING"
}
trap cleanup EXIT

test -d "$APP"
cp -R "$APP" "$STAGING/OpenClaw.app"
ln -s /Applications "$STAGING/Applications"
rm -f "$SOURCE_DMG" "$TARGET_DMG" "$RW_DMG"

hdiutil create \
  -volname "Starlab OpenClaw Agent" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDZO \
  "$SOURCE_DMG"

cp "$SOURCE_DMG" "$TARGET_DMG"
ls -lh "$APP" "$SOURCE_DMG" "$TARGET_DMG" "dist/OpenClaw-$VERSION.zip"
