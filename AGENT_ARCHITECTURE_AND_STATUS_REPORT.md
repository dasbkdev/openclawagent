# Starlab Agent - Detailed Architecture And Status Report

Date: 2026-06-04  
Scope: central Linux server agent, Maksat macOS device agent, PM Windows device agent  
Security note: this report intentionally does not include passwords, API tokens,
Telegram bot token, Bitrix webhook URL, Metricon tokens, Claude API key, or
Google OAuth JSON contents.

---

## 1. Short Summary

The current product is a centralized control-plane for company AI agents.

There is one main server on the Linux VPS. It owns the API, Telegram bot,
hierarchy rules, setup wizard, encrypted service settings, reports, audit log,
token usage analytics, and device heartbeat registry.

Employee computers do not run the full server. They run lightweight device
agents. A device agent is a small Node.js process that starts automatically,
collects basic machine metadata, and sends a heartbeat to the central server
every minute.

Current live device status from the VPS state on 2026-06-04:

| Device | User | Role | Host | OS | Mode | Last seen UTC | Heartbeats |
|---|---|---|---|---|---|---|---:|
| `maksat-mac-mini` | `u-maksat` | SENIOR_PM | `Mac-mini.local` | macOS arm64 | LaunchDaemon | `2026-06-04T10:02:40.757Z` | 124 |
| `nikolay-windows` | `u-nikolay` | OWNER | `WIN-5IMJD8NIIM7` | Windows x64 | SYSTEM task | `2026-06-04T10:02:40.496Z` | 172 |
| `begayym-windows` | `u-pm-1` | PM | `DESKTOP-M780PPS` | Windows x64 | SYSTEM task | `2026-06-04T10:01:59.229Z` | 48 |

In simple terms: Nikolay can now see that Maksat's Mac and the PM laptop are
online and reporting to the central system. The agents are not yet full
OpenClaw worker agents that can execute local tasks or collect deep local
activity by themselves. They are currently reliable visibility/heartbeat
clients, prepared for future OpenClaw bridge functionality.

---

## 2. Important Terms

### Central server agent

This is the Linux VPS service called `company-control-plane`. It is the main
brain of the current MVP.

It runs:

- HTTP API
- setup wizard
- Telegram bot runner
- Metricon connector
- Bitrix connector
- hierarchy/RBAC logic
- invite code system
- device agent registry
- token usage analytics
- audit log

### Device agent

This is the lightweight process installed on employee computers.

It currently does:

- starts automatically with OS boot;
- reads local config from an env file;
- collects machine metadata;
- sends heartbeat to the central server;
- reports capabilities and labels;
- writes local stdout/stderr logs.

It currently does not:

- read files from the employee computer;
- execute commands sent by the server;
- monitor screen/keyboard/apps directly;
- send screenshots;
- send token usage automatically from OpenClaw;
- act as a full OpenClaw runtime bridge.

Those can be added later.

---

## 3. Current Topology

```text
Telegram users / future UI / future OpenClaw bridge
                 |
                 v
       https://starlabagent.pp.ua
                 |
              Nginx
                 |
                 v
Linux VPS: company-control-plane API on 127.0.0.1:3099
                 |
      +----------+----------+
      |          |          |
      v          v          v
 Metricon     Bitrix     JSON state + encrypted secrets
```

Device clients:

```text
Nikolay Windows  -> POST /api/v1/device-agents/heartbeat
Maksat Mac       -> POST /api/v1/device-agents/heartbeat
PM Windows       -> POST /api/v1/device-agents/heartbeat
```

Why this architecture changed from the earlier Radmin VPN idea:

- Radmin VPN does not work cleanly on macOS.
- A single VPS avoids cross-platform VPN complexity.
- All clients can report through ordinary HTTPS.
- The hierarchy stays centralized and easier to audit.
- Future web/Telegram/OpenClaw integrations have one place to talk to.

---

