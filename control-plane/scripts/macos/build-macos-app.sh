#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
DIST_DIR="${PROJECT_ROOT}/dist/macos"
APP_NAME="Company Control Plane"
APP_PATH="${DIST_DIR}/${APP_NAME}.app"
CONTENTS_DIR="${APP_PATH}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"
APP_PAYLOAD_DIR="${RESOURCES_DIR}/app"

rm -rf "${APP_PATH}"
mkdir -p "${MACOS_DIR}" "${RESOURCES_DIR}" "${APP_PAYLOAD_DIR}" "${RESOURCES_DIR}/runtime"

rsync -a \
  --exclude ".git" \
  --exclude "data" \
  --exclude "dist" \
  --exclude "node_modules" \
  --exclude "test" \
  "${PROJECT_ROOT}/" "${APP_PAYLOAD_DIR}/"

if command -v node >/dev/null 2>&1; then
  cp "$(command -v node)" "${RESOURCES_DIR}/runtime/node"
  chmod +x "${RESOURCES_DIR}/runtime/node"
fi

cat > "${CONTENTS_DIR}/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Company Control Plane</string>
  <key>CFBundleExecutable</key>
  <string>company-control-plane</string>
  <key>CFBundleIdentifier</key>
  <string>com.company.control-plane</string>
  <key>CFBundleName</key>
  <string>Company Control Plane</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

cat > "${MACOS_DIR}/company-control-plane" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES_DIR="${APP_ROOT}/Resources"
APP_DIR="${RESOURCES_DIR}/app"
NODE="${RESOURCES_DIR}/runtime/node"

if [[ ! -x "${NODE}" ]]; then
  NODE="$(command -v node || true)"
fi

if [[ -z "${NODE}" ]]; then
  osascript -e 'display alert "Company Control Plane" message "Node.js was not bundled and is not installed."'
  exit 1
fi

DATA_DIR="${HOME}/Library/Application Support/CompanyControlPlane"
mkdir -p "${DATA_DIR}"
export CONTROL_PLANE_CONFIG_DIR="${CONTROL_PLANE_CONFIG_DIR:-${DATA_DIR}}"
export CONTROL_PLANE_DATA_FILE="${CONTROL_PLANE_DATA_FILE:-${DATA_DIR}/control-plane.json}"
export CONTROL_PLANE_ENV_FILE="${CONTROL_PLANE_ENV_FILE:-${DATA_DIR}/.env}"

"${NODE}" "${APP_DIR}/src/server.js" >> "${DATA_DIR}/server.out.log" 2>> "${DATA_DIR}/server.err.log" &
SERVER_PID=$!

for _ in {1..45}; do
  if curl -fsS "http://127.0.0.1:3099/health" >/dev/null 2>&1; then
    open "http://127.0.0.1:3099/setup"
    wait "${SERVER_PID}"
    exit $?
  fi
  sleep 1
done

open "http://127.0.0.1:3099/setup"
wait "${SERVER_PID}"
LAUNCHER
chmod +x "${MACOS_DIR}/company-control-plane"

cat > "${RESOURCES_DIR}/launch-service.sh" <<'SERVICE'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/Applications/Company Control Plane.app/Contents/Resources/app"
NODE="/Applications/Company Control Plane.app/Contents/Resources/runtime/node"

if [[ ! -x "${NODE}" ]]; then
  NODE="$(command -v node || true)"
fi

if [[ -z "${NODE}" ]]; then
  echo "Node.js was not bundled and is not installed." >&2
  exit 1
fi

DATA_DIR="/Library/Application Support/CompanyControlPlane"
mkdir -p "${DATA_DIR}"
export CONTROL_PLANE_CONFIG_DIR="${DATA_DIR}"
export CONTROL_PLANE_DATA_FILE="${DATA_DIR}/control-plane.json"
export CONTROL_PLANE_ENV_FILE="${DATA_DIR}/.env"

exec "${NODE}" "${APP_DIR}/src/server.js"
SERVICE
chmod +x "${RESOURCES_DIR}/launch-service.sh"

echo "Built ${APP_PATH}"
if [[ ! -x "${RESOURCES_DIR}/runtime/node" ]]; then
  echo "Warning: node was not bundled. Install Node.js 22+ on the target Mac or build on a Mac with node in PATH."
fi
