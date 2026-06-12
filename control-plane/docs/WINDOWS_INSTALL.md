# Windows Install

Production now uses the Linux VPS as the central server. Nikolay's Windows
computer should run only the lightweight device agent that reports into the
central control plane.

## Production Windows Client

Open PowerShell as Administrator on Nikolay's computer:

```powershell
cd $env:USERPROFILE\agent\openclawagent\control-plane
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-device-agent-windows.ps1 `
  -UserId u-nikolay `
  -DeviceId nikolay-windows `
  -DisplayName "Nikolay Windows" `
  -Token "<device-agent-token>" `
  -RunAsSystem `
  -StartNow
```

This installs the client agent to:

```text
C:\ProgramData\CompanyControlPlaneAgent
```

Windows Scheduled Task:

```text
CompanyControlPlaneDeviceAgent
```

The task is registered as `SYSTEM`, starts at boot, and does not require
Nikolay's interactive Windows session to be logged in.

## Legacy Full Windows Server Install

This path is retained only as an offline fallback. Do not run the full API or
Telegram bot tasks on Nikolay's Windows computer while the Linux VPS is the
authoritative central server.

## Legacy Server Preflight

Before installation, run the central server prep checklist:

```text
C:\agent\SERVER_PREP_RUNBOOK.md
```

Then run PowerShell as Administrator:

```powershell
cd C:\agent\control-plane
powershell.exe -ExecutionPolicy Bypass -File .\scripts\preflight-windows-server.ps1
```

Fix any `FAIL` result before installing. `WARN` results can be acceptable for a
pilot if the runbook explains the tradeoff.

## Option A: Install From Source Clone

Open PowerShell as Administrator:

```powershell
cd C:\agent\control-plane
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -InstallTelegramBot -OpenSetupWizard
```

If Node.js is not installed, the script downloads portable Node.js and places
`node.exe` under the app runtime directory. The `.exe` installer already bundles
`node.exe`.

This installs the app to:

```text
C:\Program Files\CompanyControlPlane
```

Runtime data and config:

```text
C:\ProgramData\CompanyControlPlane\.env
C:\ProgramData\CompanyControlPlane\control-plane.json
C:\ProgramData\CompanyControlPlane\runtime-config.json
C:\ProgramData\CompanyControlPlane\secrets.json
C:\ProgramData\CompanyControlPlane\secrets.key
```

Windows Scheduled Task:

```text
CompanyControlPlaneApi
```

To also install the Telegram bot task:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -InstallTelegramBot -StartNow
```

## Option B: Build And Run EXE Installer

On a Windows build machine with Node.js installed:

```powershell
cd C:\Users\dasmu\agent\control-plane
powershell.exe -ExecutionPolicy Bypass -File .\scripts\build-windows-installer.ps1
```

The output will be:

```text
dist\CompanyControlPlaneInstaller.exe
```

Copy that `.exe` to Nikolay's computer, right-click, run as Administrator.
The EXE installer registers both API and Telegram Bot scheduled tasks, starts
the API, and opens:

```text
http://127.0.0.1:3099/setup
```

## Configure

Use the setup wizard instead of putting secrets into `.env`:

```text
http://127.0.0.1:3099/setup
```

The wizard saves:

```text
BOOTSTRAP_OWNER_TELEGRAM_ID=<Nikolay Telegram numeric user id>
TELEGRAM_BOT_TOKEN=<Telegram bot token>
METRICON_BASE_URL=<Metricon backend URL>
METRICON_ACCESS_TOKEN=<Metricon service token>
METRICON_REFRESH_TOKEN=<Metricon refresh token, preferred>
BITRIX_WEBHOOK_URL=<Bitrix incoming webhook URL>
CLAUDE_API_KEY=<Claude API key>
GOOGLE_OAUTH_CLIENT_JSON=<uploaded JSON content>
TOKEN_USAGE_REPORT_TELEGRAM_ID=984834133
TOKEN_USAGE_INGEST_TOKEN=<optional ingest protection token>
```

The service also enforces the company Claude model policy:

```text
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6
OPENCLAW_DEFAULT_MODEL=anthropic/claude-sonnet-4-6
```

The OpenClaw config snippet is:

```text
C:\Program Files\CompanyControlPlane\config\openclaw-model-policy.example.json
```

Token analytics docs:

```text
C:\Program Files\CompanyControlPlane\docs\TOKEN_USAGE_ANALYTICS.md
```

Secret values are encrypted in:

```text
C:\ProgramData\CompanyControlPlane\secrets.json
```

The local encryption key is:

```text
C:\ProgramData\CompanyControlPlane\secrets.key
```

After changing config manually or after the first setup, restart tasks if needed:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\Program Files\CompanyControlPlane\scripts\restart-windows.ps1"
```

## Check

```powershell
Invoke-RestMethod http://127.0.0.1:3099/health
Start-Process http://127.0.0.1:3099/setup
Get-ScheduledTask CompanyControlPlaneApi
```

## Uninstall

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\Program Files\CompanyControlPlane\scripts\uninstall-windows.ps1"
```

Remove data too:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\Program Files\CompanyControlPlane\scripts\uninstall-windows.ps1" -RemoveData
```