## 4. Server Runtime

The central server is installed on the Linux VPS under:

```text
/opt/company-control-plane
```

Runtime data is under:

```text
/var/lib/company-control-plane
```

Important runtime files:

```text
/var/lib/company-control-plane/control-plane.json
/var/lib/company-control-plane/runtime-config.json
/var/lib/company-control-plane/secrets.json
/var/lib/company-control-plane/secrets.key
```

Important system services:

```text
company-control-plane-api.service
company-control-plane-telegram-bot.service
nginx
```

The API listens locally on:

```text
127.0.0.1:3099
```

Nginx publishes it through:

```text
https://starlabagent.pp.ua
```

The heartbeat endpoint is exposed without Nginx Basic Auth, but still requires
the device-agent ingest token:

```text
POST /api/v1/device-agents/heartbeat
Header: X-Device-Agent-Token
```

The rest of the public UI/API remains protected by Nginx Basic Auth and/or the
application's actor checks.

---

## 5. Server Components

### 5.1 HTTP API

File:

```text
control-plane/src/server.js
control-plane/src/api/router.js
```

The API:

- loads `.env` and encrypted setup settings;
- applies the enforced Claude model policy;
- opens the JSON state store;
- creates Metricon and Bitrix clients;
- routes HTTP requests;
- validates actor permissions;
- writes audit events for sensitive reads/actions.

Main endpoint groups:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Basic health check |
| `GET /setup` | Web setup wizard |
| `GET /api/v1/setup/status` | Setup status, masked secrets, model policy |
| `GET /api/v1/setup/model-policy` | Enforced Claude/OpenClaw model config |
| `POST /api/v1/setup/services` | Save setup settings and encrypted secrets |
| `POST /api/v1/telegram/register` | Register user by invite code |
| `GET /api/v1/me` | Current actor profile |
| `GET /api/v1/users/accessible` | Users visible to current actor |
| `GET /api/v1/projects/accessible` | Projects visible to current actor |
| `GET /api/v1/device-agents` | Device agents visible to current actor |
| `POST /api/v1/device-agents/heartbeat` | Client device heartbeat ingest |
| `POST /api/v1/invite-codes` | OWNER creates registration code |
| `POST /api/v1/reports/metricon/activity-summary` | Metricon activity report |
| `POST /api/v1/reports/bitrix/project-status` | Bitrix task/project report |
| `POST /api/v1/token-usage/events` | Token usage event ingest |
| `GET /api/v1/token-usage/summary` | Token usage summary |
| `GET /api/v1/audit-log` | OWNER audit log view |

### 5.2 Telegram Bot

File:

```text
control-plane/src/telegram-bot.js
control-plane/src/telegram/handler.js
```

The bot uses long polling. It does not currently require Telegram webhook
hosting.

Supported commands:

```text
/register CODE
/me
/users
/agents
/projects
/report today
/report week
/project PROJECT_ID today
/project PROJECT_ID week
/bitrix PROJECT_ID
/tokens day
/tokens week
/tokens month
```

What each command does:

| Command | What it does |
|---|---|
| `/register CODE` | Links Telegram user to a company user via one-time invite code |
| `/me` | Shows current user's profile |
| `/users` | Shows users visible under the hierarchy |
| `/agents` | Shows visible device agents and last heartbeat |
| `/projects` | Lists visible projects |
| `/report today/week` | Metricon activity summary for accessible users |
| `/project PROJECT_ID today/week` | Metricon summary scoped to one project |
| `/bitrix PROJECT_ID` | Bitrix task status report for one project |
| `/tokens day/week/month` | Token usage report, restricted to configured report recipient |

The Telegram bot also checks scheduled token usage reports and sends them when
daily/weekly/monthly intervals are due.

### 5.3 Setup Wizard And Secret Storage

Files:

```text
control-plane/src/setup/setup-page.js
control-plane/src/setup/setup-service.js
control-plane/src/setup/secret-store.js
```

