# Company Control Plane

Standalone MVP service for company agents. It keeps the corporate hierarchy,
Telegram registration, invite codes, audit log, and read-only integration
contracts outside Metricon and OpenClaw.

## What It Does

- Registers Telegram users with one-time invite codes.
- Enforces hierarchy access:
  - `OWNER` can access everyone.
  - `SENIOR_PM` can access self and subordinate PMs.
  - `PM` can access self and own projects.
- Writes audit events for sensitive actions.
- Exposes a read-only Metricon activity summary endpoint.
- Serves a local setup wizard for Telegram, Google OAuth, Claude, Bitrix, and
  Metricon configuration.
- Stores service secrets encrypted at rest and displays only masked values.
- Enforces the company Claude default model as latest Sonnet:
  `anthropic/claude-sonnet-4-6` for OpenClaw and `claude-sonnet-4-6` for
  Claude/Anthropic env.
- Records token usage events and summarizes spend by user, action, model, and
  project.
- Sends automatic token usage reports to Telegram id `984834133`.
- Lets Telegram users ask free-form Russian questions; the bot sends allowed
  Metricon, Bitrix, device, Calendar, Gmail, Drive, Docs, and Sheets context to
  Claude.
- Supports per-user Google OAuth connect/status/disconnect with encrypted
  refresh tokens and read-only Calendar/Gmail/Drive/Docs/Sheets snapshots.
- Uses a JSON file store for MVP speed and easy review.

## Linux Central Server Install

Linux is the preferred central server target. See:

```text
docs\LINUX_INSTALL.md
```

Fast path after cloning on the server:

```bash
sudo bash scripts/linux/preflight-linux-server.sh
sudo bash scripts/linux/install-linux.sh --start-now
```

The installer registers:

```text
company-control-plane-api.service
company-control-plane-telegram-bot.service
```

## Run Locally

```powershell
cd C:\Users\dasmu\agent\control-plane
npm test
npm start
```

Default URL: `http://127.0.0.1:3099`.

Setup wizard:

```text
http://127.0.0.1:3099/setup
```

## Windows Install Fallback

For Windows testing/fallback, see:

```text
docs\WINDOWS_INSTALL.md
```

Build a local `.exe` installer:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\build-windows-installer.ps1
```

Output:

```text
dist\CompanyControlPlaneInstaller.exe
```

The `.exe` installer starts the local API and opens the setup wizard. Use the
wizard to enter Nikolay's Telegram ID, Telegram bot token, Google OAuth JSON,
Claude API key, Metricon token, and Bitrix webhook URL.

Run Telegram polling in a second terminal during local development:

```powershell
npm run bot
```

The bot waits until `TELEGRAM_BOT_TOKEN` is saved through the setup wizard.

## Token Usage Analytics

Agents record usage through:

```text
POST /api/v1/token-usage/events
```

Owner summary:

```text
GET /api/v1/token-usage/summary?period=day
GET /api/v1/token-usage/summary?period=week
GET /api/v1/token-usage/summary?period=month
```

Telegram manual command:

```text
/tokens day
```

Full contract:

```text
docs\TOKEN_USAGE_ANALYTICS.md
```

## Claude Model Policy

The service exposes the company model policy at:

```text
http://127.0.0.1:3099/api/v1/setup/model-policy
```

Docs and OpenClaw config snippet:

```text
docs\CLAUDE_MODEL_POLICY.md
config\openclaw-model-policy.example.json
```

## macOS Install

Build `.app`, `.pkg`, and `.dmg` artifacts on a Mac:

```text
docs\MACOS_INSTALL.md
```

## Useful API Calls

Create an invite code as Nikolay:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3099/api/v1/invite-codes `
  -Headers @{ "X-Actor-Telegram-Id" = "dev-nikolay" } `
  -ContentType "application/json" `
  -Body '{"userId":"u-pm-1","ttlMinutes":60}'
```

Register a PM through Telegram:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3099/api/v1/telegram/register `
  -ContentType "application/json" `
  -Body '{"code":"CODE_FROM_PREVIOUS_RESPONSE","telegramUserId":"pm1-telegram","username":"pm1"}'
```

