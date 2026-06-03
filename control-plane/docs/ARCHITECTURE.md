# Architecture

This service is intentionally separate from Metricon and OpenClaw. The target
runtime model is centralized: one always-on server runs the company control
plane and central agent, while employee devices act as clients.

```text
Telegram Bot / OpenClaw channel
  -> Company Control Plane
  -> RBAC, hierarchy, invite codes, audit
  -> read-only connectors
  -> Metricon / Bitrix / Jira / Google
```

## Boundaries

- Metricon remains the monitoring/reporting source of truth.
- OpenClaw remains the agent runtime and channel/gateway layer when a local
  runtime or bridge is needed.
- Company Control Plane owns company-specific authorization and audit.
- Employee devices do not decide permissions and do not directly manage each
  other's agents.

## Centralized Server Model

For the MVP, a Linux server/VPS controlled by Nikolay is the central server. It
runs:

- the HTTP API;
- the setup wizard;
- the Telegram bot;
- scheduled token usage reports;
- encrypted secret storage;
- connector calls;
- the central agent/orchestrator.

Maksat and PM devices should be treated as clients by default. They connect to
the central server through Telegram, central web UI, or a future local OpenClaw
bridge. The central server applies RBAC for every request.

## MVP Data Model

- `users`: seeded Nikolay, Maksat, and three PMs.
- `projects`: one project per PM for the first slice.
- `inviteCodes`: SHA-256 hashes of one-time registration codes.
- `auditLog`: append-only JSON events in MVP storage.
- `projects.bitrixGroupId`: Bitrix workgroup/project mapping for task scoping.

## Local Setup And Secrets

The HTTP API serves a local setup wizard at:

```text
http://127.0.0.1:3099/setup
```

Non-secret runtime settings are stored in `runtime-config.json`. Secrets are
stored in `secrets.json` encrypted with AES-256-GCM and a local key file
`secrets.key`.

Wizard-managed secrets:

- Telegram bot token.
- Metricon access token.
- Bitrix incoming webhook URL.
- Claude API key.
- Google OAuth client JSON.

The current MVP masks stored secrets in the UI and API responses. For
production, move the encryption key into a managed secret store or OS-backed
key management strategy.

## Claude Model Policy

The control plane enforces latest Sonnet as the company default:

```text
claude-sonnet-4-6
```

For OpenClaw this is exposed as:

```text
anthropic/claude-sonnet-4-6
```

The policy is returned by `/api/v1/setup/model-policy` and included in setup
status. It also exports Anthropic/Claude env values at runtime so local agent
processes launched from this service do not fall back to an older model.

## Token Usage Analytics

Token usage events are stored in `tokenUsageEvents` inside the MVP JSON state.
Agents can write one event per model request through:

```text
POST /api/v1/token-usage/events
```

The owner can read summaries through:

```text
GET /api/v1/token-usage/summary?period=day|week|month
```

The Telegram bot runner sends daily, weekly, and monthly reports only to
`TOKEN_USAGE_REPORT_TELEGRAM_ID`, defaulting to `984834133`. Reports aggregate
total tokens, input/output/cache tokens, top users, top actions, top models, and
optional `costUsd`.

## Access Rules

- `OWNER`: all users and projects.
- `SENIOR_PM`: self plus recursive subordinates.
- `PM`: self plus own project membership.

Every sensitive read should call the policy layer before using a connector.

## Connector Rule

Connectors should be typed and read-only by default. The agent should request
high-level reports, not raw unrestricted data.

Current connectors:

- Metricon activity summary: mock by default, HTTP mode via `METRICON_BASE_URL`
  and `METRICON_ACCESS_TOKEN`. Legacy `KICKIDLER_*` env names are still
  accepted for compatibility.
- Bitrix project status: mock by default, webhook mode via `BITRIX_WEBHOOK_URL`
  and `tasks.task.list`.

## Telegram Bot Runner

`npm run bot` starts a long-polling Telegram process. It uses the same JSON
store and domain policies as the HTTP API. The bot is intentionally thin: it
parses commands, calls domain services, and sends formatted summaries.

If the bot starts before setup is complete, it waits until the Telegram token is
saved instead of exiting.

## Linux Runtime

Linux is the preferred central server target.

The Linux install scripts place application files under:

```text
/opt/company-control-plane
```

Non-secret environment config lives under:

```text
/etc/company-control-plane/control-plane.env
```

Mutable runtime state and encrypted setup secrets live under:

```text
/var/lib/company-control-plane
```

Autostart is handled by systemd:

```text
company-control-plane-api.service
company-control-plane-telegram-bot.service
```

The setup wizard should be accessed through SSH tunnel for the first pilot:

```text
ssh -L 3099:127.0.0.1:3099 <user>@<server-ip>
```

## Windows Runtime

Windows remains a fallback/testing path. The Windows install scripts place
source/runtime files under:

```text
C:\Program Files\CompanyControlPlane
```

Mutable state and `.env` live under:

```text
C:\ProgramData\CompanyControlPlane
```

The `.exe` installer starts the API after install and opens `/setup`.

Autostart is handled by Scheduled Tasks with highest privileges:

```text
CompanyControlPlaneApi
CompanyControlPlaneTelegramBot
```

## macOS Runtime

The macOS scaffold builds a `.app`, `.pkg`, and `.dmg` on a Mac. The `.pkg`
installs the app to `/Applications`, registers a LaunchDaemon, stores runtime
data under `/Library/Application Support/CompanyControlPlane`, creates a Desktop
symlink for the console user, and opens `/setup`.