The setup wizard stores normal settings in `runtime-config.json` and secrets in
encrypted storage.

Settings/secrets it accepts:

| Field | Purpose |
|---|---|
| Nikolay Telegram ID | Makes Nikolay the OWNER actor in Telegram/API |
| Telegram bot token | Lets the Telegram runner poll and reply |
| Google OAuth JSON | Future Google Calendar/Docs/Sheets/Drive/Gmail access |
| Claude API key | Future OpenClaw/Claude API usage |
| Metricon base URL | Metricon API endpoint |
| Metricon access token | Metricon API auth |
| Metricon refresh token | Preferred stable Metricon auth |
| Bitrix webhook URL | Bitrix REST access |
| Token report recipient Telegram ID | Who receives usage reports |
| Token usage ingest token | Protects token usage event ingest |

Secrets are masked in setup status and are not shown back in full.

### 5.4 Model Policy

File:

```text
control-plane/src/setup/claude-model-policy.js
```

The current policy pins the intended Claude/OpenClaw model to latest Sonnet
according to the current implementation:

```text
CLAUDE_MODEL=claude-sonnet-4-6
OPENCLAW_DEFAULT_MODEL=anthropic/claude-sonnet-4-6
```

The API exposes this through:

```text
GET /api/v1/setup/model-policy
```

Why it matters:

- prevents users from accidentally selecting older Claude models;
- gives future OpenClaw bridge a single place to read the company model policy;
- keeps token analytics grouped by model.

### 5.5 Hierarchy And RBAC

Files:

```text
control-plane/src/domain/policy.js
control-plane/src/domain/roles.js
control-plane/src/infra/seed.js
```

Current hierarchy:

```text
Nikolay (OWNER)
  |
  +-- Maksat (SENIOR_PM)
        |
        +-- Project Manager 1 / Begayym (PM)
        +-- Project Manager 2 (PM)
        +-- Project Manager 3 (PM)
```

Access rules:

| Role | Can see/control |
|---|---|
| OWNER | Everyone, all users, all projects, all device agents, invite codes, audit, token summaries |
| SENIOR_PM | Self and subordinate PMs, projects under own management |
| PM | Self and own project scope only |

Important behavior:

- OWNER sees all device agents.
- SENIOR_PM sees own device and subordinate PM devices.
- PM sees only own device.
- Only OWNER can create invite codes and read audit/token summaries via API.
- Token report Telegram command is restricted to the configured report recipient.

### 5.6 JSON State Store

File:

```text
control-plane/src/infra/json-store.js
```

Current MVP storage is a JSON file:

```text
/var/lib/company-control-plane/control-plane.json
```

It stores:

- users;
- projects;
- invite codes;
- device agents;
- token usage events;
- token report schedule;
- audit log.

This is fine for the pilot. For production scale, PostgreSQL or another durable
database should replace JSON storage.

### 5.7 Audit Log

File:

```text
control-plane/src/infra/audit.js
```

Audit events are written for actions like:

- owner Telegram update;
- invite code creation;
- Telegram registration;
- first device-agent sighting;
- Metricon report read;
- Bitrix report read;
- token usage event ingest;
- token usage summary read.

The audit log helps answer:

- who requested a report;
- which users/projects were targeted;
- when a device first appeared;
- when setup changed owner identity.

---

## 6. What The Server Accepts

### 6.1 Device Heartbeat

Endpoint:

```text
POST /api/v1/device-agents/heartbeat
```

Auth:

```text
X-Device-Agent-Token: <configured ingest token>
```

The client sends JSON like:

```json
{
  "userId": "u-maksat",
  "deviceId": "maksat-mac-mini",
  "displayName": "Maksat Mac Mini",
  "hostname": "Mac-mini.local",
  "platform": "darwin",
  "arch": "arm64",
  "osRelease": "25.5.0",
  "agentVersion": "0.1.0",
  "capabilities": ["heartbeat", "openclaw-client"],
  "labels": {
    "role": "SENIOR_PM",
    "person": "Maksat",
    "mode": "daemon"
  }
}
```

