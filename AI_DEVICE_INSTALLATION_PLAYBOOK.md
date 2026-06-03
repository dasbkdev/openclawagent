# AI Device Installation Playbook

This is the master handoff file for any AI assistant helping install or operate
the company agent product on employee devices.

The user may open Codex Desktop on different computers using the same account
and say which device is currently active. The AI should use this file to
understand the project, device roles, install flow, safety rules, and what to
verify.

## Critical Safety Rules

- Do not commit or publish secrets.
- Do not write Telegram bot tokens, Claude API keys, Google OAuth JSON, Bitrix
  webhooks, Metricon tokens, or VPN credentials into source files or docs.
- Secrets must be entered through the local setup wizard:

```text
http://127.0.0.1:3099/setup
```

- Do not modify `C:\agent\metricon`, `C:\agent\kickidler`, or
  `C:\Users\dasmu\agent\kickidler` unless the user explicitly asks for it.
- The official product name is `Metricon`. Older code or OpenAPI metadata may
  still say `Kickidler`; user-facing docs and new work should say `Metricon`.
- Do not push from `C:\Users\dasmu` or any parent Windows user-profile folder.
  That can accidentally publish the whole Windows profile.
- The safe repository to push/deploy is currently:

```text
C:\agent\control-plane
```

or on the original development machine:

```text
C:\Users\dasmu\agent\control-plane
```

## Project Summary

The product is a centralized company control plane for AI agents working with
employee hierarchy, Telegram, Metricon, Bitrix, Google services, Jira, Gmail,
and OpenClaw.

The control plane owns company-specific logic:

- employee roles and hierarchy;
- Telegram registration through invite codes;
- access control;
- encrypted setup for service credentials;
- Metricon and Bitrix read-only reporting;
- token usage analytics;
- automatic Telegram reports;
- default Claude model policy.

OpenClaw is the agent runtime / gateway layer. It should live next to the
control plane as a separate checkout, not copied inside the `control-plane`
repository.

Target architecture:

- A Linux VPS/server controlled by Nikolay runs the central server and central
  agent.
- Maksat and PM devices are clients by default.
- All role permissions are enforced by the central server.
- Employee devices should not directly control each other's agents.

Recommended Linux server layout:

```text
~/agent/
  control-plane/   # company control plane repo
```

Recommended Windows development layout when source checkouts are needed:

```text
C:\agent\
  control-plane\   # company control plane repo
  openclaw\        # OpenClaw upstream/fork checkout, separate repo
```

Metricon/Kickidler source code, if present, must remain separate and should not
be pushed with the product:

```text
C:\agent\metricon\
C:\agent\kickidler\
```

## Product Components

### Control Plane

Path:

```text
~/agent/control-plane
```

Responsibilities:

- HTTP API on `127.0.0.1:3099`.
- Setup wizard at `/setup`.
- Telegram bot long-polling runner.
- User hierarchy and invite codes.
- Metricon activity summaries.
- Bitrix project status summaries.
- Token usage analytics and scheduled reports.
- Local encrypted secret storage.

Important services on Linux after install:

```text
company-control-plane-api.service
company-control-plane-telegram-bot.service
```

Production install paths:

```text
/opt/company-control-plane
/etc/company-control-plane/control-plane.env
/var/lib/company-control-plane
```

### OpenClaw

Path:

```text
C:\agent\openclaw
```

Responsibilities:

- agent runtime;
- channels/gateway;
- model execution;
- future integration with control-plane token usage ingest;
- future integration with company policy and device identity.

OpenClaw should be cloned separately. Do not vendor its full source into
`control-plane`.

### Metricon

Official name:

```text
Metricon
```

Swagger:

```text
http://85.239.49.208:8080/swagger-ui/index.html
http://85.239.49.208:8080/v3/api-docs
```

Control-plane preferred env names:

```text
METRICON_BASE_URL=http://85.239.49.208:8080
METRICON_ACCESS_TOKEN=<enter through setup wizard>
```

Legacy env names are still accepted:

```text
KICKIDLER_BASE_URL=
KICKIDLER_ACCESS_TOKEN=
```

Preferred control-plane endpoint:

```text
POST /api/v1/reports/metricon/activity-summary
```

Legacy endpoint kept for compatibility:

```text
POST /api/v1/reports/kickidler/activity-summary
```

## Device Roles

### Nikolay

Role:

```text
OWNER
```

Nikolay is the top of the hierarchy.

The central Linux server is controlled by Nikolay and should be treated as the
central control-plane node.

Important facts:

- The server should stay powered on 24/7.
- It should be connected to the company private VPN/tailnet.
- It should host the main control-plane API and Telegram bot tasks.
- Other devices connect over the private VPN network.
- The central agent can act with Nikolay's OWNER scope and collect all allowed
  company data.
