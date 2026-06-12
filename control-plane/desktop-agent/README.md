# Starlab OpenClaw Desktop Agent

Native Electron desktop app for employee devices.

## Windows

Build on Windows:

```powershell
npm ci
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npm run build:win
```

Output:

- `dist/starlab-openclaw-agent-windows.exe`

## macOS

Build on macOS:

```bash
npm ci
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run build:mac
```

Outputs:

- `dist/starlab-openclaw-agent-macos-x64.dmg`
- `dist/starlab-openclaw-agent-macos-arm64.dmg`

Unsigned builds may show Gatekeeper warnings. For production, add Apple Developer ID signing and notarization.

## Linux Debian

Build on Linux:

```bash
npm ci
npm run build:linux
```

Output:

- `dist/starlab-openclaw-agent-linux-amd64.deb`

## GitHub Actions

Workflow:

- `.github/workflows/build-desktop-agents.yml`

It builds Windows, macOS, and Linux artifacts. After workflow completion, download artifacts and place them on the server:

- `/opt/company-control-plane/public/downloads/starlab-openclaw-agent-windows.exe`
- `/opt/company-control-plane/public/downloads/starlab-openclaw-agent-macos-x64.dmg`
- `/opt/company-control-plane/public/downloads/starlab-openclaw-agent-macos-arm64.dmg`
- `/opt/company-control-plane/public/downloads/starlab-openclaw-agent-linux-amd64.deb`