Server processing:

- validates the ingest token;
- validates `userId` and `deviceId`;
- confirms `userId` exists in company state;
- updates or creates the device record;
- records hostname/platform/arch/OS release/version;
- records `firstSeenAt` and `lastSeenAt`;
- increments `heartbeatCount`;
- stores `lastRemoteAddress`;
- writes audit event only when device is first seen.

Important current limitation:

- `status` is set to `online` when heartbeat arrives.
- There is not yet an automatic stale/offline status calculation.
- For now, freshness is judged by `lastSeenAt`.

### 6.2 Token Usage Events

Endpoint:

```text
POST /api/v1/token-usage/events
```

Optional auth:

```text
X-Usage-Ingest-Token: <configured usage ingest token>
```

Accepted event fields:

```json
{
  "userId": "u-pm-1",
  "projectId": "project-alpha",
  "action": "openclaw.chat",
  "source": "openclaw",
  "provider": "anthropic",
  "model": "anthropic/claude-sonnet-4-6",
  "sessionId": "session-id",
  "requestId": "request-id",
  "inputTokens": 1000,
  "outputTokens": 500,
  "cacheReadTokens": 0,
  "cacheWriteTokens": 0,
  "totalTokens": 1500,
  "costUsd": 0.01,
  "metadata": {}
}
```

Server processing:

- validates user by `userId` or `telegramUserId`;
- validates project if `projectId` is provided;
- validates token counts;
- stores event in JSON state;
- builds summaries by user/action/model/project/period;
- can send Telegram reports daily, weekly, monthly.

Important current limitation:

- OpenClaw is not yet wired to send these events automatically.
- Token analytics are ready to receive data, but usefulness depends on future
  event emission from OpenClaw/local agent/API wrapper.

### 6.3 Metricon Activity Summary

Endpoint:

```text
POST /api/v1/reports/metricon/activity-summary
```

Actor auth:

```text
X-Actor-Telegram-Id: <registered Telegram user id>
```

Accepted body examples:

```json
{
  "from": "2026-06-04T00:00:00.000Z",
  "to": "2026-06-04T23:59:59.999Z"
}
```

```json
{
  "projectId": "project-alpha",
  "from": "2026-06-04T00:00:00.000Z",
  "to": "2026-06-04T23:59:59.999Z"
}
```

```json
{
  "targetUserId": "u-pm-1",
  "from": "2026-06-04T00:00:00.000Z",
  "to": "2026-06-04T23:59:59.999Z"
}
```

Server processing:

- resolves actor from Telegram ID;
- checks actor hierarchy permissions;
- resolves target users by actor/project/user;
- maps users to `kickidlerEmployeeId`;
- calls Metricon API if configured;
- falls back to mock data if not configured;
- writes audit event.

Current Metricon connector behavior:

- supports `METRICON_BASE_URL`;
- supports access token;
- supports refresh token;
- can refresh expired access token on 401/403;
- uses API path pattern `/api/v1/activity/report`.

Important current limitation:

- Metricon endpoint shape still needs final confirmation against production
  OpenAPI/Swagger.
- If Metricon credentials/tokens are wrong or expired, report calls fail.

### 6.4 Bitrix Project Status

Endpoint:

```text
POST /api/v1/reports/bitrix/project-status
```

Actor auth:

```text
X-Actor-Telegram-Id: <registered Telegram user id>
```

Accepted body:

```json
{
  "projectId": "project-alpha",
  "limit": 20
}
```

Server processing:

- resolves actor from Telegram ID;
- checks actor can access project;
- maps internal project to Bitrix workgroup via `bitrixGroupId`;
- calls Bitrix REST method `tasks.task.list`;
- filters by `GROUP_ID`;
- normalizes task fields;
- counts total/open/completed/overdue/status groups;
- writes audit event.

