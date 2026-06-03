# Central Server Prep Runbook

This runbook prepares the centralized server for the company agent product.

Current target:

- One centralized server.
- MVP server location: Nikolay's always-on Windows machine or rented Windows
  server.
- All other devices are clients by default.
- Users interact through Telegram, central web UI, or a future local bridge.

## Server Role

The server is responsible for:

- control-plane HTTP API;
- setup wizard;
- Telegram bot runner;
- scheduled token usage reports;
- central agent/orchestrator;
- encrypted secret storage;
- Metricon, Bitrix, Google, Jira, Gmail connectors;
- audit log;
- token usage analytics;
- role and hierarchy enforcement.

The server is the only place that should store production API keys and OAuth
tokens.

## Recommended Server Spec

Minimum for pilot:

```text
CPU: 2 cores
RAM: 4 GB
Disk: 30-50 GB free SSD
OS: Windows 10/11 Pro, Windows Server 2019+, or Windows Server 2022+
Network: stable internet
```

Recommended:

```text
CPU: 4 cores
RAM: 8-16 GB
Disk: 100 GB+ SSD
OS: Windows Server 2022+ or Windows 11 Pro
Network: stable internet plus Tailscale
Power: UPS if this is a physical office machine
```

GPU is not required because Claude/Sonnet runs through API calls, not locally.

## What To Send Codex Before Remote Setup

Use temporary credentials and rotate them after setup.

Needed:

- server public IP or host name;
- Windows username;
- temporary Windows password;
- whether RDP is enabled;
- whether the server is Windows Server, Windows 10, or Windows 11;
- whether Tailscale is already installed;
- repo clone URL and branch if different from current `develop`;
- GitHub access method if the repo is private.

Do not send these in repo files:

- Telegram bot token;
- Claude API key;
- Metricon access token;
- Bitrix webhook;
- Google OAuth JSON;
- Jira/Gmail/Google tokens.

These secrets should be entered through the setup wizard after the server is
installed.

## Target Paths

Source checkout:

```text
C:\agent
C:\agent\control-plane
```

Installed app:

```text
C:\Program Files\CompanyControlPlane
```

Runtime data:

```text
C:\ProgramData\CompanyControlPlane
```

Important runtime files:

```text
C:\ProgramData\CompanyControlPlane\.env
C:\ProgramData\CompanyControlPlane\control-plane.json
C:\ProgramData\CompanyControlPlane\runtime-config.json
C:\ProgramData\CompanyControlPlane\secrets.json
C:\ProgramData\CompanyControlPlane\secrets.key
```

## Preflight

Run PowerShell as Administrator:

```powershell
cd C:\agent\control-plane
powershell.exe -ExecutionPolicy Bypass -File .\scripts\preflight-windows-server.ps1
```

The script checks:

- Administrator privileges;
- Windows version;
- CPU cores;
- RAM;
- free disk space;
- Git availability;
- Node.js availability;
- Tailscale availability;
- port `3099`;
- scheduled task state;
- install and data directories.

If Node.js is missing, the installer can download portable Node.js during
install. Git and Tailscale should normally be installed before production setup.

## Install Flow

1. Log in through RDP or local console.
2. Install Git if missing.
3. Install Tailscale and join the company tailnet.
4. Clone the repo:

```powershell
New-Item -ItemType Directory -Force -Path C:\agent | Out-Null
cd C:\agent
git clone <repo-url> .
git checkout develop
```

If the repo is cloned as a folder:

```powershell
cd C:\agent
git clone <repo-url> openclawagent
cd C:\agent\openclawagent
git checkout develop
```

5. Run preflight:

```powershell
cd C:\agent\control-plane
powershell.exe -ExecutionPolicy Bypass -File .\scripts\preflight-windows-server.ps1
```

6. Install the central server:

```powershell
cd C:\agent\control-plane
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -InstallTelegramBot -StartNow -OpenSetupWizard
```

7. Open setup wizard:

```text
http://127.0.0.1:3099/setup
```

8. Fill setup values:

- Nikolay Telegram numeric ID;
- Telegram bot token;
- Claude API key;
- Metricon base URL;
- Metricon access token;
- Bitrix webhook/API credentials;
- Google OAuth client JSON;
- token usage report recipient: `984834133`;
- optional token usage ingest token.

9. Restart tasks if needed:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\Program Files\CompanyControlPlane\scripts\restart-windows.ps1"
```

## Verification

Run:

```powershell
Invoke-RestMethod http://127.0.0.1:3099/health
Get-ScheduledTask CompanyControlPlaneApi
Get-ScheduledTask CompanyControlPlaneTelegramBot
tailscale status
tailscale ip -4
```

Expected:

- API returns a health response.
- Both scheduled tasks exist.
- API task starts at boot.
- Telegram bot task starts at boot.
- Tailscale shows the server connected to the correct tailnet.

## Firewall

For the first pilot, keep the API local/private only.

Recommended:

- do not expose `3099` to the public internet;
- use Tailscale/private network for central web UI/API access;
- keep Telegram as the main external channel;
- add HTTPS/reverse proxy before any public web exposure.

## Backup

Back up this folder daily:

```text
C:\ProgramData\CompanyControlPlane
```

Important:

- `secrets.json` and `secrets.key` must be backed up together.
- If `secrets.key` is lost, encrypted secrets cannot be restored.
- Keep backups outside git.

Suggested backup target:

```text
D:\CompanyControlPlaneBackups
```

or a secure cloud/drive folder controlled by the owner.

## Client Onboarding After Server Is Ready

For Maksat and PM devices:

1. Install Tailscale and join the same tailnet.
2. Register through Telegram invite code.
3. Use the central Telegram bot.
4. Optional: open central web UI over Tailscale when implemented.
5. Do not install always-on API/bot tasks on client devices unless explicitly
   requested for development/testing.

## Open Server Tasks

- Decide whether this rented server replaces Nikolay's office computer or acts
  as a stronger central server owned by Nikolay.
- Configure Tailscale ACLs so client devices only reach required services.
- Add HTTPS/reverse proxy if the web UI needs non-Tailscale access.
- Add proper database storage before larger production rollout.
- Add automated backup script and retention policy.