- Automatic token usage reports must go only to Telegram user id:

```text
984834133
```

### Maksat

Role:

```text
SENIOR_PM
```

Maksat reports to Nikolay.

The central agent acting for Maksat:

- cannot manage Nikolay or OWNER-only settings;
- can report to Nikolay;
- can collect allowed data for subordinate PMs through central connectors;
- can prepare summary reports for Nikolay.

### Project Managers

Role:

```text
PM
```

There are three PMs under Maksat.

Each PM:

- owns one or more projects;
- can access own project data;
- cannot access other PMs' private project scope unless allowed by policy;
- reports upward to Maksat and Nikolay.

## Services Per User

Every user may have accounts or integrations for:

- Google Calendar;
- Metricon;
- Bitrix;
- Jira;
- Google Docs;
- Gmail;
- Google Sheets;
- Google Drive.

The most important read targets for the agent are:

- Metricon;
- Bitrix.

## Network Model

The planned network is VPN-based, but it must be cross-platform because PM and
senior PM devices can be Windows, macOS, or Linux.

Primary VPN choice:

- Tailscale should be the default private network for all new installs.
- The central Linux server joins the same Tailscale tailnet and stays the main
  control-plane node.
- Other employee devices join that same tailnet.
- Each device should have a stable Tailscale IPv4 address and, if enabled, a
  MagicDNS hostname.
- Agents communicate with Nikolay's control-plane API through this private
  Tailscale address or hostname.

Fallback choices:

- ZeroTier is the preferred backup if Tailscale cannot be used.
- Radmin VPN is Windows-only fallback/legacy and must not be the default plan
  for mixed Windows/macOS/Linux rollout.

The AI installer should record or ask the user for each device's VPN provider,
Tailscale IP, MagicDNS name, and role during installation.

Suggested device inventory table to maintain later:

```text
Role       Name      Device                  VPN        Private IP/MagicDNS       Notes
OWNER      Nikolay   Central Linux server     Tailscale  <fill later>             Main 24/7 node
SENIOR_PM  Maksat    Maksat PC/Mac/Linux      Tailscale  <fill later>             Reports to Nikolay
PM         PM 1      PM test device           Tailscale  <fill later>             First PM rollout
```

## Default Model Policy

The company default Claude model should be the latest Sonnet policy currently
configured by the control plane:

```text
claude-sonnet-4-6
anthropic/claude-sonnet-4-6
```

The control plane exposes:

```text
GET /api/v1/setup/model-policy
```

OpenClaw-ready snippet:

```text
C:\agent\control-plane\config\openclaw-model-policy.example.json
```

If Anthropic releases a newer Sonnet, update:

```text
C:\agent\control-plane\src\setup\claude-model-policy.js
C:\agent\control-plane\docs\CLAUDE_MODEL_POLICY.md
```

## Token Usage Analytics

The system must track where every token is spent.

Token usage event endpoint:

```text
POST /api/v1/token-usage/events
```

Summary endpoint:

```text
GET /api/v1/token-usage/summary?period=day
GET /api/v1/token-usage/summary?period=week
GET /api/v1/token-usage/summary?period=month
```

Telegram reports:

- daily: last 24 hours;
- weekly: last 7 days;
- monthly: last 30 days.

Reports must be sent only to:

```text
984834133
```

Manual Telegram commands:

```text
/tokens day
/tokens week
/tokens month
```

Important limitation:

- Analytics only become real once OpenClaw/agents send token usage events after
  model calls.

## Installation Flow For Any Device

When the user opens Codex on a device and says which device it is, the AI should
do the following.

### Step 1: Identify Device

Ask or infer:

- Is this Nikolay, Maksat, or PM device?
- Is this Windows, macOS, or Linux?
- Is the repo already cloned?
- What is the local path?
- Is Tailscale installed and connected to the company tailnet?
- What is this device's Tailscale IPv4 address?
- What is this device's MagicDNS name, if MagicDNS is enabled?
- If Tailscale is unavailable, is ZeroTier installed and connected?
- Only for Windows-only fallback: is Radmin VPN installed and connected?

Default Linux server path:

```text
~/agent/control-plane
```

### Step 2: Check Repository

Use:

```bash
cd ~/agent/control-plane
git status --short
git log --oneline -5
```

Do not run destructive git commands.

If no remote exists, ask the user before adding one.

### Step 3: Install On Linux Central Server

Run preflight:

```bash
cd ~/agent/control-plane
sudo bash scripts/linux/preflight-linux-server.sh
```

Install:

```bash
cd ~/agent/control-plane
sudo bash scripts/linux/install-linux.sh --start-now
```

Open setup through SSH tunnel:

```bash
ssh -L 3099:127.0.0.1:3099 <user>@<server-ip>
```