Important current limitation:

- Real usefulness depends on correct `bitrixGroupId` mapping for actual Bitrix
  projects/groups.
- Current seeded mappings are MVP placeholders: `101`, `102`, `103`.

### 6.5 Invite Codes

Endpoint:

```text
POST /api/v1/invite-codes
```

Only OWNER can call it.

It creates one-time registration codes for employees. Codes are stored as
SHA-256 hashes, not plain text.

Registration can happen through:

```text
POST /api/v1/telegram/register
/register CODE
```

Current registration status:

- Nikolay Telegram is linked.
- Maksat Telegram is not linked yet.
- PM users are not linked yet.

### 6.6 Setup Save

Endpoint:

```text
POST /api/v1/setup/services
```

This accepts setup values and stores secrets encrypted.

It is useful for first installation and credential rotation.

---

## 7. What Data The Server Processes

### 7.1 Company Identity Data

Stored in state:

- user id;
- display name;
- role;
- manager id;
- employee id;
- Metricon employee id;
- project ids;
- Telegram linked status.

Current users:

| User ID | Display name | Role | Manager |
|---|---|---|---|
| `u-nikolay` | Nikolay | OWNER | none |
| `u-maksat` | Maksat | SENIOR_PM | `u-nikolay` |
| `u-pm-1` | Project Manager 1 | PM | `u-maksat` |
| `u-pm-2` | Project Manager 2 | PM | `u-maksat` |
| `u-pm-3` | Project Manager 3 | PM | `u-maksat` |

### 7.2 Project Data

Stored in state:

- project id;
- name;
- Bitrix group id;
- owner user id;
- manager user id;
- member user ids.

Current seeded projects:

| Project ID | Name | Manager | PM/member | Bitrix group id |
|---|---|---|---|---:|
| `project-alpha` | Project Alpha | `u-maksat` | `u-pm-1` | 101 |
| `project-beta` | Project Beta | `u-maksat` | `u-pm-2` | 102 |
| `project-gamma` | Project Gamma | `u-maksat` | `u-pm-3` | 103 |

### 7.3 Device Data

Stored per device:

- device id;
- user id;
- display name;
- hostname;
- platform;
- CPU architecture;
- OS release;
- agent version;
- status;
- first seen time;
- last seen time;
- last remote address;
- heartbeat count;
- capabilities;
- labels.

This is currently the strongest live part of the system.

### 7.4 Token Usage Data

Stored per event:

- occurred time;
- user id;
- project id;
- action;
- source;
- provider;
- model;
- session id;
- request id;
- input/output/cache tokens;
- total tokens;
- optional cost;
- metadata.

This is ready but requires OpenClaw or another wrapper to send events.

### 7.5 Report Data

Metricon:

- active seconds;
- idle seconds;
- lock seconds;
- top applications;
- or raw Metricon payload if real API returns a different shape.

Bitrix:

- task id;
- title;
- status;
- status label;
- deadline;
- responsible user;
- changed/closed dates;
- overdue flag.

### 7.6 Secret Data

Secrets are stored encrypted:

- Telegram bot token;
- Claude API key;
- Google OAuth JSON;
- Metricon access token;
- Metricon refresh token;
- Bitrix webhook URL;
- token usage ingest token.

The report does not include secret values.

---

## 8. Maksat Device Agent

### 8.1 Current Installation

Device:

```text
Mac-mini.local
```

OS:

```text
macOS/Darwin 25.5.0 arm64
```

User:

```text
asik
```

Agent identity:

```text
deviceId=maksat-mac-mini
userId=u-maksat
role=SENIOR_PM
person=Maksat
mode=daemon
```

Capabilities:

```text
heartbeat
openclaw-client
```

Install directory:

```text
/Users/asik/Library/Application Support/CompanyControlPlaneAgent
```

