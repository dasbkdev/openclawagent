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
- Uses a JSON file store for MVP speed and easy review.

## Run

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

## Windows Install

For Nikolay's always-on Windows computer, see:

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

## Telegram Commands

The bot runner supports:

```text
/register CODE
/me
/users
/projects
/report today
/report week
/project project-alpha today
/project project-alpha week
/bitrix project-alpha
/help
```

## Metricon Connector

By default the service uses a mock read-only Metricon connector so the MVP can
run without credentials. For real Metricon API access set `METRICON_BASE_URL`
and `METRICON_ACCESS_TOKEN` through the setup wizard.

The connector calls:

```text
GET /api/v1/activity/report?employeeId={id}&from={iso}&to={iso}
Authorization: Bearer ...
```

Swagger handoff:

```text
docs\METRICON_API.md
```

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