Check:

```bash
curl -fsS http://127.0.0.1:3099/health
systemctl status company-control-plane-api.service --no-pager
systemctl status company-control-plane-telegram-bot.service --no-pager
```

### Step 4: Windows Fallback

Windows remains a fallback/testing path:

```powershell
cd C:\agent\control-plane
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -InstallTelegramBot -OpenSetupWizard
```

### Step 5: macOS Client/Development Fallback

Build artifacts on a Mac:

```bash
cd /path/to/control-plane
chmod +x scripts/macos/*.sh
./scripts/macos/build-macos-app.sh
./scripts/macos/build-macos-pkg.sh
./scripts/macos/build-macos-dmg.sh
```

Important:

- macOS scripts exist but must be tested on a real Mac.
- Code signing and notarization are not configured yet.

## Setup Wizard Values

Open:

```text
http://127.0.0.1:3099/setup
```

Fill:

- Nikolay Telegram numeric ID.
- Telegram bot token.
- Claude API key.
- Google OAuth JSON file.
- Metricon base URL:

```text
http://85.239.49.208:8080
```

- Metricon access token when available.
- Bitrix webhook when available.
- Token usage report recipient:

```text
984834133
```

- Optional token usage ingest token.

Do not put any of these secrets into git.

## Role-Specific Install Notes

### Central Linux Server Install

This is the main always-on node.

The AI should:

- install control-plane API systemd service;
- install Telegram bot systemd service;
- configure setup wizard;
- confirm `company-control-plane-api.service` starts at boot;
- confirm `company-control-plane-telegram-bot.service` starts at boot;
- confirm Tailscale is connected;
- record Tailscale IP and MagicDNS name in handoff notes;
- confirm Telegram bot can respond;
- create or verify invite codes for Maksat and PMs.

### Maksat Device Install

The AI should:

- join Tailscale tailnet;
- register Maksat through Telegram invite code;
- point Maksat to the central server or Telegram bot;
- avoid installing always-on API/bot tasks on Maksat's device unless explicitly
  requested for development/testing;
- optionally clone `control-plane` and `openclaw` side by side for development;
- install local runtime only if needed for development/testing;
- record Tailscale IP and MagicDNS name;
- confirm Maksat can see own and subordinate PM data only;
- confirm Maksat cannot manage Nikolay.

### PM Device Install

The AI should:

- join Tailscale tailnet;
- record Tailscale IP and MagicDNS name;
- register PM through Telegram invite code;
- point PM to the central server or Telegram bot;
- avoid installing always-on API/bot tasks on PM devices unless explicitly
  requested for development/testing;
- optionally clone `control-plane` and `openclaw` side by side for development;
- confirm PM can see only own user/project scope;
- verify report commands with mock or real Metricon once token is configured.

## Useful Telegram Commands

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
/tokens day
/tokens week
/tokens month
/help
```

## Verification Checklist

After install, verify:

```bash
curl -fsS http://127.0.0.1:3099/health
curl -fsS http://127.0.0.1:3099/api/v1/setup/model-policy
```

Check systemd services on Linux:

```bash
systemctl status company-control-plane-api.service --no-pager
systemctl status company-control-plane-telegram-bot.service --no-pager
```

Check logs:

```bash
journalctl -u company-control-plane-api.service -n 80 --no-pager
journalctl -u company-control-plane-telegram-bot.service -n 80 --no-pager
```

Check setup state:

```text
/var/lib/company-control-plane/runtime-config.json
/var/lib/company-control-plane/secrets.json
/var/lib/company-control-plane/secrets.key
```

Do not print secret values into chat unless the user explicitly requests it and
understands the risk.

## Current Known Gaps

- Bitrix credentials are pending.
- OpenClaw does not yet automatically emit token usage events into the control
  plane.
- macOS `.pkg/.dmg` needs real-device testing.
- Production storage should move from JSON to Postgres.
- Local secret key should move to a managed secret store or Linux key management
  strategy.
- Real Metricon connector still needs to be mapped from OpenAPI report schemas.

## Files To Read First On A New Device

```text
~/agent/AI_DEVICE_INSTALLATION_PLAYBOOK.md
~/agent/CODEX_WORKLOG_FOR_CLAUDE.md
~/agent/SERVER_PREP_RUNBOOK.md
~/agent/control-plane/README.md
~/agent/control-plane/docs/DEVICE_INSTALL_CHECKLIST.md
~/agent/control-plane/docs/LINUX_INSTALL.md
~/agent/control-plane/docs/METRICON_API.md
~/agent/control-plane/docs/TOKEN_USAGE_ANALYTICS.md
~/agent/control-plane/docs/CLAUDE_MODEL_POLICY.md
```

If paths differ, locate the same files under the cloned `agent` or
`control-plane` directory.