LaunchDaemon:

```text
/Library/LaunchDaemons/com.company.control-plane.device-agent.plist
```

Launchd service:

```text
system/com.company.control-plane.device-agent
```

The daemon runs as:

```text
asik
```

Logs:

```text
/Users/asik/Library/Application Support/CompanyControlPlaneAgent/logs/device-agent.out.log
/Users/asik/Library/Application Support/CompanyControlPlaneAgent/logs/device-agent.err.log
```

### 8.2 What It Sends

Every 60 seconds it sends:

- `userId`;
- `deviceId`;
- display name;
- hostname;
- OS platform;
- CPU architecture;
- OS release;
- agent version;
- labels;
- capabilities.

It does not send:

- screenshots;
- active app list;
- files;
- browser history;
- keyboard/mouse data;
- Bitrix/Metricon data;
- OpenClaw prompt contents;
- Claude tokens.

### 8.3 Usefulness For Maksat

The central server can now know:

- Maksat's Mac is alive;
- when it last checked in;
- which role/person the device belongs to;
- whether the future OpenClaw client bridge can be expected on that machine;
- that Nikolay can see Maksat's device under hierarchy.

This is useful as a foundation for:

- device presence;
- rollout validation;
- later command routing;
- later OpenClaw local bridge;
- later per-device health monitoring.

### 8.4 Current Status

Latest observed from server:

```text
lastSeenAt=2026-06-04T10:02:40.757Z
heartbeatCount=124
```

Status: working.

---

## 9. PM Device Agent

### 9.1 Current Installation

Device:

```text
DESKTOP-M780PPS
```

OS:

```text
Windows 11 Pro x64
```

Windows user:

```text
User
```

Agent identity:

```text
deviceId=begayym-windows
userId=u-pm-1
role=PM
person=Begayym
mode=system
```

Capabilities:

```text
heartbeat
openclaw-client
```

Install directory:

```text
C:\ProgramData\CompanyControlPlaneAgent
```

Windows Scheduled Task:

```text
CompanyControlPlaneDeviceAgent
```

Task principal:

```text
SYSTEM
```

Task trigger:

```text
At startup
```

Logs:

```text
C:\ProgramData\CompanyControlPlaneAgent\logs\device-agent.out.log
C:\ProgramData\CompanyControlPlaneAgent\logs\device-agent.err.log
```

### 9.2 What It Sends

Every 60 seconds it sends:

- `userId`;
- `deviceId`;
- display name;
- hostname;
- OS platform;
- CPU architecture;
- OS release;
- agent version;
- labels;
- capabilities.

It does not send:

- screenshots;
- files;
- private local data;
- direct Bitrix data;
- direct Metricon data;
- Claude/OpenClaw token usage yet.

### 9.3 Usefulness For PM

The central server can now know:

- PM laptop is alive;
- PM laptop belongs to `u-pm-1`;
- Nikolay can see it;
- Maksat should be able to see subordinate PM devices once Maksat Telegram is
  registered;
- future OpenClaw bridge can be added to this device without redesigning the
  server.

### 9.4 Current Status

Latest observed from server:

```text
lastSeenAt=2026-06-04T10:01:59.229Z
heartbeatCount=48
```

Status: working.

---

## 10. Nikolay Device Agent

Nikolay's device is also part of the live hierarchy.

Device:

```text
WIN-5IMJD8NIIM7
```

Agent identity:

```text
deviceId=nikolay-windows
userId=u-nikolay
role=OWNER
person=Nikolay
mode=system
```

Install directory:

```text
C:\ProgramData\CompanyControlPlaneAgent
```

Windows Scheduled Task:

```text
CompanyControlPlaneDeviceAgent
```

Latest observed from server:

```text
lastSeenAt=2026-06-04T10:02:40.496Z
heartbeatCount=172
```

Status: working.

---

## 11. How Useful The Current System Is