Request a Metricon activity summary:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3099/api/v1/reports/metricon/activity-summary `
  -Headers @{ "X-Actor-Telegram-Id" = "dev-nikolay" } `
  -ContentType "application/json" `
  -Body '{"from":"2026-06-02T00:00:00Z","to":"2026-06-02T23:59:59Z"}'
```

Request a Bitrix project status:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3099/api/v1/reports/bitrix/project-status `
  -Headers @{ "X-Actor-Telegram-Id" = "dev-nikolay" } `
  -ContentType "application/json" `
  -Body '{"projectId":"project-alpha","limit":20}'
```

Start Google OAuth for the current Telegram-linked actor:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri http://127.0.0.1:3099/api/v1/google/oauth/start `
  -Headers @{ "X-Actor-Telegram-Id" = "dev-nikolay" }
```

Read a Google Workspace snapshot for an accessible user:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "http://127.0.0.1:3099/api/v1/google/workspace-snapshot?userId=u-pm-1&period=day" `
  -Headers @{ "X-Actor-Telegram-Id" = "dev-nikolay" }
```

## Telegram Commands

The bot runner supports:

```text
/register CODE
/invite
/invite u-maksat
/invite u-pm-1
/me
/users
/agents
/projects
/report today
/report week
/project project-alpha today
/project project-alpha week
/bitrix project-alpha
/tokens day
/google_connect
/google_status
/google_disconnect
free-form question, for example: Как сегодня работала Бегайым?
/help
```

## Metricon Connector

By default the service uses a mock read-only Metricon connector so the MVP can
run without credentials. For real Metricon API access set `METRICON_BASE_URL`
and either `METRICON_ACCESS_TOKEN` or `METRICON_REFRESH_TOKEN` through the setup
wizard. Refresh token is preferred because Metricon access tokens are short
lived.

The connector calls:

```text
GET /api/v1/activity/report?employeeId={id}&from={iso}&to={iso}
Authorization: Bearer ...
```

Swagger handoff:

```text
docs\METRICON_API.md
```

## Device Agents

Local device agents report heartbeats to the central server:

```text
POST /api/v1/device-agents/heartbeat
X-Device-Agent-Token: <DEVICE_AGENT_INGEST_TOKEN>
```

Visible device agents can be listed through the API or Telegram:

```text
GET /api/v1/device-agents
/agents
```

macOS lightweight client install:

```bash
bash scripts/macos/install-device-agent.sh \
  --user-id u-maksat \
  --device-id maksat-mac-mini \
  --display-name "Maksat Mac Mini" \
  --token "<device-agent-token>" \
  --run-as-daemon \
  --start-now
```

For production macOS clients, use `--run-as-daemon`. This registers
`/Library/LaunchDaemons/com.company.control-plane.device-agent.plist` and runs
the lightweight heartbeat agent as the current macOS user from the system
launchd domain, so it can start without an active GUI session.

Windows lightweight client install:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-device-agent-windows.ps1 `
  -UserId u-nikolay `
  -DeviceId nikolay-windows `
  -DisplayName "Nikolay Windows" `
  -Token "<device-agent-token>" `
  -RunAsSystem `
  -StartNow
```

For production Windows clients, run PowerShell as Administrator and use
`-RunAsSystem`. This registers the lightweight heartbeat agent as a `SYSTEM`
startup scheduled task under `C:\ProgramData\CompanyControlPlaneAgent`, so it
continues to work without an interactive user logon.

## Bitrix Connector

By default the service uses a mock Bitrix connector. For real Bitrix24 webhook
access save the incoming webhook URL through the setup wizard.

The connector calls:

```text
POST {BITRIX_WEBHOOK_URL}/tasks.task.list.json
```

Projects need a `bitrixGroupId` mapping before real Bitrix calls can be scoped
to a project.

## Production Notes

Before production, replace the JSON store with Postgres, add service-to-service
auth, move the local encryption key into DPAPI/macOS Keychain or a managed
secret manager, and keep all tools read-only unless a specific approval flow
exists.
