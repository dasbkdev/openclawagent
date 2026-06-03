#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
DIST_DIR="${PROJECT_ROOT}/dist/macos"
PKG_PATH="${DIST_DIR}/CompanyControlPlane.pkg"
DMG_ROOT="${DIST_DIR}/dmg-root"
DMG_PATH="${DIST_DIR}/CompanyControlPlane.dmg"

"${PROJECT_ROOT}/scripts/macos/build-macos-pkg.sh" "${PROJECT_ROOT}"

rm -rf "${DMG_ROOT}" "${DMG_PATH}"
mkdir -p "${DMG_ROOT}"
cp "${PKG_PATH}" "${DMG_ROOT}/CompanyControlPlane.pkg"

hdiutil create \
  -volname "Company Control Plane" \
  -srcfolder "${DMG_ROOT}" \
  -ov \
  -format UDZO \
  "${DMG_PATH}"

echo "Built ${DMG_PATH}"