### Already Useful

The system is already useful for:

- proving that the centralized architecture works;
- replacing the failed cross-platform Radmin VPN dependency;
- validating Windows and macOS device rollout;
- showing which company devices are online;
- enforcing hierarchy visibility;
- letting Nikolay see subordinate devices;
- preparing Telegram-based management;
- storing setup secrets safely;
- centralizing Metricon and Bitrix access;
- preparing token analytics;
- preparing future OpenClaw bridge.

### Most Valuable Current Feature

The most valuable current feature is centralized visibility with hierarchy:

```text
Nikolay can see all devices.
Maksat can be configured to see himself and subordinate PM devices.
PM can only see own device.
```

This is the base for everything else.

### What It Does Not Yet Solve

It does not yet fully solve:

- automated reading of local OpenClaw sessions;
- remote command execution;
- local file/document access through agents;
- screen/app monitoring from local machine;
- automatic token usage collection from OpenClaw;
- full AI task execution by user role;
- automatic Bitrix project mapping from real company projects;
- full Metricon report mapping from final production API schema.

---

## 12. Practical Examples

### Nikolay checks visible agents through API

```http
GET /api/v1/device-agents
X-Actor-Telegram-Id: <Nikolay Telegram id>
```

Response includes:

- Maksat Mac;
- Nikolay Windows;
- Begayym/PM Windows.

### User checks agents through Telegram

```text
/agents
```

The bot returns device list visible to that Telegram user.

### Nikolay requests Bitrix project status

```text
/bitrix project-alpha
```

The server:

- checks Nikolay is OWNER;
- resolves project;
- calls Bitrix;
- summarizes tasks;
- returns status counts and top tasks.

### Nikolay requests Metricon activity

```text
/report today
```

The server:

- checks Nikolay is registered;
- resolves all accessible users;
- maps users to Metricon employee ids;
- asks Metricon for activity data;
- returns summary.

### Token usage report

```text
/tokens day
```

The bot returns token usage for last 24 hours, but only for the configured
recipient Telegram account.

---

## 13. Current Risks And Limitations

### JSON Storage

Current storage is a JSON file. It is okay for pilot, but should move to
PostgreSQL for production.

Risk:

- concurrent writes can become fragile as more agents send data;
- backups and migrations are manual;
- analytics can become slow with many events.

### Device Agents Only Send Heartbeat

Current agents do not do full local work.

Risk:

- seeing a device online does not mean OpenClaw is active;
- token usage will stay empty unless another component sends events;
- server cannot yet ask local agent to collect files/tasks/calendar.

### Offline Detection Is Manual

The server stores `lastSeenAt`, but status is not automatically recalculated to
offline.

Recommended next step:

- mark agents stale/offline if no heartbeat for 2-5 minutes.

### Telegram Registration Incomplete

Current live state:

- Nikolay is Telegram-linked.
- Maksat is not Telegram-linked.
- PM users are not Telegram-linked.

Impact:

- Maksat cannot yet use Telegram commands as his own actor.
- PM cannot yet use Telegram commands as own actor.
- Nikolay can still view everyone through owner actor.

### Metricon API Still Needs Final Confirmation

The Metricon connector supports access/refresh tokens and a report endpoint
shape, but final production endpoint mapping should be verified against the
actual Metricon Swagger and real account permissions.

### Bitrix Project Mapping Is Placeholder

Seeded project mappings use placeholder `bitrixGroupId` values.

Impact:

- real Bitrix reports require actual group/project IDs.

### No Full OpenClaw Bridge Yet

OpenClaw is cloned on devices, but not yet integrated as an executing local
runtime.

The `openclaw-client` capability currently means:

- device is prepared for future local bridge;
- it does not mean the bridge is already implemented.

---

## 14. Recommended Next Development Steps

### Step 1: Offline/Stale Status

Add server logic:

