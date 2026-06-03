#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
DIST_DIR="${PROJECT_ROOT}/dist/macos"
APP_NAME="Company Control Plane"
APP_PATH="${DIST_DIR}/${APP_NAME}.app"
PKG_ROOT="${DIST_DIR}/pkg-root"
SCRIPTS_DIR="${DIST_DIR}/pkg-scripts"
PKG_PATH="${DIST_DIR}/CompanyControlPlane.pkg"
IDENTIFIER="com.company.control-plane"
VERSION="0.1.0"

"${PROJECT_ROOT}/scripts/macos/build-macos-app.sh" "${PROJECT_ROOT}"

rm -rf "${PKG_ROOT}" "${SCRIPTS_DIR}" "${PKG_PATH}"
mkdir -p "${PKG_ROOT}/Applications" "${PKG_ROOT}/Library/LaunchDaemons" "${SCRIPTS_DIR}"
cp -R "${APP_PATH}" "${PKG_ROOT}/Applications/"

cat > "${PKG_ROOT}/Library/LaunchDaemons/${IDENTIFIER}.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${IDENTIFIER}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/${APP_NAME}.app/Contents/Resources/launch-service.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Library/Application Support/CompanyControlPlane/server.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Library/Application Support/CompanyControlPlane/server.err.log</string>
</dict>
</plist>
PLIST

cat > "${SCRIPTS_DIR}/postinstall" <<'POSTINSTALL'
#!/usr/bin/env bash
set -euo pipefail

APP="/Applications/Company Control Plane.app"
LABEL="com.company.control-plane"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
DATA_DIR="/Library/Application Support/CompanyControlPlane"

mkdir -p "${DATA_DIR}"
chmod 755 "${DATA_DIR}"

launchctl bootout system "${PLIST}" >/dev/null 2>&1 || true
launchctl bootstrap system "${PLIST}" >/dev/null 2>&1 || true
launchctl enable "system/${LABEL}" >/dev/null 2>&1 || true

CONSOLE_USER="$(stat -f %Su /dev/console || true)"
if [[ -n "${CONSOLE_USER}" && "${CONSOLE_USER}" != "root" ]]; then
  DESKTOP="/Users/${CONSOLE_USER}/Desktop"
  if [[ -d "${DESKTOP}" ]]; then
    ln -sfn "${APP}" "${DESKTOP}/Company Control Plane.app"
    chown -h "${CONSOLE_USER}:staff" "${DESKTOP}/Company Control Plane.app" || true
  fi
  USER_ID="$(id -u "${CONSOLE_USER}")"
  launchctl asuser "${USER_ID}" sudo -u "${CONSOLE_USER}" open "http://127.0.0.1:3099/setup" >/dev/null 2>&1 || true
else
  open "http://127.0.0.1:3099/setup" >/dev/null 2>&1 || true
fi

exit 0
POSTINSTALL
chmod +x "${SCRIPTS_DIR}/postinstall"

pkgbuild \
  --root "${PKG_ROOT}" \
  --scripts "${SCRIPTS_DIR}" \
  --identifier "${IDENTIFIER}" \
  --version "${VERSION}" \
  --install-location "/" \
  "${PKG_PATH}"

echo "Built ${PKG_PATH}"
