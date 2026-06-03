# Centralized Server Plan

This document describes the new target architecture for the company agent
product. It replaces the earlier idea where multiple employee devices had
agents that directly collected data from each other.

## Core Decision

The product should run through one centralized server and one centralized agent.

The hierarchy stays the same:

- `OWNER`: Nikolay.
- `SENIOR_PM`: Maksat.
- `PM`: three project managers under Maksat.

What changes:

- Nikolay, Maksat, and PMs do not directly control each other's local agents.
- All users talk to the centralized server.
- The centralized server decides what each user is allowed to see or do.
- The centralized agent collects data from Metricon, Bitrix, Jira, Google
  services, Gmail, and future connectors.
- The centralized agent prepares reports and actions according to RBAC.

## Where The Server Runs

MVP location:

- Nikolay's always-on office computer.
- This machine stays powered on 24/7.
- It runs the main control-plane API.
- It runs the Telegram bot process.
- It runs scheduled jobs and token usage reports.
- It stores encrypted integration secrets and runtime state.

Future production option:

- Move the same server to a VPS or dedicated office server.
- Keep Nikolay as owner/admin, but remove dependence on one workstation.

## Network

Primary private network:

- Tailscale.

Backup private network:

- ZeroTier.

Legacy/fallback:

- Radmin VPN only for Windows-only testing.

Required behavior:

- Employee devices connect to the same private network as the central server.
- Devices do not need peer-to-peer access to each other.
- Devices only need to reach the central server API and Telegram remains the
  main user channel.
- The central server can use private network addresses for local web UI/API
  access.

## Main Components

### Central Control Plane API

Responsibilities:

- Users, roles, and hierarchy.
- Project ownership and visibility.
- Invite code registration.
- RBAC checks.
- Audit log.
- Token usage ingest and summaries.
- Setup wizard and encrypted secret storage.
- Connector API endpoints.

### Central Agent / Orchestrator

Responsibilities:

- Receive a user request from Telegram, web UI, or another approved channel.
- Identify the user and role.
- Build the allowed data scope.
- Call only the connectors allowed for that scope.
- Ask Claude Sonnet for analysis or report generation.
- Record token usage for every model call.
- Save/report the result.

This agent acts as one centralized brain. It should not trust a client device to
decide permissions.

### Telegram Bot

Responsibilities:

- Register users by invite code.
- Bind Telegram IDs to company users.
- Receive commands and messages.
- Send user requests to the central server.
- Return role-filtered reports.
- Send token usage reports only to Telegram user id `984834133`.

### Setup Wizard

Responsibilities:

- Configure Telegram bot token.
- Configure Claude API key.
- Upload Google OAuth client JSON.
- Configure Metricon API base URL and access token.
- Configure Bitrix credentials.
- Configure future Jira/Gmail/Google integrations.
- Store secrets encrypted.
- Show masked secrets only.

### Connectors

Connectors should run from the central server by default.

Metricon:

- Central server stores Metricon base URL and access token.
- Central agent reads employee activity/time data.
- Server maps Metricon users to internal users.
- RBAC filters what each requester can see.

Bitrix:

- Prefer a single admin-level Bitrix app/webhook/OAuth integration if it can
  read all required workgroups/tasks.
- The central server filters Bitrix data by role, project, and user.
- If Bitrix permissions require user identity, add per-user OAuth later.

Google Calendar, Gmail, Drive, Docs, Sheets:

- Prefer per-user OAuth connection through the central server.
- Store refresh tokens encrypted per user.
- Use least-privilege scopes.
- For shared company documents/sheets, a service account can be considered if
  the domain setup allows it.

Jira:

- Use one admin/API integration if company visibility allows it.
- Otherwise add per-user OAuth and keep RBAC filtering in the central server.

## Data Ownership

The central server is the source of truth for:

- users;
- roles;
- hierarchy;
- projects;
- invite codes;
- Telegram account bindings;
- integration account mappings;
- encrypted credentials;
- audit events;
- token usage events;
- generated reports and report history.

Employee devices are clients. They are not sources of truth for permissions.

## Request Flow

Example: PM asks for a daily project report.

```text
PM Telegram message
  -> Telegram bot
  -> central control-plane API
  -> authenticate Telegram user
  -> resolve PM role and project scope
  -> central agent
  -> Metricon / Bitrix / Google / Jira connectors
  -> Claude Sonnet summarization
  -> token usage event saved
  -> response sent back to the PM
  -> audit event saved
```

Example: Maksat asks for subordinate PM status.

```text
Maksat request
  -> central server
  -> RBAC resolves Maksat scope: self plus subordinate PMs
  -> central agent collects allowed project/user data
  -> central agent creates summary for Maksat
  -> result is sent to Maksat
```

Example: Nikolay asks for company-wide status.

```text
Nikolay request
  -> central server
  -> RBAC resolves OWNER scope: all users and projects
  -> central agent collects company-wide data
  -> report is returned to Nikolay
```

## Role Rules

`OWNER`:

- Can see all users, projects, reports, audits, and token analytics.
- Can create invite codes.
- Can configure integrations.
- Receives daily/weekly/monthly token usage reports.

`SENIOR_PM`:

- Can see own data.
- Can see subordinate PM data.
- Can request summary reports for subordinate projects.
- Cannot manage Nikolay.
- Cannot see owner-only token/cost analytics unless explicitly allowed.

`PM`:

- Can see own projects and own linked service data.
- Cannot see other PMs.
- Cannot manage anyone.

## Device Install Model

Nikolay's device/server:

- Full server install.
- Control-plane API.
- Telegram bot.
- Scheduler.
- Setup wizard.
- Encrypted secret storage.
- Central agent.

Maksat and PM devices:

- Client/light install only, unless a local bridge is later required.
- Join Tailscale or backup VPN.
- Register through Telegram invite code.
- Use Telegram and/or central web UI.
- Optional future local OpenClaw client can send requests to the central server.

## Security Requirements

- All permission decisions happen on the central server.
- Never trust client-provided role or project scope.
- Secrets stay on the central server in encrypted storage.
- Use per-user encrypted OAuth tokens where user identity matters.
- Every sensitive read writes an audit event.
- Every Claude call writes a token usage event.
- Only Nikolay's configured Telegram ID receives token usage cost reports.
- Do not expose the setup wizard outside trusted local/private network access.
- Add HTTPS before exposing beyond localhost/private network.

## Migration Plan

1. Update docs and install playbooks to state Tailscale plus centralized server.
2. Change non-owner device setup so it does not install always-on API/bot tasks
   by default.
3. Add central server base URL setting for clients.
4. Add central agent/orchestrator module behind the existing control-plane API.
5. Move report commands so they call the central orchestrator instead of local
   device assumptions.
6. Add per-user integration connection records.
7. Add Bitrix/Google/Jira/Gmail connector scopes.
8. Add central audit and token analytics around every agent action.
9. Test flows for Nikolay, Maksat, and one PM.
10. Roll out to remaining PM devices.

## Open Questions

- Will the MVP central server stay on Nikolay's PC, or should we move quickly to
  a VPS after the first pilot?
- Can Bitrix be read with one admin integration, or do some workflows require
  per-user OAuth?
- Which Google data must be accessed as per-user private data versus shared
  company data?
- Should Maksat see token cost for subordinate PMs, or should token cost remain
  owner-only?
- Should client devices use only Telegram first, or do we need a web dashboard
  immediately?