- online if last heartbeat < 2 minutes;
- stale if 2-10 minutes;
- offline if > 10 minutes.

Expose this in:

- `/api/v1/device-agents`;
- `/agents` Telegram command.

### Step 2: Register Maksat And PM Telegram Accounts

Nikolay should create invite codes.

Then:

- Maksat registers through `/register CODE`;
- PM registers through `/register CODE`.

After that, hierarchy can be tested through Telegram:

- Maksat sees himself and PM devices;
- PM sees only own device.

### Step 3: Real Bitrix Project Mapping

Replace placeholder group ids:

- `project-alpha -> real Bitrix group id`;
- `project-beta -> real Bitrix group id`;
- `project-gamma -> real Bitrix group id`.

### Step 4: Metricon Real Report Validation

Confirm:

- auth token/refresh flow;
- report endpoint;
- employee ID mapping;
- fields for active/idle/lock/app usage.

### Step 5: OpenClaw Bridge

Add a local bridge inside the device agent or alongside it.

Future bridge should:

- read central model policy;
- run OpenClaw with latest Sonnet;
- send token usage events;
- report active OpenClaw status;
- possibly accept safe commands from server;
- never expose secrets in logs.

### Step 6: Token Usage Auto-Ingest

Wire OpenClaw/Claude calls to:

```text
POST /api/v1/token-usage/events
```

Then reports become meaningful:

- which user spends the most tokens;
- which action spends the most;
- which model spends the most;
- daily/weekly/monthly Telegram summaries.

### Step 7: Production Database And Backups

Move from JSON to PostgreSQL.

Add:

- daily backups;
- migration scripts;
- restore runbook;
- audit retention policy.

---

## 15. What Claude Should Review

Claude should focus review on:

- `control-plane/src/api/router.js`
  - endpoint auth;
  - device heartbeat ingest;
  - token ingest;
  - actor handling.
- `control-plane/src/domain/device-agents.js`
  - payload validation;
  - hierarchy filtering;
  - public output shape.
- `control-plane/src/device-agent.js`
  - heartbeat payload;
  - env parsing;
  - timeout behavior;
  - token handling.
- `control-plane/scripts/install-device-agent-windows.ps1`
  - `-RunAsSystem`;
  - `C:\ProgramData` default path;
  - task principal and trigger.
- `control-plane/scripts/macos/install-device-agent.sh`
  - `--run-as-daemon`;
  - LaunchDaemon plist;
  - `UserName`;
  - replacement of user LaunchAgent.
- `control-plane/src/connectors/bitrix-client.js`
  - `tasks.task.list` call shape;
  - status normalization.
- `control-plane/src/connectors/kickidler-client.js`
  - Metricon refresh token behavior;
  - final endpoint mapping.
- `control-plane/src/domain/token-usage.js`
  - token event validation;
  - aggregation correctness.

Security review:

- no secrets in worklog/report;
- heartbeat endpoint still protected by ingest token;
- setup secrets encrypted at rest;
- Telegram commands enforce actor identity;
- OWNER-only functions stay OWNER-only.

---

## 16. Bottom Line

The current system is a working centralized agent control-plane MVP.

Server side:

- runs;
- accepts setup;
- protects secrets;
- enforces hierarchy;
- handles Telegram commands;
- records device heartbeats;
- exposes visible agents;
- supports Metricon/Bitrix report paths;
- supports token usage analytics ingest/reporting.

Device side:

- Maksat Mac is installed as a production LaunchDaemon client;
- PM Windows laptop is installed as a production SYSTEM scheduled task client;
- Nikolay Windows is installed as a production SYSTEM scheduled task client;
- all three devices are visible to Nikolay through the central server.

The biggest remaining gap is not installation. Installation is now working.

The biggest remaining product gap is turning the lightweight heartbeat clients
into real OpenClaw-connected worker agents that can send token usage, report
OpenClaw activity, and later perform safe role-scoped actions.
