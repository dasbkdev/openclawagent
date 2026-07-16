# Starlab Desktop

Native desktop assistant (macOS + Windows 10/11), built with **Tauri 2** — a Rust shell
around the system WebView (WKWebView on macOS, WebView2 on Windows) with a React/TypeScript
UI. It is a *face* over the existing Starlab brain: it talks to the control-plane's
OpenAI-compatible bridge (`/v1/chat/completions`, streaming) — no second brain here.

> Working brand is **Starlab** (codename). To rename: `productName` + `identifier` in
> `src-tauri/tauri.conf.json`, the `<title>`/brand strings, and `package.json.name`.

## Phase status

- **Done:** window, system tray, global hotkey (Ctrl/⌘+Alt+Space), streaming chat with
  markdown/code blocks, conversations sidebar (persisted), model catalog + connection dot,
  message actions (copy/regenerate), Ctrl/⌘+N new chat, and a **built-in terminal** (⌘ in
  the header) that runs shell commands via the Rust `run_command` (PowerShell on Windows,
  bash elsewhere; `cd` persists the working dir).
- **Next:** agent tool-calling (the terminal + file tools driven by the model — needs the
  bridge to speak tool-calls), memory/RAG panel, voice (STT/TTS), plugins. A native SwiftUI
  macOS shell over the same brain can come later (Phase 2).

## Prerequisites

- **Node 18+** and **npm**.
- **Rust** (stable) — https://rustup.rs
- Platform build deps: macOS → Xcode command-line tools; Windows → "Desktop development with
  C++" (MSVC) + WebView2 (built into Win 11; auto-installed on Win 10).
- Tauri CLI is a dev dependency (`npm i` installs it).

## Develop

```bash
cd desktop
npm install
npm run tauri icon path/to/logo.png   # once — generates the app icons
npm run app:dev                        # hot-reload dev app
```

Open **⚙ Настройки** and set the brain address (e.g. `http://127.0.0.1:3099` locally, or the
LAN/VPS bridge URL), model, and the bridge bearer token if the bridge requires one.

## Build installers

```bash
npm run app:build
```

Outputs (in `src-tauri/target/release/bundle/`):

- **Windows:** `nsis/*.exe` installer (and optionally `.msi`).
- **macOS:** `dmg/*.dmg` and `macos/*.app`.

## Signing WITHOUT paid certificates (internal use)

Paid certificates are only needed for public distribution. For your own machines (you,
Nikolay, Ernur) this is free:

### Windows — self-signed cert, trusted on your machines

```powershell
# 1) Create a self-signed code-signing cert (once)
$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject "CN=Starlab Internal" -CertStoreLocation Cert:\CurrentUser\My
# 2) Export it
$pwd = ConvertTo-SecureString -String "changeit" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath starlab.pfx -Password $pwd
Export-Certificate  -Cert $cert -FilePath starlab.cer
# 3) On EACH machine, trust it (Admin): import starlab.cer into
#    "Trusted Root Certification Authorities" and "Trusted Publishers".
Import-Certificate -FilePath starlab.cer -CertStoreLocation Cert:\LocalMachine\Root
Import-Certificate -FilePath starlab.cer -CertStoreLocation Cert:\LocalMachine\TrustedPublisher
# 4) Sign the built exe
& "signtool.exe" sign /f starlab.pfx /p changeit /fd SHA256 `
  /tr http://timestamp.digicert.com /td SHA256 path\to\Starlab_0.1.0_x64-setup.exe
```

Tauri can also sign automatically — set `bundle.windows.certificateThumbprint` (and
`digestAlgorithm`, `timestampUrl`) in `tauri.conf.json` to the self-signed cert's thumbprint.

### macOS — ad-hoc sign + clear quarantine on your own Macs

```bash
# ad-hoc sign (no Apple account needed)
codesign --deep --force --sign - "Starlab.app"
# after copying to /Applications, remove the download quarantine flag so Gatekeeper opens it
xattr -dr com.apple.quarantine "/Applications/Starlab.app"
```

Or the first time: right-click the app → **Open** → **Open** (bypasses Gatekeeper once).

When you later get an Apple Developer account ($99/yr) and a Windows code-signing cert, swap
in real signing + notarization and the warnings disappear for anyone.

## Architecture

```
Tauri (Rust)  →  React/TS UI  →  Starlab brain (control-plane OpenAI bridge)
 window/tray      chat/stream      memory · RAG · graph · facts · integrations
 hotkey/store     settings
```
