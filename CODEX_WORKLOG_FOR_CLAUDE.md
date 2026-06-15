# Codex Worklog For Claude

This file is the handoff log for Claude review. Codex should update it whenever
the user asks for development work in this product effort.

## Ground Rules

- Do not modify `C:\Users\dasmu\agent\kickidler` unless the user explicitly allows it.
- Do not modify `C:\Users\dasmu\agent\openclaw` unless the user explicitly allows it.
- New integration work currently lives in `C:\Users\dasmu\agent\control-plane`.
- Treat this file as the review map: requested work, implemented work, verification, and open risks.

## 2026-06-02 - Initial Control Plane MVP

### User Request

Build the first development slice after analyzing Kickidler/OpenClaw. Keep
Kickidler source untouched. Claude will review the work later.

### Implemented

- Created standalone service: `C:\Users\dasmu\agent\control-plane`.
- Added pure Node.js HTTP API with no runtime dependencies.
- Added seeded hierarchy: Nikolay -> Maksat -> three PMs.
- Added roles: `OWNER`, `SENIOR_PM`, `PM`.
- Added RBAC policy helpers.
- Added one-time Telegram invite codes stored as SHA-256 hashes.
- Added Telegram registration API.
- Added accessible users/projects API.
- Added audit log.
- Added read-only Kickidler activity summary endpoint.
- Added mock Kickidler connector plus real HTTP connector shape.
- Added docs:
  - `control-plane\README.md`
  - `control-plane\docs\ARCHITECTURE.md`
  - `control-plane\docs\REVIEW_NOTES.md`
- Added tests for policy, invite codes, and reports.

### Verification

- `npm test` in `C:\Users\dasmu\agent\control-plane`: 10/10 passed.
- HTTP smoke test passed on `http://127.0.0.1:3099`.
- Kickidler git status was clean after work.
- OpenClaw had pre-existing `CLAUDE.md` changes; Codex did not touch them.

### Open Items

- Replace JSON store with Postgres before production.
- Add real Telegram Bot API polling/webhook process.
- Add Bitrix/Jira/Google connectors.
- Harden service-to-service auth before production.

## 2026-06-02 - Telegram Bot And Bitrix Connector

### User Request

Continue development. Add the next step and record all work in a file under
`C:\Users\dasmu\agent` so Claude knows what to review and what was requested.

### Planned

- Add Bitrix read-only connector and project report endpoint.
- Add Telegram Bot API polling runner and commands that call the control-plane domain layer.
- Add tests for the new logic.
- Re-run tests and smoke checks.

### Implemented

- Added `control-plane\src\connectors\bitrix-client.js`.
- Added `control-plane\src\domain\bitrix-reports.js`.
- Added HTTP endpoint:
  - `POST /api/v1/reports/bitrix/project-status`
- Added Bitrix mock mode and real webhook mode via `BITRIX_WEBHOOK_URL`.
- Added `projects.bitrixGroupId` seed mappings.
- Added `control-plane\src\telegram-bot.js`.
- Added Telegram modules:
  - `src\telegram\commands.js`
  - `src\telegram\handler.js`
  - `src\telegram\telegram-api.js`
- Added Telegram commands:
  - `/register CODE`
  - `/me`
  - `/users`
  - `/projects`
  - `/report today|week`
  - `/project PROJECT_ID today|week`
  - `/bitrix PROJECT_ID`
  - `/help`
- Updated README and architecture/review docs.
- Added tests:
  - `test\bitrix.test.js`
  - `test\telegram.test.js`

### Verification

- `npm test` in `C:\Users\dasmu\agent\control-plane`: 17/17 passed.
- Restarted HTTP service on `http://127.0.0.1:3099`.
- HTTP smoke passed:
  - `GET /health`
  - `POST /api/v1/reports/bitrix/project-status`
- Bitrix smoke used mock connector and returned project `project-alpha`, 4 tasks, 1 overdue.

### Status

Done. Ready for Claude review.

## 2026-06-05 - Current Active Worklog Pointer

Latest active implementation notes for Claude review are in the next section:
`2026-06-05 - Bitrix User Task Fallback for Begayym`.

Claude should review that section plus the current git diff.

## 2026-06-05 - Bitrix User Task Fallback for Begayym

### User Request

Maksat's agent answered that Begayym has zero Bitrix tasks because Project Alpha
is mapped to Bitrix group `101`. User reported the answer and asked to understand
why real Bitrix data is not returned correctly.

### Findings

- The answer was technically honest but too narrow:
  - project `project-alpha` uses placeholder `bitrixGroupId: 101`;
  - Bitrix has no tasks in that group for Begayym.
- Live read-only Bitrix lookup by responsible user found Begayym as Bitrix user
  `17`.
- Assigned tasks for Bitrix user `17`:
  - total: `3`
  - open: `0`
  - completed: `3`
  - groups: `93` and personal/no-group `0`
- Therefore the agent must not rely only on project group mappings. It also needs
  a user-level Bitrix task lookup by `RESPONSIBLE_ID`.

### Implemented

- Added `bitrixUserId` to public user data and seed users:
  - `u-maksat` -> `1`
  - `u-pm-1` / Begayym -> `17`
  - unknown users remain `null`.
- Added read-only Bitrix user task lookup:
  - `HttpBitrixClient.getUserTasks({ user, limit, includeClosed })`
  - calls only `tasks.task.list`
  - filters by `RESPONSIBLE_ID`
  - returns no data without network access if `bitrixUserId` is missing.
- Extended Bitrix task normalization with:
  - `groupId`
  - `stageId`
  - `createdBy`
- Extended free-form Telegram AI context:
  - keeps existing project Bitrix context;
  - adds `bitrixUserTasks` for target employees;
  - instructs Claude to prefer `bitrixUserTasks` for questions about a specific
    employee.
- Extended daily assistant:
  - `/today`
  - `/progress`
  - `/daily_report`
  now combine project tasks and assigned user tasks, with de-duplication by task
  ID.
- Added diagnostic metrics:
  - `projectBitrixTasks`
  - `assignedBitrixTasks`
- Kept Bitrix write/delete/update blocking intact through the read-only guard.

### Files Changed

- `control-plane\src\connectors\bitrix-client.js`
- `control-plane\src\infra\seed.js`
- `control-plane\src\domain\policy.js`
- `control-plane\src\assistant\company-assistant.js`
- `control-plane\src\domain\daily-assistant.js`
- `control-plane\test\bitrix.test.js`
- `control-plane\test\daily-assistant.test.js`
- `control-plane\test\telegram.test.js`

### Verification

- Local `npm test`: 50/50 passed.
- Server `npm test`: 23/23 passed.
- Production live Bitrix verification after setup/env load:
  - connector: `source=bitrix`, `configured=true`
  - Begayym user mapping: `u-pm-1.bitrixUserId = 17`
  - direct assigned Bitrix tasks: total `3`, open `0`, completed `3`
  - assigned task groups: `93`, `0`
  - `project-alpha` group `101`: total `0`
- Production daily assistant progress for Begayym:
  - `bitrixTasks = 3`
  - `assignedBitrixTasks = 3`
  - `projectBitrixTasks = 0`
  - `inProgressTasks = 0`
  - `overdueTasks = 0`

### Production Notes

- Deployed to the current production VPS.
- Existing production state file was backed up before changes.
- Updated production state:
  - set `users[u-maksat].bitrixUserId = 1`
  - set `users[u-pm-1].bitrixUserId = 17`
- Do not change project group IDs yet. Project group mapping still needs business
  confirmation; this change only fixes user-assigned task visibility.
- Restarted:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Both services are active after restart.

### Status

Done. Ready for Claude review.

## 2026-06-05 - Google Shared Calendar Lookup For PM Accounts

### User Request

The agent could not summarize Begayym's work schedule for June 1-5 because it
only read primary Google calendars. In Begayym's connected work account
`starlabpm@gmail.com`, employee schedules are stored under Google Calendar
"Other calendars" with names such as:

- `Бегайым PM`
- `Даниэл UX/UI`
- other employee calendars visible in the PM account.

The assistant must search those shared calendars when the user asks for an
employee schedule, even when that employee is not a first-class user in the
control-plane hierarchy.

### Implemented

- Extended Google OAuth integration to read:
  - primary calendar events;
  - Google `calendarList`;
  - matched shared/other calendar events.
- Added `GoogleOAuthService.readCalendarList`.
- Added `GoogleOAuthService.readSharedCalendarEvents`.
- Generalized `readCalendarEvents` so it can read any calendar ID, not only
  `primary`.
- Added calendar title matching by search terms:
  - case-insensitive;
  - tolerant to punctuation, spaces, `-`, `/`;
  - treats `ё` as `е`;
  - treats `э` as `е`;
  - includes a simple Latin-to-Cyrillic helper so queries like `Daniel UX UI`
    can match a calendar named `Даниэл UX/UI`.
- Extended free-form AI context:
  - builds `calendarSearchTerms` from the question and target user aliases;
  - for schedule/calendar questions, reads Google snapshots from target users
    plus accessible users in scope, so a PM account can act as a shared calendar
    source for employee calendars;
  - passes `sharedCalendars` into `googleWorkspace`.
- Added explicit date range parsing for questions like:
  - `с 1 по 5 июня`
  - `1-5 июня`
  - `с 01.06 по 05.06`
- Date ranges are normalized to Asia/Bishkek day boundaries (`+06:00`) before
  being sent to Google Calendar.
- Updated assistant prompt guidance:
  - for schedule/calendar questions, Claude should check
    `googleWorkspace.users[].sharedCalendars` before primary calendar events.

### Files Changed

- `control-plane\src\integrations\google-oauth.js`
- `control-plane\src\assistant\company-assistant.js`
- `control-plane\test\google-oauth.test.js`
- `control-plane\test\telegram.test.js`

### Verification

- Local `npm test`: 51/51 passed.
- Server `npm test`: 25/25 passed.
- Production live Google verification for `u-pm-1`:
  - connected account: `starlabpm@gmail.com`
  - scopes: `8`
  - calendarList count: `26`
  - API now reads `summaryOverride`, so visible UI names from "Other calendars"
    are available.
- Production shared calendar lookup for June 1-5:
  - `Бегайым ПМ`: matched, `8` events found.
  - `Даниэл UX/UI`: matched, `5` events found.
- Date range `с 1 по 5 июня` is normalized to:
  - from `2026-05-31T18:00:00.000Z`
  - to `2026-06-05T17:59:59.999Z`
  which is June 1-5 inclusive in Asia/Bishkek (`+06:00`).

### Production Notes

- Deployed to the current production VPS.
- Restarted:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Both services are active after restart.

### Status

Done. Ready for Claude review.

## 2026-06-05 - Bitrix New Webhook Capability Check

### User Request

Check what the currently saved Bitrix webhook can return.

### Live Check Results

- Webhook is configured and works.
- `scope` now returns broad permissions, including:
  - `task`
  - `tasks`
  - `tasks_extended`
  - `socialnetwork`
  - `crm`
  - `user`
  - `user_brief`
  - many other Bitrix scopes
- `profile` works and the webhook runs as:
  - Bitrix user ID `1`
  - name `Максат`
  - last name `Султаналиев`
- `tasks.task.getFields` works.
- `tasks.task.list` without filter works:
  - total tasks visible: `859`
  - returned first page: `50`
  - sample group IDs found in tasks: `57`, `99`, `1`
- Current local project mappings still return empty:
  - `project-alpha` -> `GROUP_ID=101`: `0`
  - `project-beta` -> `GROUP_ID=102`: `0`
  - `project-gamma` -> `GROUP_ID=103`: `0`
- Workgroup discovery:
  - `socialnetwork.api.workgroup.list`: works
  - total workgroups visible: `27`
  - examples:
    - `1` - `Найм`
    - `43` - `Kickidler`
    - `57` - `Платрум + ДТМ`
    - `77` - `KickAider - мониторинг рабочей активности`
    - `99` - `Сайт анализа звонков`
  - `sonet_group.get` still returned `insufficient_scope`, but the newer
    `socialnetwork.api.workgroup.list` is enough for discovery.
- Users:
  - `user.get`: works
  - `user.search`: works
  - total users visible: `62`
- CRM:
  - `crm.deal.list`: works
  - total deals visible: `2324`
  - first page returned: `50`
  - statuses include `NEW`, `EXECUTING`, etc.
  - `crm.status.list`: works

### Conclusion

The new webhook can read real Bitrix data. The remaining reason `/bitrix
project-alpha` returns empty is our placeholder local mapping, not Bitrix
permissions.

### Next Required Mapping Work

- Replace local `bitrixGroupId` placeholders `101/102/103` with real Bitrix
  group IDs.
- Need business decision from user:
  - which Starlab project should map to each Bitrix workgroup ID.
- Likely candidates seen in live data:
  - `57` - `Платрум + ДТМ`
  - `77` - `KickAider - мониторинг рабочей активности`
  - `99` - `Сайт анализа звонков`
  - plus other workgroups from the 27 returned groups.

### Safety Notes

- This webhook is high-privilege, but the deployed application has the Bitrix
  read-only guard in `HttpBitrixClient.callMethod`.
- Diagnostic checks only used read methods and did not print the webhook URL.
- Do not add Bitrix write methods or `batch` to the allowlist.

### Status

Diagnosis complete. Ready to map real Bitrix group IDs.

## 2026-06-05 - Bitrix Main Admin Webhook Recheck

### User Request

The Bitrix webhook was updated using the main admin account. Recheck what it
can return.

### Live Check Results

- Current saved Bitrix webhook is configured and works.
- Webhook profile:
  - Bitrix user ID `1`
  - `Максат Султаналиев`
- Scope is now broader than the previous webhook and includes:
  - `task`
  - `tasks`
  - `tasks_extended`
  - `socialnetwork`
  - `sonet_group`
  - `crm`
  - `user`
  - `user_brief`
  - many other admin-level scopes
- `tasks.task.getFields` works.
- `tasks.task.list` without filter works:
  - total visible tasks: `859`
  - first page returned: `50`
- Top visible task groups from paginated task scan:
  - group `1`: `122` tasks
  - group `63`: `104` tasks
  - group `57`: `98` tasks
  - group `67`: `86` tasks
  - group `55`: `80` tasks
  - group `65`: `61` tasks
  - group `77`: `61` tasks
  - group `37`: `50` tasks
  - group `13`: `46` tasks
  - group `99`: `4` tasks
- Current local placeholder mappings still return zero:
  - `project-alpha` -> `GROUP_ID=101`: `0`
  - `project-beta` -> `GROUP_ID=102`: `0`
  - `project-gamma` -> `GROUP_ID=103`: `0`
- Workgroup/project list works:
  - `socialnetwork.api.workgroup.list`: `27` groups
  - `sonet_group.get`: now works too, `27` groups
- User reads work:
  - `user.search`: total users `62`, first page `50`
- CRM reads work:
  - `crm.deal.list`: total deals `2324`, first page `50`

### Conclusion

The main-admin webhook is now fully useful for read-side integration. The
remaining blocker is not permission-related. The remaining blocker is local
project mapping: `101/102/103` are not real task group IDs for the projects we
want.

### Next Required Action

Ask the user to choose the real Bitrix workgroup IDs for the internal projects,
for example:

- `project-alpha` -> group `57` (`Платрум + ДТМ`)
- `project-beta` -> group `77` (`KickAider - мониторинг рабочей активности`)
- `project-gamma` -> group `99` (`Сайт анализа звонков`)

Actual mapping must be confirmed by business meaning, not guessed by Codex.

### Safety Notes

- Diagnostic calls used read-only methods only.
- Webhook URL and token were not printed.
- Production code still has the Bitrix read-only guard. Do not add write
  methods or `batch` to the allowlist.

### Status

Diagnosis complete. Ready for user-confirmed project mapping.

## 2026-06-05 - Metricon Missing Refresh Token Check

### User Request

Check whether Metricon may be returning no data because the setup has only the
Metricon URL and no refresh token.

### Findings

- Current production setup status:
  - Metricon base URL is configured.
  - Metricon access token is configured.
  - Metricon refresh token is not configured.
- The Metricon connector is in real HTTP mode, not mock mode:
  - `source`: `metricon`
  - `configured`: `true`
- Live read-only Metricon smoke request for one employee failed:
  - HTTP `401`
  - Metricon error code: `UNAUTHORIZED`
  - message: `Authentication required`
  - endpoint: `/api/v1/activity/report`

### Conclusion

Yes, the missing refresh token is very likely the reason Metricon does not
return real data now. The saved access token appears expired or invalid. Without
a refresh token, the connector cannot call `/api/v1/auth/refresh` to obtain a
new access token.

### Required Action

- Obtain and save a valid Metricon refresh token in `/setup`.
- Alternatively save a fresh access token, but this is fragile because access
  tokens are usually short-lived.
- After saving the refresh token, restart/reload services if the setup UI does
  not automatically apply it.

### Status

Diagnosis complete. Waiting for Metricon refresh token or fresh login flow.

## 2026-06-05 - Full Day Work Assistant Product Plan

### User Request

Create a plan for turning the current agent into a full daily assistant that
helps every employee throughout the workday, tracks task progress, monitors
timeliness, shows personal efficiency, and reports results up the hierarchy to
Nikolay.

### Created

- Added detailed Russian product/technical plan:
  - `DAILY_WORK_ASSISTANT_PLAN_RU.md`

### Plan Covers

- Daily assistant behavior for:
  - PM users;
  - Maksat as Senior PM;
  - Nikolay as Owner.
- Data sources:
  - Bitrix;
  - Jira;
  - Metricon;
  - Google Calendar;
  - Gmail;
  - Google Drive/Docs/Sheets.
- New data model:
  - `dailyWorkPlans`;
  - `taskSnapshots`;
  - `assistantCheckins`;
  - `assistantNudges`;
  - `workMetricsDaily`;
  - `managerReports`.
- Day cycle:
  - morning planning;
  - midday control;
  - afternoon progress check;
  - evening report.
- Efficiency scoring with confidence:
  - task completion;
  - deadlines;
  - focus/activity;
  - communication/check-ins.
- Telegram UX:
  - natural-language-first interaction;
  - future commands like `/today`, `/plan`, `/progress`, `/blocker`,
    `/daily_report`.
- AI roles:
  - daily planner;
  - progress coach;
  - risk detector;
  - manager reporter;
  - executive summary.
- Access hierarchy:
  - PM sees only self;
  - Maksat sees subordinate PMs;
  - Nikolay sees all.
- Implementation phases:
  - fix Metricon/Bitrix real data;
  - Daily plan MVP;
  - progress tracking;
  - evening reports;
  - risk detector;
  - dashboard;
  - Postgres migration.

### Status

Plan complete. No code implementation yet.

## 2026-06-05 - Full Day Assistant MVP Implementation

### User Request

Implement the daily assistant plan while the user works on the Bitrix webhook.
The assistant should help each employee throughout the day, track tasks,
monitor timeliness, show efficiency, and report results up to Nikolay.

### Implemented

- Added new state collections in seed:
  - `dailyWorkPlans`
  - `taskSnapshots`
  - `assistantCheckins`
  - `assistantNudges`
  - `workMetricsDaily`
  - `managerReports`
- Added daily assistant domain module:
  - `control-plane\src\domain\daily-assistant.js`
- Added daily assistant Telegram scheduler:
  - `control-plane\src\telegram\daily-assistant-reporter.js`
- Added Telegram commands:
  - `/today`
  - `/plan`
  - `/progress`
  - `/blocker`
  - `/done`
  - `/daily_report`
- Updated Telegram visible command menu with daily assistant commands.
- Updated `/help` with daily assistant instructions.
- Updated free-form Claude assistant context so normal text questions now also
  receive:
  - today's plan;
  - blockers;
  - daily metrics when available.

### Daily Assistant Behavior

- `/plan задача 1; задача 2` creates or replaces today's plan for the current
  user.
- `/done НОМЕР` marks one plan item complete.
- `/blocker текст` records a blocker and adds it to manager reports.
- `/today` and `/progress` build a current progress snapshot using:
  - manual plan;
  - Bitrix tasks, if available;
  - Metricon activity, if available;
  - blockers.
- `/progress USER_ID` lets Nikolay or Maksat inspect a visible employee inside
  hierarchy scope.
- `/daily_report` builds a day report for the actor's accessible scope:
  - PM sees self;
  - Maksat sees self and subordinate PMs;
  - Nikolay sees all.
- Efficiency score is calculated with confidence:
  - task completion;
  - deadline/overdue state;
  - Metricon active time;
  - communication/check-in signal.
- If Bitrix or Metricon data is missing, the report keeps working and marks
  lower confidence instead of inventing facts.

### Automation

- Telegram bot now calls `sendDueDailyAssistantMessages`.
- Automation can be disabled with:
  - `DAILY_ASSISTANT_AUTOMATION_ENABLED=false`
- Default behavior:
  - morning prompt asks each registered user to create `/plan`;
  - afternoon prompt asks user to check `/progress` or report `/blocker`;
  - evening prompt asks user to close the day with `/today` and `/done`;
  - manager report window sends daily report to OWNER/SENIOR_PM once per day.
- Duplicate prompts are prevented by `assistantCheckins`.
- Duplicate manager reports are prevented by `managerReports.sentAt`.

### Files Changed

- `control-plane\src\infra\seed.js`
- `control-plane\src\domain\daily-assistant.js`
- `control-plane\src\assistant\company-assistant.js`
- `control-plane\src\telegram\bot-commands.js`
- `control-plane\src\telegram\daily-assistant-reporter.js`
- `control-plane\src\telegram\handler.js`
- `control-plane\src\telegram-bot.js`
- `control-plane\test\daily-assistant.test.js`
- `control-plane\test\telegram.test.js`

### Verification

- Local `npm test`: 48/48 passed.
- Production VPS `npm test` on deployed test set: 21/21 passed.

### Deployment Notes

- Deployed to production VPS.
- Restarted:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Both services are active.
- Telegram bot log confirmed:
  - `telegram command menu synchronized (17 commands)`
- Direct Telegram API `getMyCommands` confirms the new daily assistant commands
  are visible.
- Production JSON state was lazily initialized with the new daily assistant
  arrays.

### Status

Done. Ready for Claude review.

## 2026-06-05 - Bitrix Empty Data Investigation

### User Request

Find out why Bitrix does not return task data even though the data exists in
the Bitrix portal.

### Investigation

- Checked local implementation:
  - `control-plane\src\connectors\bitrix-client.js`
  - `control-plane\src\domain\bitrix-reports.js`
  - `control-plane\src\infra\seed.js`
- Current connector calls:
  - `tasks.task.list`
  - with `filter: { GROUP_ID: project.bitrixGroupId }`
- Current local project mappings are placeholder-like values:
  - `project-alpha` -> `bitrixGroupId: 101`
  - `project-beta` -> `bitrixGroupId: 102`
  - `project-gamma` -> `bitrixGroupId: 103`

### Live Bitrix Checks On Production VPS

- Bitrix webhook is configured and responds.
- `profile` works and shows the webhook runs as Bitrix user:
  - ID `141`
  - name `agent ai`
- `scope` returns only:
  - `task`
- `tasks.task.getFields` works, confirming the `task` scope itself is active.
- `tasks.task.list` with no filters returns:
  - `total: 0`
  - `returned: 0`
- `tasks.task.list` with each local project group ID returns:
  - `GROUP_ID=101`: `0`
  - `GROUP_ID=102`: `0`
  - `GROUP_ID=103`: `0`
- Workgroup/project discovery fails:
  - `sonet_group.get`: `insufficient_scope`
  - `socialnetwork.api.workgroup.list`: `insufficient_scope`
- CRM Kanban discovery fails:
  - `crm.deal.list`: `insufficient_scope`
  - `crm.status.list`: `insufficient_scope`
- User lookup fails:
  - `user.get`: `insufficient_scope`

### Root Cause

The Bitrix API is not failing in the code path. The current webhook is too
limited and/or belongs to a user that cannot see the existing tasks.

There are two separate blockers:

1. The webhook has only `task` scope. It cannot read workgroups/projects,
   users, or CRM Kanban.
2. The webhook user `agent ai` currently sees zero tasks even with no
   `GROUP_ID` filter. That means this user is not a participant/observer/member
   of the existing task data, or the visible work is stored outside Bitrix Tasks
   such as CRM Kanban/deals.

### Required Fix In Bitrix

- Recreate or edit the incoming webhook from a user with real access, preferably
  the Bitrix admin or a dedicated AI user that is added to all needed projects.
- Grant scopes:
  - `task`
  - `sonet`
  - `user_brief`
  - `crm` if the company Kanban is CRM deals/leads instead of Tasks project
    Kanban
- Add the AI user to every Bitrix workgroup/project whose tasks should be
  visible, or create the webhook under an admin account that can see them.
- After scopes/access are fixed, discover real Bitrix group IDs and replace the
  placeholder local mappings `101/102/103`.

### Status

Diagnosis complete. Waiting for Bitrix webhook/access update before code can
return real task data.

## 2026-06-05 - Bitrix Read-Only Guard Before Admin Webhook

### User Request

Before replacing the Bitrix webhook with a high-privilege/admin webhook, make
sure the product cannot edit, change, delete, or otherwise mutate anything in
Bitrix.

### Implemented

- Checked the codebase for direct Bitrix webhook calls.
- Found only one application entry point:
  - `control-plane\src\connectors\bitrix-client.js`
- Added a strict read-only allowlist:
  - `READ_ONLY_BITRIX_METHODS`
  - `assertReadOnlyBitrixMethod`
- `HttpBitrixClient.callMethod()` now validates every Bitrix REST method before
  any network request.
- If a method is not explicitly allowed, the client throws:
  - `Bitrix REST method is blocked by read-only guard`
- Blocked by default:
  - `tasks.task.add`
  - `tasks.task.update`
  - `tasks.task.delete`
  - `crm.deal.update`
  - `crm.deal.delete`
  - `batch`
  - any other non-allowlisted Bitrix REST method
- Allowed methods are read/discovery only, for example:
  - `profile`
  - `scope`
  - `tasks.task.list`
  - `tasks.task.get`
  - `tasks.task.getFields`
  - `sonet_group.get`
  - `socialnetwork.api.workgroup.list`
  - `user.get`
  - `crm.deal.list`
  - `crm.status.list`

### Files Changed

- `control-plane\src\connectors\bitrix-client.js`
- `control-plane\test\bitrix.test.js`

### Verification

- Local `npm test`:
  - first run had one unrelated Windows temp-file `EPERM rename` flake in
    `setup-service.test.js`;
  - immediate rerun passed: 45/45.
- Production VPS deploy:
  - copied updated Bitrix client and tests;
  - server-side `npm test`: passed for available deployed tests.
- Restarted production services:
  - `company-control-plane-api.service`: active
  - `company-control-plane-telegram-bot.service`: active
- Production smoke:
  - `tasks.task.list` allowed by guard;
  - `tasks.task.update` blocked by guard before any real Bitrix request.

### Operational Notes

- It is now safer to paste a higher-privilege Bitrix webhook into `/setup`.
- The webhook should still be treated as a secret and should still be created
  with the minimum scopes needed for reading:
  - `task`
  - `sonet`
  - `user_brief`
  - `crm` only if the company Kanban is CRM-based
- If future development needs another Bitrix read method, add it deliberately to
  `READ_ONLY_BITRIX_METHODS` with a test.
- Do not add `batch`; it can tunnel write calls.

### Status

Done. Ready for Claude review.

## 2026-06-05 - PM1 Google OAuth 502 Fix After VPS Migration

### User Request

After registering PM1/Begayym and approving Google OAuth, the browser opened
`/api/v1/google/oauth/callback` and showed `502 Bad Gateway`.

### Root Cause

- The domain had already been moved to the new Germany VPS, but the user's
  browser/network still had the old Hong Kong VPS IP cached.
- The old VPS still had Nginx running with a valid `starlabagent.pp.ua`
  certificate, but the old `company-control-plane-api.service` had been stopped
  after migration.
- Because of that, Google sent the OAuth callback to old Nginx, and old Nginx
  tried to proxy to the stopped old local API at `127.0.0.1:3099`, producing
  `502 Bad Gateway`.

### Implemented

- Confirmed the new Germany VPS API and public callback endpoint were healthy:
  - local API `/health`: OK
  - public `/api/v1/google/oauth/callback`: returns expected validation page
    when no code is provided
- Confirmed PM1 was registered in Telegram but Google was not connected yet.
- Checked old Hong Kong VPS logs and found the failed PM1 Google OAuth callback
  request was received there.
- Reconfigured old Hong Kong VPS Nginx as a temporary reverse proxy/forwarder to
  the new Germany VPS:
  - old HTTP and HTTPS traffic for `starlabagent.pp.ua` now proxies to the new
    VPS;
  - SNI/Host are preserved as `starlabagent.pp.ua`;
  - this protects OAuth callbacks and device heartbeats while clients still have
    old DNS cached.
- Removed the stray backup site file from old `sites-enabled` to stop duplicate
  server-name conflicts.
- Replayed the already-approved PM1 OAuth callback from the old Nginx access log
  through the new server without printing the callback URL or secrets.

### Verification

- Old-IP forced callback smoke:
  - `https://starlabagent.pp.ua/api/v1/google/oauth/callback` via old IP now
    reaches the new server and returns expected `400 code is required`, not 502.
- New server PM1 Google status:
  - `userId`: `u-pm-1`
  - `connected`: `true`
  - `account`: `starlabpm@gmail.com`
  - `scopes`: `8`
- New server PM1 Google API smoke:
  - Calendar: OK
  - Gmail: OK
  - Drive: OK
  - Docs/Sheets: no separate read block in this smoke snapshot; no callback or
    token failure found.
- New server `company-control-plane-api.service` stayed active.
- New server `company-control-plane-telegram-bot.service` stayed active.

### Notes For Claude

- The old VPS is now intentionally acting as a compatibility proxy after the
  migration. Do not remove it until DNS caches and any old device-agent configs
  are confirmed clean.
- The old API service should remain stopped to avoid split-brain writes.
- OAuth callback URLs contain one-time Google codes and must not be copied into
  docs, commits, or chat responses.

### Status

Done. Ready for Claude review.

## 2026-06-04 - Telegram Claude Assistant And Per-User Google OAuth Runtime

### User Request

Implement the next product step immediately:

- Telegram bot should work as a universal assistant, not only command bot.
- Users should be able to ask natural Russian questions like "How did this PM
  work today?"
- The bot should call Claude API, answer from Metricon/Bitrix/device context,
  and respect hierarchy permissions.
- Google OAuth must be understandable and usable per employee.
- The server must store Google credentials safely and then use employee Google
  data in assistant context.

### Implemented

- Added Claude client:
  - `control-plane\src\assistant\claude-client.js`
  - reads `CLAUDE_API_KEY` / `ANTHROPIC_API_KEY`
  - uses enforced latest Sonnet env policy through `CLAUDE_MODEL`
  - normalizes Anthropic token usage from responses
- Added company assistant:
  - `control-plane\src\assistant\company-assistant.js`
  - resolves Telegram actor
  - applies hierarchy scope
  - collects visible users/devices/projects
  - collects Metricon context
  - collects Bitrix task context
  - collects Google Workspace context where employees are connected
  - sends only scoped JSON context to Claude
  - records `telegram.assistant.ask` audit events
  - records `telegram.assistant` token usage events
- Updated Telegram bot behavior:
  - plain text without `/` now goes to the Claude assistant
  - `/help` now documents this behavior
  - user-facing Telegram strings were moved to Russian where relevant
- Added per-user Google OAuth service:
  - `control-plane\src\integrations\google-oauth.js`
  - one app-level Google OAuth client JSON is stored through setup
  - each employee connects individually through OAuth consent
  - per-user refresh token is encrypted in the existing SecretStore
  - OAuth callback state is signed and expires after 15 minutes
  - access token refresh is automatic before Google API calls
- Added Telegram Google commands:
  - `/google_connect`
  - `/google_status`
  - `/google_disconnect`
- Added Google API endpoints:
  - `GET /api/v1/google/oauth/start`
  - `GET /api/v1/google/oauth/callback`
  - `GET /api/v1/google/status`
  - `GET /api/v1/google/workspace-snapshot`
  - `POST /api/v1/google/oauth/disconnect`
- Google Workspace snapshot currently reads:
  - Calendar events for the selected period
  - Gmail message metadata for the selected period
  - latest Drive files
- Google snapshot access follows the same hierarchy:
  - OWNER can read all connected employees
  - SENIOR_PM can read self and subordinate PMs
  - PM can read only self
- Updated docs:
  - `TELEGRAM_AI_ASSISTANT_AND_GOOGLE_OAUTH_RU.md`
  - `control-plane\README.md`

### Not Implemented Yet

- Reading full Google Docs document content.
- Reading full Google Sheets cell content.
- Sending Gmail messages.
- Editing Google Calendar/Drive/Docs/Sheets.
- Web dashboard for Google connection management.

### Verification

- `node --check` passed for:
  - `src\integrations\google-oauth.js`
  - `src\assistant\company-assistant.js`
  - `src\assistant\claude-client.js`
  - `src\api\router.js`
  - `src\telegram\handler.js`
  - `src\telegram-bot.js`
  - `src\server.js`
- `npm test`: 35/35 passed.
- Tests cover:
  - encrypted per-user Google refresh token storage
  - OAuth callback state flow
  - Google Calendar/Gmail/Drive snapshot normalization
  - Telegram free-form assistant question path
  - Google context being included in Claude prompt
  - token usage event recording for assistant responses

### Deployment Notes For Claude

- Deployed to VPS `/opt/company-control-plane` after local verification.
- Restarted:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Both services were active after restart.
- Local VPS health check passed:
  - `GET http://127.0.0.1:3099/health`
- Added Nginx public callback exception:
  - `location = /api/v1/google/oauth/callback`
  - `auth_basic off`
- Public callback smoke check returned HTTP 400 without Basic Auth, which is
  expected when no Google `code/state` is supplied.
- Public `/health` still returned HTTP 401, so the rest of the external API/UI
  remains behind Basic Auth.
- Runtime Google smoke checks passed with Nikolay's currently linked Telegram
  actor:
  - `GET /api/v1/google/status` -> connected false before user OAuth
  - `GET /api/v1/google/workspace-snapshot` -> connected false before user OAuth
  - `GET /api/v1/google/oauth/start` -> validation error because Google OAuth
    client JSON is not configured yet
- Google callback must be reachable publicly at:
  - `https://starlabagent.pp.ua/api/v1/google/oauth/callback`
- This callback should not require Nginx Basic Auth, otherwise employees cannot
  finish Google consent in a browser.
- The setup wizard still needs one Google OAuth client JSON from Google Cloud.
- Every employee then connects their own Google account with `/google_connect`.

### Open Risks

- JSON file storage is still MVP storage; production should move to a proper DB.
- Google scopes are broad read-only scopes and must be explained on the Google
  consent screen.
- Google OAuth app may require verification depending on Google Workspace/org
  policy and chosen scopes.
- Full Docs/Sheets content ingestion is intentionally deferred to avoid pulling
  too much data into Claude before we design limits and redaction.

### Status

Implemented locally and deployed to VPS. Ready for Claude review.

## 2026-06-04 - Google Docs And Sheets Content For Assistant Context

### User Request

User asked to finish the remaining expected work after the Telegram AI assistant
and Google OAuth implementation.

### Implemented

- Extended Google Workspace snapshot in:
  - `control-plane\src\integrations\google-oauth.js`
- The snapshot now reads limited content from Google file types returned by
  Drive:
  - Google Docs via Docs API
  - Google Sheets via Sheets API
- Added safe limits to avoid sending huge files into Claude:
  - up to 4 Docs/Sheets files per snapshot by default
  - up to 2500 characters per Google Doc by default
  - up to 20 rows and 8 columns from the first sheet by default
- The existing assistant context now includes:
  - Calendar events
  - Gmail metadata
  - Drive metadata
  - Docs snippets
  - Sheets first rows
- Updated the assistant prompt in:
  - `control-plane\src\assistant\company-assistant.js`
  so Claude is told to be honest when Docs/Sheets content is limited.
- Updated tests in:
  - `control-plane\test\google-oauth.test.js`
  to verify Docs text and Sheets rows are normalized into the snapshot.
- Updated docs:
  - `TELEGRAM_AI_ASSISTANT_AND_GOOGLE_OAUTH_RU.md`
  - `control-plane\README.md`

### Verification

- `node --check` passed for:
  - `src\integrations\google-oauth.js`
  - `src\assistant\company-assistant.js`
- `npm test`: 35/35 passed.
- Deployed runtime changes to VPS:
  - `/opt/company-control-plane/src/integrations/google-oauth.js`
  - `/opt/company-control-plane/src/assistant/company-assistant.js`
- On VPS:
  - `node --check` passed for both deployed files
  - restarted `company-control-plane-api.service`
  - restarted `company-control-plane-telegram-bot.service`
  - both services were active after restart
  - `GET http://127.0.0.1:3099/health` passed
  - `GET /api/v1/google/workspace-snapshot` returned expected
    `connected=false` response before Google OAuth user connection

### Not Implemented Yet

- Sending Gmail messages.
- Editing Google Calendar/Drive/Docs/Sheets.
- Web dashboard for Google connection management.
- Semantic project-to-document matching. Current implementation reads recent
  Drive Docs/Sheets in limited form; later we should map documents to projects
  more precisely.

### Status

Implemented locally and deployed to VPS. Ready for Claude review.

## 2026-06-04 - Telegram Owner Invite Command

### User Request

Make it convenient and clear for Nikolay to create registration codes directly
through the Telegram bot, instead of using curl/API manually.

### Implemented

- Added Telegram command:
  - `/invite`
  - `/invite USER_ID`
- `/invite` returns a clear list of employees and whether each Telegram account
  is already linked.
- `/invite USER_ID` creates a one-time invite code for the target user.
- Supported target aliases include:
  - exact `userId`, for example `u-maksat`
  - employee id, for example `maksat`
  - compact ids such as `pm1`
- The command returns a ready-to-forward instruction:
  - `/register CODE`
  - then `/google_connect`
- The command keeps the existing security rule:
  - only `OWNER` can create invite codes
  - PM/SENIOR_PM attempts are rejected by the existing invite policy
- The handler refuses to create a new invite for a user who is already linked to
  Telegram.
- Added audit event:
  - `telegram.invite.create`

### Files Changed

- `control-plane\src\telegram\handler.js`
- `control-plane\test\telegram.test.js`
- `control-plane\README.md`
- `TELEGRAM_AI_ASSISTANT_AND_GOOGLE_OAUTH_RU.md`

### Verification

- `node --check src\telegram\handler.js` passed.
- `npm test`: 37/37 passed.
- Tests cover:
  - Nikolay creating an invite through Telegram
  - target user registering with that generated code
  - `/invite` help/list output
  - non-owner invite creation rejection
- Deployed to VPS:
  - `/opt/company-control-plane/src/telegram/handler.js`
- On VPS:
  - `node --check src/telegram/handler.js` passed
  - restarted `company-control-plane-telegram-bot.service`
  - bot service was active after restart
  - fresh log shows `telegram bot polling started`

### Status

Implemented locally and deployed to VPS. Ready for Claude review.

## 2026-06-04 - Claude API 403 Diagnostics In Telegram

### User Request / Incident

Nikolay and Maksat could register and connect Google, but free-form Telegram
messages like "привет" and "Какие задачи сейчас у Максата?" returned:

```text
Ошибка: Request not allowed
```

### Diagnosis

- Tested Anthropic API directly from the VPS using the configured server env.
- API key is configured.
- Current model env:
  - `CLAUDE_MODEL=claude-sonnet-4-6`
- Anthropic returned HTTP 403:
  - error type: `forbidden`
  - message: `Request not allowed`
- `/v1/models` also returned the same 403, so this is not only a bad prompt or
  Bitrix/Google problem.
- Likely causes to review in Anthropic Console:
  - API key/workspace does not have API access
  - billing/credits are not enabled
  - account/key is restricted
  - server/account region is not allowed by Anthropic policy
  - key was created in the wrong workspace/org

### Implemented

- Added structured Claude API errors in:
  - `control-plane\src\assistant\claude-client.js`
- Added Claude health check method:
  - reports configured state, model, HTTP status, error type, request id
- Added Telegram command:
  - `/ai_status`
- Free-form Telegram AI errors now produce a clear Russian explanation instead
  of raw `Request not allowed`.
- `/help` now lists `/ai_status`.

### Files Changed

- `control-plane\src\assistant\claude-client.js`
- `control-plane\src\telegram\handler.js`
- `control-plane\test\telegram.test.js`

### Verification

- `node --check` passed for:
  - `src\assistant\claude-client.js`
  - `src\telegram\handler.js`
- `npm test`: 39/39 passed.
- Tests cover:
  - `/ai_status` returning a clear 403 diagnostic
  - free-form Claude 403 errors being explained clearly
- Deployed to VPS:
  - `/opt/company-control-plane/src/assistant/claude-client.js`
  - `/opt/company-control-plane/src/telegram/handler.js`
- On VPS:
  - `node --check` passed for both deployed files
  - restarted `company-control-plane-api.service`
  - restarted `company-control-plane-telegram-bot.service`
  - both services were active after restart
  - `GET http://127.0.0.1:3099/health` passed

### Status

Implemented locally and deployed to VPS. Ready for Claude review.

## 2026-06-05 - Full VPS Migration From Hong Kong To Germany

### User Request

Move the whole production setup from the old Hong Kong VPS to a new German VPS,
keeping everything one-to-one:

- same domain `starlabagent.pp.ua`
- same service setup values
- same encrypted secrets
- same Telegram registrations
- same Google OAuth tokens
- same Bitrix/Metricon/Claude configuration
- same runtime state

### Servers

- Old VPS:
  - `114.29.236.103`
  - Geo seen by IP services: Hong Kong
  - Problem: Anthropic API returned HTTP 403 `Request not allowed`
- New VPS:
  - `195.238.122.228`
  - Germany
  - Host fingerprint used for SSH verification:
    - `ssh-ed25519 255 SHA256:yb/AtQRMBCn+sOxGG4iX4oLI3o1AHIlo+xAhsIbygyU`

### Migrated Data

Created a migration archive from the old VPS containing:

- `/opt/company-control-plane`
- `/var/lib/company-control-plane`
- `/etc/company-control-plane`
- `company-control-plane-api.service`
- `company-control-plane-telegram-bot.service`
- Nginx Basic Auth file

Important migrated runtime files:

- `/var/lib/company-control-plane/control-plane.json`
- `/var/lib/company-control-plane/runtime-config.json`
- `/var/lib/company-control-plane/secrets.json`
- `/var/lib/company-control-plane/secrets.key`

`secrets.json` and `secrets.key` were moved together, so encrypted secrets can
still be decrypted on the new server.

### New Server Setup

Installed/configured:

- Ubuntu 22.04 server dependencies
- Node.js `v22.22.3`
- Nginx
- certbot
- system user `company-control-plane`
- systemd API service
- systemd Telegram bot service

Issued a fresh Let's Encrypt certificate for:

- `starlabagent.pp.ua`

Certificate path:

- `/etc/letsencrypt/live/starlabagent.pp.ua/fullchain.pem`
- `/etc/letsencrypt/live/starlabagent.pp.ua/privkey.pem`

Nginx final behavior:

- HTTP redirects to HTTPS
- Basic Auth remains enabled for protected UI/API
- public exception remains for:
  - `/api/v1/device-agents/heartbeat`
  - `/api/v1/google/oauth/callback`

### Final State Sync

After migration, the old server still received a few device heartbeat updates.
To avoid state divergence:

- stopped old `company-control-plane-telegram-bot.service`
- stopped old `company-control-plane-api.service`
- copied the final old `/var/lib/company-control-plane/control-plane.json`
  to the new server
- restarted new API and Telegram bot
- verified the final `control-plane.json` SHA256 matched after copy

### Verification

DNS:

- `starlabagent.pp.ua` resolves to `195.238.122.228`

External checks:

- `https://starlabagent.pp.ua/health` returns HTTP 401 as expected because it is
  protected by Basic Auth
- `https://starlabagent.pp.ua/api/v1/google/oauth/callback` returns HTTP 400
  without Basic Auth, which is expected when no Google OAuth `code/state` is
  provided
- TCP 80 and 443 are open on the new domain/IP

Services on new VPS:

- `company-control-plane-api.service`: active
- `company-control-plane-telegram-bot.service`: active
- `nginx`: active

Setup/secrets on new VPS:

- setup reports configured true
- Telegram bot token configured
- Metricon/Kickidler access token configured
- Bitrix webhook configured
- Claude API key configured
- Google OAuth client JSON configured

Claude:

- Direct health check from new German VPS:
  - `ok=true`
  - model `claude-sonnet-4-6`
  - HTTP 200
  - message `Claude API is available.`

Google:

- encrypted secret keys exist for:
  - `googleOAuthTokens:u-nikolay`
  - `googleOAuthTokens:u-maksat`
- Google Workspace snapshot smoke checks:
  - Nikolay connected true
  - Maksat connected true
  - Calendar/Gmail/Drive/Docs/Sheets snapshot routes responded
  - no secret/token values were printed

Bitrix:

- project status endpoint responded with source `bitrix`

Users:

- `u-nikolay` Telegram linked
- `u-maksat` Telegram linked
- PM users remain in state and are not yet Telegram-linked unless registered
  later

Cleanup:

- Removed temporary migration archive from local machine
- Removed temporary copied state file from local machine
- Removed migration archive from `/tmp` on servers

### Notes / Follow-Up

- `maksat-mac-mini` was still heartbeating to the old server shortly after DNS
  change. Old API is now stopped and final state was copied to the new server.
  If device heartbeats do not resume on the new server after DNS cache expires,
  device-agent config on that machine may still point to the old IP and should
  be updated to `https://starlabagent.pp.ua`.
- Old VPS services are stopped. Keep the old VPS for a short rollback window,
  then decommission it once the new server is stable.

### Status

Migration complete. New German VPS is production-active. Ready for Claude
review.

---

## 2026-06-04 - Nikolay Windows Device Agent Finished To Current Production MVP

### User Request

Finish Nikolay's computer to a fully working state for the current centralized
architecture.

Important context:

- The Linux VPS is the authoritative central server.
- Nikolay is the OWNER in the hierarchy.
- Nikolay's Windows computer is now a client device, not the central API server.
- Do not push to GitHub.
- Do not modify OpenClaw upstream source.
- Do not modify Metricon proprietary source.

### What Was Found

- Nikolay's DHCP IP changed to `192.168.1.199`.
- SSH access to Nikolay's Windows host worked with the operator-provided account.
- Hostname on Nikolay's machine: `WIN-5IMJD8NIIM7`.
- The old user-level Windows Scheduled Task existed but was not reliable:
  - `CompanyControlPlaneDeviceAgent`
  - previous mode: user logon task
  - previous state: `Ready`
  - previous result: non-zero
- Old local full-control-plane tasks also existed on Nikolay's machine:
  - `CompanyControlPlaneApi`
  - `CompanyControlPlaneTelegramBot`
- Those old local API/bot tasks are obsolete for the current Linux-server
  architecture because the central VPS owns API, Telegram bot, setup, and
  reporting.

### Implemented

- Added a heartbeat request timeout to the device agent:
  - `control-plane\src\device-agent.js`
  - env/config name: `DEVICE_AGENT_HEARTBEAT_TIMEOUT_MS`
  - default: `20000`
- Added BOM stripping for env keys in the device agent so Windows-written env
  files do not break config parsing.
- Added production Windows client install support:
  - `control-plane\scripts\install-device-agent-windows.ps1`
  - new flag: `-RunAsSystem`
- `-RunAsSystem` registers the device agent as:
  - task name: `CompanyControlPlaneDeviceAgent`
  - account: `SYSTEM`
  - trigger: at startup
  - run level: highest
  - install dir: `C:\ProgramData\CompanyControlPlaneAgent`
- Updated docs so future installs use the same reliable Windows client flow:
  - `control-plane\README.md`
  - `control-plane\docs\DEVICE_INSTALL_CHECKLIST.md`
  - `control-plane\docs\WINDOWS_INSTALL.md`

### Work Done On Nikolay's Computer

- Uploaded the latest local device-agent code and Windows installer script to
  Nikolay's clone:
  - `C:\Users\dasmu\agent\openclawagent\control-plane\src\device-agent.js`
  - `C:\Users\dasmu\agent\openclawagent\control-plane\package.json`
  - `C:\Users\dasmu\agent\openclawagent\control-plane\scripts\install-device-agent-windows.ps1`
- Disabled obsolete local full-server tasks on Nikolay:
  - `CompanyControlPlaneApi`
  - `CompanyControlPlaneTelegramBot`
- Reinstalled Nikolay's lightweight device agent as a `SYSTEM` startup task.
- The agent now runs from:
  - `C:\ProgramData\CompanyControlPlaneAgent`
- Portable Node.js is used from:
  - `C:\ProgramData\CompanyControlPlaneAgent\node\node.exe`
- Device identity used for Nikolay:
  - `deviceId`: `nikolay-windows`
  - `userId`: `u-nikolay`
  - role label: `OWNER`
  - person label: `Nikolay`
  - mode label: `system`

### Verification

- Local tests after code changes:
  - `npm test`: 33/33 passed.
  - `node --check src/device-agent.js`: passed.
  - PowerShell parser check for `install-device-agent-windows.ps1`: passed.
- Nikolay Windows task verification:
  - `CompanyControlPlaneDeviceAgent`: `Running`
  - `CompanyControlPlaneApi`: `Disabled`
  - `CompanyControlPlaneTelegramBot`: `Disabled`
  - old local Node processes for full control-plane were gone
  - only the device-agent Node process remained
- Nikolay log verification:
  - stdout showed successful heartbeats
  - stderr was empty
- Central server verification:
  - `nikolay-windows` appeared in `/api/v1/device-agents`
  - `hostname`: `WIN-5IMJD8NIIM7`
  - `platform`: `win32`
  - `heartbeatCount`: `101`
  - `lastSeenAt`: fresh on `2026-06-04`

### Fresh Verification After Documentation Update

- VPS API service:
  - `company-control-plane-api.service`: `active`
  - `/health`: `ok: true`
- Nikolay Windows scheduled tasks:
  - `CompanyControlPlaneDeviceAgent`: running
  - `CompanyControlPlaneApi`: disabled
  - `CompanyControlPlaneTelegramBot`: disabled
- Nikolay device-agent logs:
  - stdout tail showed successful heartbeat counts `105` through `109`
  - stderr log length was `0`
- Central state file showed:
  - `deviceId`: `nikolay-windows`
  - `userId`: `u-nikolay`
  - `hostname`: `WIN-5IMJD8NIIM7`
  - `platform`: `win32`
  - `lastSeenAt`: `2026-06-04T08:58:48.468Z`
  - `heartbeatCount`: `109`
  - labels include `role=OWNER`, `person=Nikolay`, `mode=system`
- Local verification repeated after docs/worklog edits:
  - `npm test`: 33/33 passed
  - `node --check src/device-agent.js`: passed
  - PowerShell parser check for `install-device-agent-windows.ps1`: passed
  - `git diff --check`: no whitespace errors; only expected CRLF warnings

### Claude Review Notes

Review focus:

- Confirm `-RunAsSystem` logic in
  `control-plane\scripts\install-device-agent-windows.ps1`.
- Confirm Windows env-file parsing remains compatible after BOM stripping in
  `control-plane\src\device-agent.js`.
- Confirm docs consistently describe the Linux VPS as central and Nikolay
  Windows as a client device.
- Confirm no secrets were written into this worklog.

### Remaining Work Outside Nikolay's Current MVP

- Maksat's Mac agent should be checked later because the server previously
  showed a stale `lastSeenAt` for `maksat-mac-mini`.
- Begayym/PM device is not installed yet.
- Full OpenClaw local bridge behavior is not implemented yet; current device
  agent is the lightweight heartbeat/visibility client for the centralized
  architecture.

### Status

Nikolay's Windows computer is complete for the current production MVP:
centralized Linux server, OWNER device visible to the server, heartbeat running
as `SYSTEM`, and obsolete local full-server tasks disabled.

---

## 2026-06-04 - PM Windows Laptop Device Agent Installed

### User Request

Connect to the PM laptop and bring it to a fully working state:

- SSH target: `User@192.168.1.228`
- User provided a short PIN/password for SSH.
- Clone required repositories.
- Install everything needed so the device works in the current centralized
  architecture.
- Continue logging work for Claude review.

### Assumption

- The PM laptop was treated as Begayym's PM device because the previous rollout
  notes said Begayym PM was not installed yet.
- Device/user mapping used:
  - `userId`: `u-pm-1`
  - `deviceId`: `begayym-windows`
  - display name: `Begayym Windows`

### Access And Host Facts

- SSH succeeded after accepting the new host fingerprint explicitly.
- Hostname: `DESKTOP-M780PPS`.
- OS: Windows 11 Pro.
- Windows user: `User`.
- Admin rights: yes.
- Git: installed.
- Global Node.js: not installed.
- Existing device-agent task: not present before installation.

### Repositories Cloned On PM Laptop

Created:

- `C:\Users\User\agent`

Cloned:

- `C:\Users\User\agent\openclawagent`
  - repo: `https://github.com/dasbkdev/openclawagent.git`
  - branch: `server`
  - checked commit: `bea5ca0`
- `C:\Users\User\agent\openclaw`
  - repo: `https://github.com/openclaw/openclaw.git`
  - depth: `1`
  - checked commit: `5a869eea`

Because GitHub may not contain the latest local device-agent fixes yet, the
latest local files were copied onto the PM laptop clone:

- `control-plane\src\device-agent.js`
- `control-plane\scripts\install-device-agent-windows.ps1`
- `control-plane\package.json`

### Installer Bug Found And Fixed

During the first PM install attempt, `-RunAsSystem` registered a `SYSTEM` task
but still used the user-level default install path:

- `C:\Users\User\AppData\Local\CompanyControlPlaneAgent`

That is not the desired production shape. The installer was fixed locally:

- file: `control-plane\scripts\install-device-agent-windows.ps1`
- change: when `-RunAsSystem` is used and no explicit `-InstallDir` is supplied,
  default install dir is now:
  - `C:\ProgramData\CompanyControlPlaneAgent`
- non-system installs still default to:
  - `%LOCALAPPDATA%\CompanyControlPlaneAgent`

The updated script was uploaded to the PM laptop before the final reinstall.

### Final PM Installation

Installed the lightweight PM device agent as:

- task name: `CompanyControlPlaneDeviceAgent`
- principal: `SYSTEM`
- run level: `Highest`
- trigger count: `1`
- install dir:
  - `C:\ProgramData\CompanyControlPlaneAgent`
- runner:
  - `C:\ProgramData\CompanyControlPlaneAgent\run-device-agent.ps1`
- Node.js:
  - portable Node.js downloaded by installer
- capabilities:
  - `heartbeat`
  - `openclaw-client`
- labels:
  - `role=PM`
  - `person=Begayym`
  - `mode=system`

The temporary earlier user-level install directory was removed after confirming
the live task and processes were using only `C:\ProgramData`.

### Verification

- PM laptop task:
  - `CompanyControlPlaneDeviceAgent`: `Running`
  - last task result while running: `267009`
  - task action points to:
    - `C:\ProgramData\CompanyControlPlaneAgent\run-device-agent.ps1`
- PM laptop live processes:
  - `powershell.exe` runner under `C:\ProgramData\CompanyControlPlaneAgent`
  - `node.exe` under `C:\ProgramData\CompanyControlPlaneAgent\node`
- PM laptop logs:
  - stdout showed:
    - device-agent started for `begayym-windows`
    - successful heartbeat
  - stderr length: `0`
- Central server state:
  - `deviceId`: `begayym-windows`
  - `userId`: `u-pm-1`
  - `hostname`: `DESKTOP-M780PPS`
  - `platform`: `win32`
  - `lastSeenAt`: `2026-06-04T09:17:20.652Z`
  - `heartbeatCount`: `4`
- Owner API visibility:
  - calling `/api/v1/device-agents` as Nikolay returned:
    - `maksat-mac-mini`
    - `nikolay-windows`
    - `begayym-windows`
- Local verification after the installer fix:
  - `npm test`: 33/33 passed
  - PowerShell parser check for `install-device-agent-windows.ps1`: passed
  - `git diff --check`: no whitespace errors; only expected CRLF warnings

### Claude Review Notes

Review focus:

- Confirm the default install-dir behavior in
  `control-plane\scripts\install-device-agent-windows.ps1`.
- Confirm docs still match the production Windows client install path.
- Confirm `u-pm-1` is the correct final mapping for Begayym. If not, update
  the state/device mapping before broader rollout.
- Confirm no secrets were written into this worklog.

### Remaining Work Outside This PM Laptop

- Maksat's Mac agent still needs a separate check because its last server
  heartbeat was stale.
- Other PM devices are not installed yet.
- Full OpenClaw local runtime bridge is still future work; this PM laptop is
  complete for the current heartbeat/visibility client MVP.

### Status

Done. PM laptop is installed and visible to Nikolay through the central server.

---

## 2026-06-04 - Maksat Mac Finished To Current Production MVP

### User Request

Bring Maksat's computer to a fully working state:

- SSH target: `asik@192.168.88.29`
- Existing credentials unchanged.
- Continue logging work for Claude review.

### Access And Host Facts

- SSH succeeded after accepting the new host fingerprint explicitly.
- Hostname: `Mac-mini.local`.
- OS: macOS/Darwin `25.5.0`.
- Architecture: `arm64`.
- User: `asik`.
- sudo access: available.

### Initial Findings

- The previous lightweight agent was running as a per-user LaunchAgent:
  - `~/Library/LaunchAgents/com.company.control-plane.device-agent.plist`
  - launchd domain: `gui/502`
- The agent was alive after reconnecting and had resumed heartbeats, but this
  was not the desired production shape because a user LaunchAgent depends on
  the user launchd session.
- The server state initially showed that the old stale heartbeat problem had
  recovered, but the install still needed to be hardened.
- `openclawagent` on Maksat was on `main`, not `server`.
- Switching branches was blocked by untracked `control-plane` files.

### Repository Work On Maksat

- Preserved the old checkout by moving it to a timestamped backup:
  - `/Users/asik/agent/openclawagent.backup.20260604-154325`
- Cloned a clean `server` branch:
  - `/Users/asik/agent/openclawagent`
  - branch: `server`
  - commit: `bea5ca0`
- Ensured upstream OpenClaw clone exists:
  - `/Users/asik/agent/openclaw`
  - commit observed after update: `60e0d2a7`
- Uploaded latest local files because GitHub may not contain all current local
  agent fixes yet:
  - `control-plane\src\device-agent.js`
  - `control-plane\scripts\macos\install-device-agent.sh`
  - `control-plane\package.json`

### Implemented

- Added production macOS daemon install support:
  - file: `control-plane\scripts\macos\install-device-agent.sh`
  - new flag: `--run-as-daemon`
- `--run-as-daemon` now:
  - writes `/Library/LaunchDaemons/com.company.control-plane.device-agent.plist`
  - uses the `system` launchd domain
  - runs the agent as the current macOS user via `UserName`
  - unloads/removes the older per-user LaunchAgent when `--start-now` is used
- Updated docs for future macOS client installs:
  - `control-plane\README.md`
  - `control-plane\docs\DEVICE_INSTALL_CHECKLIST.md`
  - `control-plane\docs\MACOS_INSTALL.md`

### Final Maksat Installation

Installed Maksat's agent as a system LaunchDaemon:

- plist:
  - `/Library/LaunchDaemons/com.company.control-plane.device-agent.plist`
- launchd service:
  - `system/com.company.control-plane.device-agent`
- username:
  - `asik`
- install dir:
  - `/Users/asik/Library/Application Support/CompanyControlPlaneAgent`
- device identity:
  - `deviceId`: `maksat-mac-mini`
  - `userId`: `u-maksat`
  - display name: `Maksat Mac Mini`
- capabilities:
  - `heartbeat`
  - `openclaw-client`
- labels:
  - `role=SENIOR_PM`
  - `person=Maksat`
  - `mode=daemon`

### Verification

- Local Mac launchd verification:
  - `system/com.company.control-plane.device-agent`: running
  - username: `asik`
  - pid observed: `2107`
  - old `gui/502` LaunchAgent service was absent after daemon install
  - only the real device-agent process remained after removing a diagnostic
    `sudo launchctl print` process
- Local Mac log verification:
  - stdout showed successful heartbeat counts through `110`
  - stderr was cleared after old historical errors and remained size `0`
- Central server verification:
  - `maksat-mac-mini` visible with fresh `lastSeenAt`
  - `lastSeenAt`: `2026-06-04T09:49:28.818Z`
  - `heartbeatCount`: `111`
  - labels include `mode=daemon`
  - capabilities include `heartbeat` and `openclaw-client`
- Owner API visibility:
  - calling `/api/v1/device-agents` as Nikolay returned:
    - `maksat-mac-mini`
    - `nikolay-windows`
    - `begayym-windows`
- Local verification after macOS daemon installer changes:
  - `npm test`: 33/33 passed
  - `bash -n scripts/macos/install-device-agent.sh`: passed
  - `node --check src/device-agent.js`: passed
  - PowerShell parser check for `install-device-agent-windows.ps1`: passed
  - `git diff --check`: no whitespace errors; only expected CRLF warnings

### Claude Review Notes

Review focus:

- Confirm the `--run-as-daemon` path in
  `control-plane\scripts\macos\install-device-agent.sh`.
- Confirm LaunchDaemon `UserName` behavior is acceptable for future local
  OpenClaw bridge work.
- Confirm docs now distinguish lightweight macOS client install from legacy
  full local server packaging.
- Confirm no secrets were written into this worklog.

### Remaining Work Outside Maksat

- Other PM devices are not installed yet.
- Full OpenClaw local runtime bridge is still future work; this Mac is complete
  for the current heartbeat/visibility client MVP.

### Status

Done. Maksat's Mac is installed as a production LaunchDaemon client and is
visible to Nikolay through the central server.

---

## 2026-06-04 - Detailed Agent Architecture And Status Report

### User Request

Create a maximally detailed and understandable report explaining:

- how the server agent/control-plane works;
- what it can do;
- what it accepts;
- what data it processes;
- how useful it is;
- how Maksat's and PM's computer agents work.

The user also asked to open the finished report in VS Code.

### Created

- `AGENT_ARCHITECTURE_AND_STATUS_REPORT.md`

### Contents

The report covers:

- central Linux server topology;
- API service;
- Telegram bot;
- setup wizard and encrypted secrets;
- RBAC/hierarchy;
- JSON state;
- audit log;
- accepted API payloads;
- device heartbeat payloads;
- token usage event ingest;
- Metricon report flow;
- Bitrix project status flow;
- Maksat macOS LaunchDaemon agent;
- PM Windows SYSTEM task agent;
- Nikolay Windows owner agent;
- live status from VPS;
- usefulness;
- limitations;
- recommended next development steps;
- Claude review checklist.

### Security

- No passwords were written.
- No API tokens were written.
- No Telegram bot token was written.
- No Bitrix webhook URL was written.
- No Metricon token was written.
- No Claude API key or Google OAuth JSON was written.

### Status

Done. Report is ready for user/Claude review.

### Follow-up: Russian Version

User asked why the report was in English. Created a Russian version:

- `AGENT_ARCHITECTURE_AND_STATUS_REPORT_RU.md`

Opened the Russian report in VS Code for immediate reading.

---

## 2026-06-04 - Telegram AI Assistant MVP And Google OAuth Explanation

### User Request

User clarified that the Telegram bot must be a universal assistant, not only a
command bot. Example expected behavior:

- Maksat asks how a PM worked today.
- Bot answers using Metricon activity, Bitrix tasks, planned task count,
  completed work, and efficiency.
- Nikolay can ask about Maksat and PMs.
- Maksat can ask about subordinate PMs.
- PM users should receive help inside their own role scope.

User also asked where to upload Google OAuth for every employee.

### Implemented

Added MVP free-form Telegram AI assistant:

- `control-plane\src\assistant\claude-client.js`
- `control-plane\src\assistant\company-assistant.js`

Updated:

- `control-plane\src\telegram\handler.js`
- `control-plane\src\telegram-bot.js`
- `control-plane\test\telegram.test.js`

Behavior:

- Telegram commands still work as before.
- Normal text without `/` is now treated as an AI assistant question.
- The assistant resolves the Telegram user as an actor.
- The assistant collects only hierarchy-allowed context:
  - accessible users;
  - visible device agents;
  - related projects;
  - Metricon activity context;
  - Bitrix project/task context.
- Context is sent to Claude through the configured Claude API key.
- Claude is instructed to answer in Russian and not invent data.
- Claude is instructed to respect access scope and mention missing/unconfigured
  data.
- Assistant requests are written to audit log with action:
  - `telegram.assistant.ask`
- Claude usage is recorded as token usage event with action:
  - `telegram.assistant`

### Deployment

Deployed updated Telegram assistant code to the VPS:

- `/opt/company-control-plane/src/assistant/claude-client.js`
- `/opt/company-control-plane/src/assistant/company-assistant.js`
- `/opt/company-control-plane/src/telegram/handler.js`
- `/opt/company-control-plane/src/telegram-bot.js`

Restarted:

- `company-control-plane-telegram-bot.service`

Verification:

- `company-control-plane-telegram-bot.service`: active
- `company-control-plane-api.service`: active
- `/health`: ok
- bot logs after restart showed:
  - `telegram bot polling started`

### Local Verification

- `npm test`: 34/34 passed
- `node --check` passed for:
  - `src\assistant\claude-client.js`
  - `src\assistant\company-assistant.js`
  - `src\telegram\handler.js`
  - `src\telegram-bot.js`

### Server Setup Status Check

Only boolean configured flags were checked; no secrets were printed.

- Claude API key: configured
- Google OAuth client JSON: not configured
- Bitrix webhook URL: configured
- Metricon access token: configured
- Metricon refresh token: not configured
- Overall setup status remains not fully configured because Google OAuth JSON
  is missing.

### Google OAuth Explanation

Created Russian explainer:

- `TELEGRAM_AI_ASSISTANT_AND_GOOGLE_OAUTH_RU.md`

Key point:

- Google OAuth client JSON is not uploaded separately for every employee.
- One OAuth client JSON belongs to the application/server and is uploaded once
  through setup.
- Each employee must later complete an individual Google OAuth consent flow.
- The resulting per-user refresh token must be encrypted and stored against
  that employee's `userId`.
- That per-user Google OAuth flow is not implemented yet.

### Security

- No secrets were written into the worklog.
- No tokens were written into the new docs.
- Assistant prompt context excludes setup secrets and raw credentials.

### Status

Done for MVP AI Telegram assistant. Google OAuth per-user flow remains the next
feature to implement.

---

## 2026-06-03 - Metricon domain API and refresh-token support

### User Request

- User provided official Metricon site:
  - `http://metriconapp.com/`
- User wanted Codex to use admin credentials supplied in chat to obtain/create
  Metricon access for the AI service account.
- Continue recording all work for Claude review.

### Findings

- `metriconapp.com` resolves to the same Metricon server IP used earlier.
- `http://metriconapp.com/` serves the Metricon frontend.
- `https://metriconapp.com/` is not currently available; port 443 did not
  respond during this check.
- Frontend bundle imports:
  - `assets/baseApi-DflZyrEf.js`
  - `assets/useLogin-FaSg3b9I.js`
  - `assets/authStore-C7RNGyR-.js`
- The frontend API prefix is:
  - `/api/v1/`
- Therefore the public domain API login endpoint is:
  - `POST http://metriconapp.com/api/v1/auth/login`
- Metricon frontend refresh flow uses:
  - `POST /api/v1/auth/refresh`
  - request body includes `refreshToken`
- Tried the supplied admin login against:
  - `http://metriconapp.com/api/v1/auth/login`
  - `http://85.239.49.208/api/v1/auth/login`
  - `http://85.239.49.208:8080/api/v1/auth/login`
- All attempts returned `INVALID_CREDENTIALS`.
- No brute force/password guessing was done.
- Tried the proposed AI service account login once against
  `http://metriconapp.com/api/v1/auth/login`; it also returned
  `INVALID_CREDENTIALS`.
- No Metricon user was created because authentication failed.
- No Metricon secrets were written to files.

### Implemented

- Added Metricon refresh token support to the control-plane connector:
  - `control-plane\src\connectors\kickidler-client.js`
- New env support:
  - `METRICON_REFRESH_TOKEN`
  - legacy-compatible `KICKIDLER_REFRESH_TOKEN`
- Connector now configures HTTP mode when `METRICON_BASE_URL` is present and
  either an access token or a refresh token is present.
- If access token is missing, connector can obtain one via refresh token.
- If Metricon returns 401/403, connector refreshes token and retries once.
- Connector now accepts base URLs with or without `/api/v1` suffix.
- Added setup wizard field:
  - Metricon Refresh Token
- Added encrypted setup storage for refresh token:
  - `kickidlerRefreshToken`
- Setup considered configured when Metricon has access token or refresh token.
- Updated default Metricon base URL hints to:
  - `http://metriconapp.com`
- Updated docs:
  - `control-plane\README.md`
  - `control-plane\docs\METRICON_API.md`
  - `control-plane\docs\ARCHITECTURE.md`
  - `control-plane\docs\WINDOWS_INSTALL.md`
  - `control-plane\docs\LINUX_INSTALL.md`
  - `control-plane\docs\DEVICE_INSTALL_CHECKLIST.md`
  - `control-plane\config\control-plane.env.example`
- Updated install scripts defaults:
  - `control-plane\scripts\linux\install-linux.sh`
  - `control-plane\scripts\install-windows.ps1`

### Tests Added

- Added:
  - `control-plane\test\metricon-client.test.js`
- Test coverage:
  - expired access token triggers refresh;
  - connector retries with fresh access token;
  - rotated refresh token is stored in memory;
  - refresh-token-only env config is accepted;
  - base URL ending in `/api/v1` is not double-prefixed.

### Verification

- `npm test`: 31/31 passed.

### Claude Review Focus

- Verify refresh-token implementation and retry behavior.
- Verify setup wizard field naming and secret masking.
- Confirm whether production should store refreshed access/refresh tokens back
  to encrypted storage, not only in process memory.
- Confirm actual Metricon report endpoint shape from OpenAPI before relying on
  the current placeholder `GET /api/v1/activity/report`.

### Open Risks

- The supplied Metricon admin credentials did not authenticate.
- Need user to verify Metricon admin login or create/regenerate service account
  credentials manually in Metricon.
- Metricon currently appears HTTP-only on `metriconapp.com`; production secrets
  should not be sent over public HTTP if avoidable.
- Current connector refreshes tokens in memory only. After service restart,
  setup must still contain a valid refresh token.

### Status

Partial. Metricon domain/API behavior identified and control-plane refresh
support implemented. AI Metricon user/token creation is blocked by invalid
Metricon admin credentials.

### Follow-up Check After User Reported Browser Login Worked

- User reported successful login at `http://metriconapp.com/auth` with the
  same credentials shown earlier.
- Re-fetched current `/auth` HTML and found a newer frontend bundle:
  - `assets/index-C415boNV.js`
- Earlier inspected chunks were stale and now return 404:
  - old `index-BXh3hvQM.js` lazy assets are no longer current.
- Current auth chunks:
  - `assets/baseApi-BrR4iGn5.js`
  - `assets/useLogin-DH_zs4N6.js`
  - `assets/authStore-BDImdJFH.js`
  - `assets/index-CM-N-lmQ.js`
- Current login form still submits only:
  - `email`
  - `password`
- Current API prefix is still:
  - `/api/v1/`
- Re-tested `POST http://metriconapp.com/api/v1/auth/login` with browser-like
  headers and current frontend payload shape. It still returned
  `INVALID_CREDENTIALS`.
- Re-tested login through headless Chrome/CDP on the actual `/auth` page.
  Observed real frontend network request:
  - `POST http://metriconapp.com/api/v1/auth/login`
  - request body contained only `email` and `password`
  - response status was 400
  - no `accessToken` or `refreshToken` was saved to localStorage
- Checked one visually ambiguous email variant from the screenshot:
  - digit `1` variant
  - lowercase `l` variant
  - both returned 400
- Most likely explanations:
  - browser used an autofilled password different from the screenshot;
  - browser already had valid localStorage tokens;
  - credentials were changed/rotated;
  - user login test and API check used subtly different exact values.
- Recommended next step:
  - extract `accessToken` and `refreshToken` from logged-in browser
    localStorage for `metriconapp.com`, or ask user for exact copied password
    from Metricon/admin panel.

---

## 2026-06-03 - Central server restart after setup save

### User Request

- User saved required setup fields in the setup wizard.
- User asked Codex to perform restart if necessary.

### Actions

- Connected to the Linux central server.
- Restarted:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Verified service health and status.

### Verification

- `company-control-plane-api.service`: active/running.
- `company-control-plane-telegram-bot.service`: active/running.
- Local server health endpoint returned:
  - `ok: true`
  - `service: company-control-plane`
- API logs after restart show:
  - `metricon connector: metricon configured=true`
  - `bitrix connector: bitrix configured=true`
- Telegram bot logs after restart show:
  - `telegram bot polling started`

### Notes For Claude

- No secrets were written to this worklog.
- Restart applied the setup values that were already saved on the server.
- Local repository still contains pending Metricon refresh-token support that
  has not necessarily been deployed to the Linux server unless a later step
  explicitly copies/pushes it there.

### Status

Done. Central server services restarted and verified.

---

## 2026-06-03 - Device agents installed for Nikolay and Maksat

### User Request

- Connect by SSH to:
  - Nikolay owner device: `dasmu@192.168.88.81`
  - Maksat senior PM device: `asik@192.168.88.29`
- Install agents so Nikolay can see Maksat's agent according to the hierarchy.
- Public repo reference:
  - `dasbkdev/openclawagent.git`
- Original OpenClaw reference:
  - `openclaw/openclaw.git`

### Access Results

- Nikolay:
  - Initial PIN-like password failed.
  - Microsoft account password worked.
  - OS: Windows.
  - Hostname: `WIN-5IMJD8NIIM7`.
  - Git installed.
  - Node.js not installed globally.
- Maksat:
  - SSH worked.
  - OS: macOS/Darwin on Apple Silicon.
  - Hostname: `Mac-mini.local`.
  - Git installed.
  - Node.js not installed globally.

### Implemented For This Rollout

- Added central device-agent support:
  - `control-plane\src\domain\device-agents.js`
  - `POST /api/v1/device-agents/heartbeat`
  - `GET /api/v1/device-agents`
  - Telegram command `/agents`
- Added `deviceAgents` to MVP JSON state.
- Heartbeat stores:
  - device id;
  - user id;
  - hostname;
  - platform;
  - arch;
  - OS release;
  - agent version;
  - first/last seen timestamps;
  - heartbeat count;
  - labels/capabilities.
- Visibility follows existing hierarchy:
  - OWNER sees all devices.
  - SENIOR_PM sees own and subordinate PM devices.
  - PM sees only own devices.
- Added lightweight local device-agent process:
  - `control-plane\src\device-agent.js`
- Added macOS user LaunchAgent installer:
  - `control-plane\scripts\macos\install-device-agent.sh`
- Added Windows user Scheduled Task installer:
  - `control-plane\scripts\install-device-agent-windows.ps1`
- Installers download portable Node.js when global Node.js is missing.

### Central Server Deployment

- Uploaded current local `control-plane` to VPS via SSH/SFTP because GitHub push
  is still not available from this machine.
- Installed updated central API on Linux server.
- Added `DEVICE_AGENT_INGEST_TOKEN` to the server env file.
- Added Nginx exact-match unauthenticated proxy for:
  - `/api/v1/device-agents/heartbeat`
- Kept Basic Auth for the rest of the public UI/API.
- Verified external HTTPS heartbeat endpoint with the device-agent token.
- Verified API health after deployment.

### Client Installation

- Maksat macOS:
  - Installed source under `~/agent/openclawagent/control-plane`.
  - Installed portable Node.js under user agent directory.
  - Installed LaunchAgent:
    - `~/Library/LaunchAgents/com.company.control-plane.device-agent.plist`
  - Agent id:
    - `maksat-mac-mini`
  - User id:
    - `u-maksat`
  - Heartbeat succeeded.
- Nikolay Windows:
  - Installed source under:
    - `%USERPROFILE%\agent\openclawagent\control-plane`
  - Installed portable Node.js under:
    - `%LOCALAPPDATA%\CompanyControlPlaneAgent\node`
  - Installed Scheduled Task:
    - `CompanyControlPlaneDeviceAgent`
  - Agent id:
    - `nikolay-windows`
  - User id:
    - `u-nikolay`
  - Heartbeat succeeded.

### Verification

- Local tests:
  - `npm test`: 33/33 passed.
- Script checks:
  - `node --check src/device-agent.js`
  - `bash -n scripts/macos/install-device-agent.sh`
  - Windows installer parsed as a PowerShell scriptblock.
- Central RBAC check:
  - `GET /api/v1/device-agents` as Nikolay returned both:
    - `maksat-mac-mini` for `u-maksat`
    - `nikolay-windows` for `u-nikolay`
- Persistence check after one heartbeat interval:
  - `maksat-mac-mini` heartbeat count reached `3`.
  - `nikolay-windows` heartbeat count reached `3`.

### Important Notes

- This installs the current lightweight heartbeat device agent, not the full
  OpenClaw runtime bridge.
- Full OpenClaw local runtime integration is still future work.
- No OpenClaw upstream source was modified.
- Device-agent token was not written into this worklog.
- The macOS stderr log still contains earlier 401 attempts from before the
  Nginx HTTPS heartbeat exception was added; later heartbeat entries succeeded.

### Status

Done for the current MVP: Nikolay's central owner view can see Maksat's device
agent and Nikolay's own device agent. Background heartbeats continue to update.

## 2026-06-03 - Metricon AI User Creation Attempt

### User Request

Use provided Metricon admin credentials to create an AI service user and obtain
Metricon access credentials for the central server.

### Result

- Did not write the provided passwords to repo files or worklog.
- Called Metricon auth endpoint:
  - `POST http://85.239.49.208:8080/api/v1/auth/login`
- Metricon returned:
  - `400`
  - `INVALID_CREDENTIALS`
- Could not create the AI user because `POST /api/v1/users` requires a valid
  admin Bearer token.

### Next Required User Action

Confirm the correct Metricon admin email/password for
`http://85.239.49.208:8080`, or log in manually and create the AI user in
Metricon UI. Once a valid admin login is available, Codex can create:

- email: `openclawstarlab@gmail.com`
- role: `ADMIN` for MVP read access

Then Codex can obtain and store the AI user's Metricon token on the central
server.

## 2026-06-03 - Linux Server Deployment On starlabagent.pp.ua

### User Request

Clone `dasbkdev/openclawagent.git` on the Linux server, set up the central
server, and configure SSL for domain `starlabagent.pp.ua`.

### Server

- Host/IP:
  - `starlabagent.pp.ua`
  - `114.29.236.103`
- OS:
  - Ubuntu 22.04.5 LTS
- Hostname:
  - `starlabit`
- Server resources:
  - 2 logical CPUs
  - about 3.8 GiB RAM
  - about 71 GiB free disk on `/`

### Implemented On Server

- Installed base dependencies:
  - Git
  - Node.js `v22.22.3`
  - npm `10.9.8`
  - Tailscale `1.98.4`
  - Nginx
  - Certbot
  - Apache htpasswd utilities
- Cloned GitHub repository:
  - `/root/agent`
  - branch `server`
- Ran control-plane tests on the server:
  - 29/29 passed.
- Installed Linux central server services:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Installed app paths:
  - `/opt/company-control-plane`
  - `/etc/company-control-plane/control-plane.env`
  - `/var/lib/company-control-plane`
- Configured Nginx reverse proxy:
  - public HTTP/HTTPS on `starlabagent.pp.ua`
  - upstream Node API remains local on `127.0.0.1:3099`
- Issued Let's Encrypt certificate:
  - `starlabagent.pp.ua`
  - expires `2026-09-01`
  - auto-renewal scheduled through `certbot.timer`
- Added Basic Auth in front of HTTPS web access.
  - Credentials are stored on the server at:
    - `/root/starlabagent-basic-auth.txt`
  - Do not commit those credentials.

### Verification

- `curl http://127.0.0.1:3099/health` returned OK.
- `https://starlabagent.pp.ua/health` returned OK with Basic Auth.
- `https://starlabagent.pp.ua/setup` returned the setup wizard HTML with Basic
  Auth.
- External HTTPS health check from the operator machine returned OK.
- `company-control-plane-api.service` is active and enabled.
- `company-control-plane-telegram-bot.service` is active and enabled.
- `nginx` is active and enabled.
- `certbot.timer` is present for automatic renewal.
- A manual `certbot renew --dry-run` attempt hung and was stopped; the real
  certificate is installed and valid.
- Ports listening:
  - `22` SSH
  - `80` HTTP redirect/challenge
  - `443` HTTPS
  - `127.0.0.1:3099` local Node API

### Open Items

- Tailscale is installed but still logged out. Need tailnet auth/login.
- Setup wizard still needs production secrets:
  - Nikolay Telegram numeric ID
  - Telegram bot token
  - Claude API key
  - Metricon token
  - Bitrix credentials
  - Google OAuth JSON
- Rotate the root SSH password after setup because it was shared in chat.
- Consider creating a non-root sudo user and disabling root password login after
  access is stabilized.

## 2026-06-03 - Linux Server SSH Attempt With Invalid IP

### User Request

Try connecting to the Linux server over SSH as `root`.

### Result

- Did not store or commit the provided password.
- Tried SSH in non-interactive/batch mode first.
- SSH did not reach authentication.
- Provided host `114.29.263.103` is not a valid IPv4 address because `263` is
  outside the allowed `0-255` octet range.
- OpenSSH returned a hostname resolution error before any password could be
  tested.

### Next Required User Action

Provide the corrected server IP/hostname, then retry SSH.

### Retry After User Reconnected Wi-Fi

- Retried the same host after the user reconnected Wi-Fi.
- Result stayed the same: `114.29.263.103` is still invalid IPv4 and OpenSSH
  fails before network/authentication.
- Need corrected IP/hostname.

## 2026-06-03 - Create Server Branch And Push Attempt

### User Request

Create a `server` branch and push the current Linux central server work there.

### Result

- Created local branch:
  - `server`
- Attempted SSH push to:
  - `git@github.com:dasbkdev/openclawagent.git`
- SSH push failed before upload:
  - GitHub returned `Permission denied (publickey)`.
- Attempted HTTPS push directly to:
  - `https://github.com/dasbkdev/openclawagent.git`
- HTTPS push timed out waiting for GitHub credential authorization.
- Checked remote branch over HTTPS:
  - `refs/heads/server` does not exist yet.

### Diagnosis

The local branch exists, but this machine currently cannot authenticate to
GitHub for push. Need one of:

- add this machine's SSH public key to GitHub; or
- authorize Git Credential Manager for GitHub HTTPS; or
- push manually from a machine that already has GitHub write access.

### Notes

- No secrets or server passwords were written to the repository.
- No GitHub push succeeded yet.

## 2026-06-03 - Linux Central Server Support

### User Request

Windows server setup is not working well, so switch the central server plan to
Linux and prepare Linux installation support.

### Implemented

- Added Linux server scripts:
  - `control-plane\scripts\linux\preflight-linux-server.sh`
  - `control-plane\scripts\linux\install-linux.sh`
  - `control-plane\scripts\linux\restart-linux.sh`
  - `control-plane\scripts\linux\uninstall-linux.sh`
- Added Linux install docs:
  - `control-plane\docs\LINUX_INSTALL.md`
- Updated root/server docs to make Linux the preferred central server target:
  - `SERVER_PREP_RUNBOOK.md`
  - `CENTRALIZED_SERVER_PLAN.md`
  - `AI_DEVICE_INSTALLATION_PLAYBOOK.md`
  - `README.md`
- Updated control-plane docs:
  - `control-plane\README.md`
  - `control-plane\docs\ARCHITECTURE.md`
  - `control-plane\docs\DEVICE_INSTALL_CHECKLIST.md`
- Added `.gitattributes` so Linux shell scripts keep LF endings and executable
  scripts are safe after clone.

### Linux Runtime Layout

- Application files:
  - `/opt/company-control-plane`
- Non-secret env:
  - `/etc/company-control-plane/control-plane.env`
- Runtime data and encrypted secrets:
  - `/var/lib/company-control-plane`
- systemd services:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`

### Notes

- Node.js `22+` is required on Linux and must be installed system-wide for
  systemd, not only through `nvm`.
- Setup wizard should be accessed through SSH tunnel for the first pilot:
  - `ssh -L 3099:127.0.0.1:3099 <user>@<server-ip>`
- Production secrets still go through setup wizard, not git and not the Linux
  env file.
- Windows installer remains as fallback/testing path only.

### Verification

- `bash -n` passed for all Linux scripts.
- `npm test` in `control-plane`: 29/29 passed.
- Secret scan found only placeholders/test values, no real Telegram/Claude
  secrets.

### Open Risks

- Need to test scripts on the actual Linux server.
- Need to install/confirm Node.js `22+`, Git, and Tailscale on the server.
- Need to confirm server distro and package manager.
- Need to decide backup retention and whether to add a backup script.

## 2026-06-03 - Server SSH Connectivity Attempt

### User Request

The user provided remote server SSH access details and asked Codex to try
connecting.

### Result

- Did not store or commit the provided password.
- Checked local tools:
  - OpenSSH client exists.
  - Python `paramiko` exists.
- Tested TCP/SSH access to the server IP.
- SSH port `22` timed out before authentication, so the password was not tested.
- RDP port `3389` is reachable from the current machine.
- Current public IP for firewall allowlisting was checked separately in the
  terminal.

### Diagnosis

The server is reachable, but SSH is blocked externally. Likely causes:

- Windows Firewall does not allow inbound TCP `22`;
- provider firewall/security group does not allow inbound TCP `22`;
- `sshd` is not listening on public interface/port `22`;
- SSH service is running, but only RDP is exposed publicly.

### Implemented

- Added SSH troubleshooting notes to `SERVER_PREP_RUNBOOK.md`.

### Next Required User/Server Action

Log in through RDP or provider console and open inbound TCP `22`, ideally only
from the operator's current public IP. Then ask Codex to retry SSH.

## 2026-06-03 - Central Server Preparation Pack

### User Request

The user bought a server that should become the centralized server. Prepare the
repository and instructions so Codex can configure it later after receiving
temporary server access credentials.

### Implemented

- Added root runbook:
  - `SERVER_PREP_RUNBOOK.md`
- Added Windows preflight script:
  - `control-plane\scripts\preflight-windows-server.ps1`
- Updated Windows install docs to run server preflight before installing:
  - `control-plane\docs\WINDOWS_INSTALL.md`
- Updated device install checklist so Nikolay/central server setup starts with
  the server prep runbook and preflight script:
  - `control-plane\docs\DEVICE_INSTALL_CHECKLIST.md`
- Filled root `README.md` with the central server starting point and repository
  safety rules.

### Server Prep Summary

- Server is the central control-plane node.
- Other devices are clients by default.
- Preflight checks Administrator rights, Windows version, CPU, RAM, disk, Git,
  Node.js, Tailscale, API port `3099`, install/data dirs, and scheduled tasks.
- Secrets must still be entered through setup wizard and not committed to git.
- The user should provide only temporary remote login credentials and rotate
  them after setup.

### Verification

- Documentation and PowerShell script only.
- Ran `control-plane` tests: 29/29 passed.
- Ran preflight script locally in JSON mode; it produced the expected server
  readiness report. Local session was not elevated, so Administrator check
  failed as expected.
- Scanned for real Telegram/Claude secrets; only placeholders/test values were
  found.
- No source code, secrets, OpenClaw files, or Metricon/Kickidler files were
  modified.

### Open Risks

- Need to run preflight on the actual server.
- Need to know if the rented server is Windows Server, Windows 10, or Windows
  11.
- Need server IP/host, temporary Windows credentials, and GitHub access method
  if the repository is private.
- Need Tailscale tailnet/auth plan before client devices connect.

## 2026-06-03 - Centralized Server Architecture Plan

### User Request

Change the architecture plan so there is one centralized server with one
centralized agent. Nikolay, Maksat, and the three PMs should address this central
server/agent. The role hierarchy remains unchanged.

### Decision

- The product should move from "multiple devices with agents managing each
  other" to "one central server plus client devices".
- Nikolay's always-on office computer is the MVP central server.
- The central server runs the control-plane API, Telegram bot, setup wizard,
  scheduler, encrypted secrets, connectors, token analytics, and central
  agent/orchestrator.
- Maksat and PM devices are clients by default.
- Tailscale remains the primary private network so clients can reach the central
  server, but clients do not need peer-to-peer access.
- RBAC stays the same:
  - OWNER: all users/projects.
  - SENIOR_PM: self plus subordinate PMs.
  - PM: own user/project scope.

### Implemented

- Added `CENTRALIZED_SERVER_PLAN.md` with the detailed target architecture,
  request flows, component responsibilities, connector strategy, security
  requirements, migration plan, and open questions.
- Updated `AI_DEVICE_INSTALLATION_PLAYBOOK.md` so future installers understand
  Nikolay's machine is the central server and Maksat/PM devices are clients by
  default.
- Updated `control-plane\docs\DEVICE_INSTALL_CHECKLIST.md` so the full
  installer is for Nikolay's central server, while Maksat/PM devices use client
  onboarding unless development/testing is explicitly needed.
- Updated `control-plane\docs\ARCHITECTURE.md` with an explicit centralized
  server model.

### Verification

- Documentation-only architecture plan change.
- No source code, secrets, OpenClaw files, or Metricon/Kickidler files were
  modified.

### Open Risks

- Code still needs follow-up changes so non-owner device setup does not install
  always-on API/bot services by default.
- Need to add central server URL/client configuration once a client app or local
  bridge is implemented.
- Need to decide whether Bitrix can use one admin integration or requires
  per-user OAuth.
- Need to decide which Google/Gmail data requires per-user OAuth versus shared
  company credentials.

## 2026-06-03 - VPN Plan Change To Tailscale

### User Request

Radmin VPN does not install on macOS, so the mixed Windows/macOS/Linux rollout
needs a different private network plan.

### Decision

- Use Tailscale as the primary VPN/tailnet for all new installs.
- Keep the central server controlled by Nikolay as the main 24/7 control-plane
  node.
- Connect Maksat and PM devices to the same Tailscale tailnet.
- Record each device's role, Tailscale IPv4 address, and MagicDNS name if
  MagicDNS is enabled.
- Use ZeroTier as the backup VPN if Tailscale cannot be used.
- Treat Radmin VPN as Windows-only fallback/legacy, not the default rollout
  path.

### Implemented

- Updated `AI_DEVICE_INSTALLATION_PLAYBOOK.md` network model from Radmin-first
  to Tailscale-first.
- Updated `control-plane\docs\DEVICE_INSTALL_CHECKLIST.md` with Tailscale
  install/verification checklist and Radmin fallback note.
- No source code, secrets, OpenClaw files, or Metricon/Kickidler files were
  modified.

### Verification

- Searched docs for remaining Radmin references.
- Remaining Radmin mentions are explicitly labeled Windows-only fallback/legacy.

### Open Risks

- Tailscale account/tailnet ownership still needs to be created or confirmed.
- ACL rules are not configured yet. Before production, restrict device access so
  PM devices can reach only the required control-plane endpoints.
- Need to test real Windows/macOS/Linux installation flows on the target
  devices.

## 2026-06-03 - Remote Upload Prep, Metricon Naming, Device Install Checklist

### User Request

Prepare the main directory for upload to a remote server before installing Codex
on Nikolay, Maksat, and one PM device. Add the local `kickidler` folder to
gitignore. Treat the monitoring product as officially named `Metricon` going
forward. The user also provided the Metricon Swagger URL and a Telegram bot
token. Bitrix credentials will be provided later.

### Important Secret Handling

- Telegram bot token was received in chat.
- The token was **not** written to committed source files.
- Configure it through the setup wizard on each target device so it is stored
  in encrypted local storage.
- Do not paste the full token into docs, commits, or worklog.

### Implemented

- Added root ignore file:
  - `C:\Users\dasmu\agent\.gitignore`
- Root `.gitignore` excludes:
  - `kickidler/`
  - `metricon/`
  - `Metricon/`
  - `openclaw/` as external upstream checkout
  - `.env`, `data`, `dist`, `node_modules`, runtime config, and secret files
- Hardened `control-plane\.gitignore` for secret/runtime files.
- Checked Metricon Swagger:
  - `http://85.239.49.208:8080/swagger-ui/index.html` returned HTTP 200.
  - `http://85.239.49.208:8080/v3/api-docs` returned HTTP 200.
  - OpenAPI title currently says `Kickidler API`; user-facing name should be
    Metricon.
  - OpenAPI path count observed: 106.
- Added Metricon Swagger handoff:
  - `control-plane\docs\METRICON_API.md`
- Added device install checklist:
  - `control-plane\docs\DEVICE_INSTALL_CHECKLIST.md`
- Updated user-facing docs/setup text from Kickidler to Metricon where practical.
- Added Metricon env aliases:
  - `METRICON_BASE_URL`
  - `METRICON_ACCESS_TOKEN`
- Kept legacy `KICKIDLER_*` env compatibility.
- Added preferred API alias:
  - `POST /api/v1/reports/metricon/activity-summary`
- Kept legacy API route:
  - `POST /api/v1/reports/kickidler/activity-summary`

### Verification

- `npm test`: 29/29 passed.
- HTTP smoke for `POST /api/v1/reports/metricon/activity-summary` passed.
- Rebuilt Windows installer:
  - `control-plane\dist\CompanyControlPlaneInstaller.exe`
  - size: about 33.9 MB

### Open Risks

- Root `C:\Users\dasmu\agent` is not currently the clean deployment git repo.
  `git rev-parse` from that folder resolves to `C:\Users\dasmu`, so pushing from
  the wrong location risks uploading the Windows user profile.
- Safest remote repo remains `C:\Users\dasmu\agent\control-plane`.
- Bitrix credentials are still pending.

### Status

Done. Ready for Claude review.

## 2026-06-03 - Root AI Device Installation Playbook

### User Request

Create a mega-detailed file in the root `agent` folder so an AI can understand
how to install the product on every employee device, what each role means, what
the project is about, and that Nikolay's computer is always on.

### Implemented

- Added root playbook:
  - `C:\Users\dasmu\agent\AI_DEVICE_INSTALLATION_PLAYBOOK.md`
- Covered:
  - project summary;
  - safety rules;
  - secrets handling;
  - folder layout;
  - control-plane, OpenClaw, Metricon responsibilities;
  - Nikolay/Maksat/PM roles;
  - Nikolay's always-on 24/7 computer;
  - Radmin VPN network model;
  - setup wizard values;
  - Windows/macOS/Linux install flow;
  - role-specific install notes;
  - Telegram commands;
  - token usage analytics;
  - Sonnet model policy;
  - verification checklist;
  - current known gaps;
  - files to read first on a new device.
- Kept secrets out of the playbook.

### Verification

- Confirmed file exists:
  - `C:\Users\dasmu\agent\AI_DEVICE_INSTALLATION_PLAYBOOK.md`
- Scanned playbook and worklog for the known Telegram token fragments; token was
  not found.

### Status

Done. Ready for Claude review.

## 2026-06-03 - Fix Empty control-plane Folder In Root GitHub Repo

### User Question

The user saw that `control-plane` was empty on another device after pushing the
root `agent` repository and asked why, since they had run `git add .` in the
root folder.

### Root Cause

- `control-plane` had previously been its own nested git repository.
- The root `agent` repository had staged it as a gitlink/submodule-like entry:
  mode `160000`, pointing to commit `34bac68...`.
- That means root `git add .` added a pointer to another repo, not the actual
  files.
- Because no usable submodule URL was configured for consumers, cloning the root
  repo on another device produced an empty/broken `control-plane` folder.

### Implemented

- Removed the gitlink from the root repository index:
  - `git rm --cached control-plane`
- Added `control-plane` contents as normal tracked files in the root repo:
  - `git add control-plane`
- Confirmed staged diff now contains real `control-plane` files instead of only
  the `160000` gitlink.

### Status

Ready to commit and push from the root `agent` repo.

## 2026-06-02 - Windows Install And Local Git Preparation

### User Request

Prepare the work so it can be put into GitHub by the user, cloned onto Nikolay's
24/7 Windows computer, and installed/run like an `.exe` with full/admin rights.
The user explicitly said not to push to GitHub; they will push themselves.

### Planned

- Do not push anything to GitHub.
- Make `control-plane` its own local git repository so only this service is
  pushed, not the whole Windows user profile.
- Add Windows full-install scripts for Nikolay's machine.
- Add an `.exe` installer builder.
- Add config templates and install docs.
- Verify tests and installer build locally.

### Implemented

- Added env file loader:
  - `control-plane\src\infra\env.js`
- Added config template:
  - `control-plane\config\control-plane.env.example`
- Added Windows install scripts:
  - `control-plane\scripts\install-windows.ps1`
  - `control-plane\scripts\uninstall-windows.ps1`
  - `control-plane\scripts\restart-windows.ps1`
- Added EXE builder:
  - `control-plane\scripts\build-windows-installer.ps1`
- Added Windows install docs:
  - `control-plane\docs\WINDOWS_INSTALL.md`
- Updated README/review/architecture docs with Windows runtime notes.
- Installer behavior:
  - installs app to `C:\Program Files\CompanyControlPlane`;
  - stores mutable config/data in `C:\ProgramData\CompanyControlPlane`;
  - registers `CompanyControlPlaneApi` Scheduled Task as `SYSTEM` with highest privileges;
  - source install can optionally register `CompanyControlPlaneTelegramBot`;
  - EXE install registers both `CompanyControlPlaneApi` and `CompanyControlPlaneTelegramBot`;
  - `.exe` build bundles `node.exe`;
  - source install can download portable Node.js if `node.exe` is missing.
- Created standalone local git repo inside:
  - `C:\Users\dasmu\agent\control-plane\.git`
- Created local commit:
  - `5935c84 Add company control plane MVP`
- No GitHub push was performed.

### Verification

- `npm test`: 18/18 passed.
- PowerShell syntax checked for installer/build scripts.
- Built local installer:
  - `control-plane\dist\CompanyControlPlaneInstaller.exe`
  - size: about 33.9 MB
- Confirmed `dist`, `data`, and `.env` are gitignored.
- Confirmed `control-plane` has no remote configured.
- Confirmed Kickidler git status is clean.
- OpenClaw still has pre-existing `CLAUDE.md` modifications; Codex did not touch them.

### Status

Done. Ready for user to create GitHub remote and push manually.

## 2026-06-02 - Interactive Setup Wizard And macOS Packaging Scaffold

### User Request

Make the Windows `.exe` installer immediately allow configuring required
services: attach Google OAuth JSON, enter Claude API key, and keep sensitive
values encrypted/masked if shown later. Also prepare macOS install packaging
options (`.app`, `.pkg`, `.dmg`) and desktop shortcut behavior.

### Planned

- Add local setup wizard UI served by the control-plane API.
- Add setup API endpoints for service configuration.
- Add encrypted secret storage for Claude API key, Telegram token, Kickidler
  token, Bitrix webhook, and Google OAuth JSON.
- Keep secrets out of `.env`; display only masked values.
- Make Windows installer start/open setup wizard after install.
- Add macOS app/pkg/dmg scaffold scripts and docs.
- Add tests and rebuild the Windows installer.

### Implemented

- Added setup wizard page:
  - `control-plane\src\setup\setup-page.js`
  - served at `GET /setup`
- Added setup API endpoints:
  - `GET /api/v1/setup/status`
  - `POST /api/v1/setup/services`
- Added encrypted local secret storage:
  - `control-plane\src\setup\secret-store.js`
  - AES-256-GCM encrypted `secrets.json`
  - local `secrets.key`
- Added setup service:
  - `control-plane\src\setup\setup-service.js`
  - stores non-secret settings in `runtime-config.json`
  - applies saved values to runtime env for Telegram/Kickidler/Bitrix/Claude
- Setup wizard supports:
  - Nikolay Telegram ID
  - Telegram bot token
  - Claude API key (`CLAUDE_API_KEY` and `ANTHROPIC_API_KEY`)
  - Google OAuth client JSON upload/paste
  - Kickidler base URL and access token
  - Bitrix incoming webhook URL
- Secret values are shown only as masks in setup status/UI.
- Setup POST updates `u-nikolay` Telegram ID in the MVP JSON store when provided.
- Telegram bot runner now waits for `TELEGRAM_BOT_TOKEN` instead of exiting if
  setup is not complete yet.
- Windows installer updates:
  - added `-OpenSetupWizard` to `scripts\install-windows.ps1`
  - EXE bootstrap now installs API + Telegram task and opens `/setup`
  - rebuilt `dist\CompanyControlPlaneInstaller.exe`
- macOS packaging scaffold:
  - `scripts\macos\build-macos-app.sh`
  - `scripts\macos\build-macos-pkg.sh`
  - `scripts\macos\build-macos-dmg.sh`
  - `docs\MACOS_INSTALL.md`
  - `.pkg` script installs app to `/Applications`, registers LaunchDaemon,
    creates Desktop symlink, and opens setup URL
- Updated README, architecture, Windows install docs, and review notes.
- No GitHub push was performed.

### Verification

- `npm test`: 22/22 passed.
- HTTP smoke on temporary port `3199` passed:
  - `GET /health`
  - `GET /setup`
  - `POST /api/v1/setup/services`
  - confirmed fake Claude/Google secrets were not written as plaintext to
    `secrets.json`
- PowerShell syntax check passed for Windows install/build/restart/uninstall
  scripts.
- `bash -n` syntax check passed for macOS packaging scripts.
- Rebuilt Windows installer:
  - `control-plane\dist\CompanyControlPlaneInstaller.exe`
  - size: about 33.9 MB
  - bootstrap includes `-OpenSetupWizard`

### Open Risks

- Local encryption key is still a file next to encrypted secrets. Production
  should use Windows DPAPI, macOS Keychain, or a managed secret store.
- macOS `.app/.pkg/.dmg` scripts were syntax-checked on Windows but must be
  built and tested on a real Mac.
- Code signing/notarization for Windows and macOS are not configured yet.

### Status

Done. Ready for Claude review.

## 2026-06-02 - Enforce Latest Sonnet For Users

### User Request

Make sure all users automatically use the latest Sonnet version.

### Source Check

- Checked Anthropic/Claude documentation on 2026-06-02.
- Latest Sonnet line found: Sonnet 4.6.
- Direct Claude model id used: `claude-sonnet-4-6`.
- OpenClaw provider-qualified model ref used: `anthropic/claude-sonnet-4-6`.

### Planned

- Do not modify OpenClaw source code.
- Add a company-level model policy in `control-plane`.
- Expose the policy via API for future agent/user installers.
- Apply model env values at runtime.
- Add an OpenClaw config snippet Claude can review.
- Add tests and rebuild installer.

### Implemented

- Added model policy module:
  - `control-plane\src\setup\claude-model-policy.js`
- Added setup API endpoint:
  - `GET /api/v1/setup/model-policy`
- Included `modelPolicy` in:
  - `GET /api/v1/setup/status`
- Runtime env is forced to:
  - `ANTHROPIC_MODEL=claude-sonnet-4-6`
  - `ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6`
  - `CLAUDE_MODEL=claude-sonnet-4-6`
  - `OPENCLAW_DEFAULT_MODEL=anthropic/claude-sonnet-4-6`
- Added OpenClaw config snippet:
  - `control-plane\config\openclaw-model-policy.example.json`
- Added docs:
  - `control-plane\docs\CLAUDE_MODEL_POLICY.md`
- Updated setup UI to display the enforced default model.
- Updated README, architecture, Windows/macOS install docs, and review notes.
- No OpenClaw source code was modified.
- No GitHub push was performed.

### Verification

- `npm test`: 25/25 passed immediately after Sonnet policy implementation.
- Later combined suite after token analytics: `npm test` 29/29 passed.
- HTTP smoke for `/api/v1/setup/model-policy` passed.
- Rebuilt Windows installer with model policy included.

### Open Risks

- Existing OpenClaw sessions pinned to another model may need `/model
  anthropic/claude-sonnet-4-6` or session reset.
- When Anthropic releases a newer Sonnet, update
  `src\setup\claude-model-policy.js`, docs, and installer.

### Status

Done. Ready for Claude review.

## 2026-06-02 - Token Usage Analytics And Telegram Reports

### User Request

Build complete analytics for where every token is spent: which user actions use
the most tokens, which user spent the most, and send reports to Telegram user
`984834133`. The report should include the last 24 hours every day, weekly
statistics, and monthly statistics.

### Planned

- Add token usage event storage in `control-plane`.
- Add API for agents/OpenClaw to record usage events.
- Add aggregation by user, action, model, project, and period.
- Add Telegram scheduled reports only for `984834133`.
- Add manual Telegram command for reports.
- Add tests, docs, and rebuild Windows installer.
- Do not modify OpenClaw source yet.
- Do not push to GitHub.

### Implemented

- Added token usage domain module:
  - `control-plane\src\domain\token-usage.js`
- Added state fields:
  - `tokenUsageEvents`
  - `tokenReportSchedule`
- Added API endpoints:
  - `POST /api/v1/token-usage/events`
  - `GET /api/v1/token-usage/summary?period=day|week|month`
- Token usage event ingest and summary reads write audit events.
- Added optional ingest protection:
  - `TOKEN_USAGE_INGEST_TOKEN`
  - request header `X-Usage-Ingest-Token`
- Added setup fields:
  - `tokenReportRecipientTelegramId`
  - `tokenUsageIngestToken`
- Default report recipient:
  - `984834133`
- Added Telegram scheduled reporter:
  - `control-plane\src\telegram\token-usage-reporter.js`
  - daily report: last 24 hours
  - weekly report: last 7 days
  - monthly report: last 30 days
- Added Telegram command:
  - `/tokens day`
  - `/tokens week`
  - `/tokens month`
- Reports include:
  - total tokens
  - input/output/cache token breakdown
  - optional estimated cost via `costUsd`
  - top users
  - top actions
  - top models
- Added docs:
  - `control-plane\docs\TOKEN_USAGE_ANALYTICS.md`
- Updated README, architecture, Windows/macOS install docs, and review notes.
- Rebuilt Windows installer:
  - `control-plane\dist\CompanyControlPlaneInstaller.exe`
- Improved Windows installer builder to wait until IExpress finishes writing the
  full `.exe` payload instead of returning on the initial stub file.
- No OpenClaw source code was modified.
- No GitHub push was performed.

### Verification

- `npm test`: 29/29 passed.
- HTTP smoke on temporary port `3203` passed:
  - `POST /api/v1/token-usage/events`
  - `GET /api/v1/token-usage/summary?period=day`
  - `GET /api/v1/setup/model-policy`
- PowerShell syntax check passed for Windows scripts.
- `bash -n` syntax check passed for macOS packaging scripts.
- Rebuilt Windows installer:
  - `control-plane\dist\CompanyControlPlaneInstaller.exe`
  - size: about 33.9 MB
  - payload includes token usage code/docs and Sonnet policy.

### Open Risks

- Token analytics only work after agents send usage events. OpenClaw has not
  yet been modified to emit usage automatically.
- Pricing is not calculated automatically yet; agents can pass `costUsd`.
- JSON storage is still MVP storage and should move to Postgres for production.
- Existing Telegram report scheduling uses the long-polling bot process; if that
  task is stopped, reports are not sent.

### Status

Done. Ready for Claude review.

## 2026-06-05 - Telegram Slash Command Menu Cleanup

### User Request

Nikolay sees too many slash commands in Telegram. Some visible commands such as
`tools`, `between`, and `side` are not recognized by the bot and answer
"unknown command". Clean the Telegram command menu, remove unused commands, and
leave only commands that Nikolay and the team will realistically use.

### Implemented

- Added a canonical Telegram command menu:
  - `control-plane\src\telegram\bot-commands.js`
- Kept only the practical product commands in Telegram's visible menu:
  - `/help`
  - `/invite`
  - `/users`
  - `/agents`
  - `/projects`
  - `/bitrix`
  - `/report`
  - `/google_connect`
  - `/google_status`
  - `/tokens`
  - `/ai_status`
- Explicitly did not expose old/noisy commands in the Telegram menu:
  - `/tools`
  - `/between`
  - `/side`
  - `/project`
  - `/google_disconnect`
- Kept `/project`, `/me`, `/register`, and `/google_disconnect` handlers working
  for backward compatibility and manual instructions, but they are no longer
  part of the slash suggestion menu.
- Added Telegram Bot API support for:
  - `setMyCommands`
  - `getMyCommands`
- Updated the bot startup loop so, after a valid Telegram token is available, it
  calls `setMyCommands` once per token and synchronizes Telegram's visible menu.
- Updated `/help` so it mirrors the cleaned command menu and explains the manual
  registration flow.
- Improved unknown slash command response:
  - tells the user to use `/help`;
  - explains that a visible-but-unknown command can be Telegram's cached old menu.

### Files Changed

- `control-plane\src\telegram\bot-commands.js`
- `control-plane\src\telegram\telegram-api.js`
- `control-plane\src\telegram-bot.js`
- `control-plane\src\telegram\handler.js`
- `control-plane\test\telegram.test.js`
- `control-plane\test\telegram-api.test.js`

### Verification

- `npm test`: 43/43 passed locally.

### Deployment Notes

- Deployed to the current production VPS.
- Restarted `company-control-plane-telegram-bot.service`.
- Service log confirmed:
  - `telegram command menu synchronized (11 commands)`
- Direct Telegram API `getMyCommands` check confirmed the visible menu now
  contains only the 11 canonical commands listed above.
- Telegram clients may cache command suggestions for a few minutes; if Nikolay
  still sees the old list immediately after deployment, reopen Telegram or wait
  a short time.

### Status

Done. Ready for Claude review.

## 2026-06-05 - Current Active Worklog Pointer

Latest active implementation notes for Claude review are in the section:
`2026-06-05 - Telegram Voice Assistant + Maksat Bitrix Context Fix`.

That detailed section is appended below and should be reviewed together with the
current git diff.

## 2026-06-05 - Telegram Voice Assistant + Maksat Bitrix Context Fix

### User Request

Add support for Telegram voice messages:

- user sends a Telegram voice message;
- bot converts voice to text via STT;
- text goes through the existing Claude/company assistant flow;
- if the user asks to answer by voice, bot uses ElevenLabs TTS and sends an
  audio/voice response.

Also fix a regression where a request like:

`Дай сводку максата за неделю с 1 по 5 июня... что у него по проектам в битриксе`

did not load Maksat's Bitrix user tasks and Claude answered that Maksat's Bitrix
data was missing from context.

### Implemented - Voice

- Added encrypted setup secrets:
  - `elevenLabsApiKey`
  - `sttApiKey`
- Added setup/runtime settings:
  - `voiceAssistantEnabled`
  - `voiceReplyMode`
  - `sttProvider`
  - `sttModel`
  - `sttLanguageCode`
  - `elevenLabsVoiceId`
  - `elevenLabsTtsModel`
  - `elevenLabsOutputFormat`
- Updated `/setup` page with a `Voice Assistant` section.
- Added env mapping:
  - `VOICE_ASSISTANT_ENABLED`
  - `VOICE_REPLY_MODE`
  - `STT_PROVIDER`
  - `STT_MODEL`
  - `STT_LANGUAGE_CODE`
  - `ELEVENLABS_VOICE_ID`
  - `ELEVENLABS_TTS_MODEL`
  - `ELEVENLABS_OUTPUT_FORMAT`
  - `ELEVENLABS_API_KEY`
  - `STT_API_KEY`
- Added voice integration module:
  - `control-plane\src\integrations\voice-service.js`
- STT support:
  - ElevenLabs `/v1/speech-to-text`
  - OpenAI `/v1/audio/transcriptions`
- TTS support:
  - ElevenLabs `/v1/text-to-speech/:voice_id`
- Telegram API support:
  - `getFile`
  - file download through Telegram file URL
  - `sendVoice` multipart upload
- Telegram handler now:
  - accepts `message.voice`;
  - transcribes it;
  - passes transcript into the same existing text assistant flow;
  - detects requests such as `ответь голосом`;
  - sends ElevenLabs voice reply when configured;
  - falls back to a clear text response if TTS is not configured or fails.
- `telegram-bot.js` now creates `voiceService` from env/setup each polling turn.

### Implemented - Maksat Bitrix Context Fix

- Root cause:
  - user said `максата` in Cyrillic/genitive;
  - local user seed has `displayName: "Maksat"` in Latin;
  - matcher did not know that `максат`, `максата`, and `maksat` are the same
    person;
  - matcher also used numeric Metricon IDs as aliases, so date numbers like
    `1` and `5` could accidentally match unrelated users.
- Added explicit person aliases in `company-assistant.js`:
  - Nikolay: `николай`, `николая`, etc.
  - Maksat: `максат`, `максата`, `максату`, `maksat`
  - Begayym/PM1 aliases
  - PM2/PM3 aliases
- Filtered out aliases shorter than 2 characters to prevent date numbers from
  matching users.
- Added a regression test for the exact class of request:
  - `сводку максата ... с 1 по 5 июня ... битриксе`
  - verifies target user is `u-maksat`;
  - verifies `getUserTasks` is called for `u-maksat`;
  - verifies Bitrix task data is present in the Claude context.

### Files Changed

- `control-plane\src\setup\setup-service.js`
- `control-plane\src\setup\setup-page.js`
- `control-plane\src\integrations\voice-service.js`
- `control-plane\src\telegram\telegram-api.js`
- `control-plane\src\telegram\handler.js`
- `control-plane\src\telegram-bot.js`
- `control-plane\src\assistant\company-assistant.js`
- `control-plane\config\control-plane.env.example`
- `control-plane\test\setup-service.test.js`
- `control-plane\test\telegram-api.test.js`
- `control-plane\test\telegram.test.js`
- `control-plane\test\voice-service.test.js`

### Verification

- `npm test`: 57/57 passed locally.
- Production VPS `npm test`: 38/38 passed after deployment.
- Additional mojibake scan over changed setup/voice/telegram files found zero
  matches for common broken UTF-8 patterns.
- Secret scan found no real user-provided secrets in changed files/worklog.

### Claude Review Focus

- Check multipart usage for Telegram `sendVoice` and STT requests.
- Check whether sending MP3 through `sendVoice` is acceptable for Telegram in
  production; if Telegram rejects MP3 voice files, switch ElevenLabs
  `ELEVENLABS_OUTPUT_FORMAT` to an Opus format or add server-side conversion.
- Check that STT/TTS failures cannot break normal text replies.
- Check aliases for Cyrillic names and add more real employee names as the user
  provides them.

### Deployment Notes

- Deployed to production VPS:
  - `/opt/company-control-plane`
- Restarted services:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Verified both services are active.
- Telegram bot log confirmed:
  - `telegram bot polling started`
  - `telegram command menu synchronized (17 commands)`
- API log confirmed:
  - app is listening on `127.0.0.1:3099`
  - Metricon connector configured
  - Bitrix connector configured
- No GitHub push was performed.

### Status

Done. Ready for Claude review.

## 2026-06-05 - Telegram Report Formatting Cleanup

### User Request

Telegram bot answers contain unreadable mojibake/noisy symbols and the reports
are hard to read. Make bot answers beautiful, clear, convenient, and rich enough
for Nikolay, Maksat, and PM users.

### Implemented

- Reworked Telegram-facing messages into a consistent HTML-safe style:
  - bold title at the top;
  - short sections;
  - key/value lines for important metrics;
  - readable command hints in `<code>`;
  - dynamic user/task/project values escaped for Telegram `parse_mode=HTML`.
- Cleaned the visible Telegram command descriptions:
  - `/help`
  - `/invite`
  - `/users`
  - `/agents`
  - `/projects`
  - `/today`
  - `/plan`
  - `/progress`
  - `/blocker`
  - `/done`
  - `/daily_report`
  - `/bitrix`
  - `/report`
  - `/google_connect`
  - `/google_status`
  - `/tokens`
  - `/ai_status`
- Improved daily assistant messages:
  - morning plan reminder is now formatted and clear;
  - afternoon progress check is clearer;
  - evening day-close reminder explains `/today`, `/done`, and `/blocker`;
  - progress reports now have sections for results, plan, Bitrix assigned tasks,
    Bitrix risks, Metricon, and blockers.
- Improved manager daily report formatting:
  - summary section;
  - per-employee line;
  - risks section.
- Improved Bitrix Telegram report:
  - source/config status;
  - total/open/completed/overdue counts;
  - translated task status labels;
  - responsible person, deadline, and group when available;
  - if no project tasks are found, the message now explains likely causes.
- Improved Metricon Telegram report:
  - source/config status;
  - employee activity and idle time;
  - clearer empty-data message.
- Improved Claude free-form assistant behavior:
  - system prompt now asks for Telegram-friendly Russian answers;
  - no Markdown tables, JSON dumps, raw debug context, or noisy symbols;
  - answer should start with a useful conclusion, then facts, then next checks.
- Reworked token usage reports:
  - Russian labels;
  - HTML-safe bold sections;
  - daily/weekly/monthly labels are in Russian;
  - token and request counts use Russian plural forms;
  - reports are no longer escaped wholesale by the Telegram reporter, because
    the formatter itself safely escapes dynamic values.
- Updated tests to assert the new Telegram/report format.

### Files Changed

- `control-plane\src\telegram\handler.js`
- `control-plane\src\telegram\bot-commands.js`
- `control-plane\src\telegram\token-usage-reporter.js`
- `control-plane\src\domain\daily-assistant.js`
- `control-plane\src\domain\token-usage.js`
- `control-plane\src\assistant\company-assistant.js`
- `control-plane\test\telegram.test.js`
- `control-plane\test\token-usage.test.js`
- `control-plane\test\token-usage-reporter.test.js`

### Verification

- `npm test`: 51/51 passed locally.
- Production VPS `npm test`: 29/29 passed after deployment.
- Additional mojibake scan over Telegram/report source and related tests found
  zero matches for common broken UTF-8 patterns such as `Рџ`, `СЃ`, `вЂ`.

### Claude Review Focus

- Check that every Telegram message sent with HTML parse mode has dynamic data
  escaped.
- Check that token usage reports are safe now that
  `token-usage-reporter.js` sends the formatter output directly.
- Check whether the wording is product-friendly enough for the Starlab team.
- Check that the command menu still contains only commands that real users need.

### Deployment Notes

- Deployed to production VPS:
  - `/opt/company-control-plane`
- Restarted services:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Verified both services are active.
- Telegram bot log confirmed:
  - `telegram bot polling started`
  - `telegram command menu synchronized (17 commands)`
- API log confirmed:
  - app is listening on `127.0.0.1:3099`
  - Metricon connector configured
  - Bitrix connector configured
- No GitHub push was performed.

### Status

Done. Ready for Claude review.
## 2026-06-08 - n8n migration MVP deployed to production server

### User request

User decided the previous custom control-plane approach should be moved to n8n and asked to get a working project running urgently on the new Linux server. The user also asked to use the browser if possible, keep the current domain, preserve the data already entered in `/setup`, and keep writing detailed notes here for Claude review.

### Server

- Server: `195.238.122.228`
- Domain: `https://starlabagent.pp.ua`
- n8n install directory: `/opt/starlab-n8n`
- Existing custom app directory preserved: `/opt/company-control-plane`
- Existing state/secrets preserved: `/var/lib/company-control-plane`
- n8n version observed in logs: `2.23.4`

### Installed/changed on server

- Installed Docker and Docker Compose.
- Created `/opt/starlab-n8n/docker-compose.yml` with:
  - `postgres:16-alpine`
  - `n8nio/n8n:latest`
  - n8n bound only to `127.0.0.1:5678`
  - Docker volumes `postgres_data` and `n8n_data`
  - read-only mount of `/var/lib/company-control-plane` into n8n as `/legacy-data`
  - `NODE_FUNCTION_ALLOW_BUILTIN=fs,path,crypto` so the n8n Code node can read the legacy encrypted store
  - `extra_hosts: host.docker.internal:host-gateway`
- Created `/opt/starlab-n8n/.env` with secrets copied from the old setup store without printing them:
  - Telegram bot token
  - Claude API key
  - Bitrix webhook URL
  - Metricon base/tokens if configured
  - ElevenLabs/STT values if configured
  - generated Postgres/n8n encryption secrets
- Created n8n owner account:
  - email: `openclawstarlab@gmail.com`
  - password is stored only on server in `/opt/starlab-n8n/admin-credentials.txt`
  - do not commit or print that file
- Adjusted permissions:
  - `/var/lib/company-control-plane` remains owned by `company-control-plane`
  - n8n container user is added to group `998`
  - legacy `secrets.json` and `secrets.key` are group-readable by that service group
  - this is intentionally limited to the n8n container, not world-readable
- Removed deprecated `N8N_RUNNERS_ENABLED` from `.env` and recreated only the n8n container.
- Current non-blocking log warning:
  - n8n warns that Python task runner is missing.
  - JS Task Runner is registered and the current workflow uses JavaScript Code node only.
  - This should be reviewed later for production hardening, but it is not blocking the current MVP.

### Nginx/domain routing

Nginx now routes:

- `/` -> n8n on `127.0.0.1:5678`
- `/webhook/` -> n8n webhook endpoint, no basic auth
- `/webhook-test/` -> n8n test webhook endpoint
- `/control-plane/` -> old custom API on `127.0.0.1:3099`, still behind basic auth
- `/api/v1/google/oauth/callback` -> old custom API, no basic auth, kept so existing Google OAuth callback continues working
- `/api/v1/device-agents/heartbeat` -> old custom API, no basic auth, kept so installed device agents keep heartbeating

Browser check opened `https://starlabagent.pp.ua/` and confirmed n8n sign-in page is reachable over HTTPS.

### Local files added for review/versioning

- `C:/Users/dasmu/agent/n8n/starlab-agent-code.n8n.js`
  - Source for the n8n Code node.
  - Contains Telegram update handling, Bitrix reads, Google calendar reads, Claude calls, and optional voice logic.
- `C:/Users/dasmu/agent/n8n/generate-workflow.mjs`
  - Generates the importable n8n workflow JSON from the Code node source.
- `C:/Users/dasmu/agent/n8n/starlab-agent-mvp.workflow.json`
  - Generated workflow imported into n8n.

### n8n workflow deployed

Workflow:

- Name: `Starlab Agent - Telegram n8n MVP`
- ID: `starlabTelegramMvp01`
- Active: yes
- Production webhook: `https://starlabagent.pp.ua/webhook/starlab-telegram`
- Nodes:
  - `Telegram Webhook` (`n8n-nodes-base.webhook`)
  - `Starlab Agent Brain` (`n8n-nodes-base.code`)

The workflow was imported via:

- `n8n import:workflow --input=/workflows/starlab-agent-mvp.workflow.json --userId=...`
- then activated with `n8n update:workflow --id=starlabTelegramMvp01 --active=true`
- n8n container was restarted/recreated after activation so active workflows loaded.

### Telegram switch

- Old polling service stopped and disabled:
  - `company-control-plane-telegram-bot.service`
  - status after switch: `inactive`, `disabled`
- Telegram bot webhook set to:
  - `https://starlabagent.pp.ua/webhook/starlab-telegram`
- Telegram webhook info verified:
  - `ok: true`
  - `pending_update_count: 0`
  - `ip_address: 195.238.122.228`
  - `allowed_updates: ["message", "edited_message"]`
- Bot command menu replaced with a shorter practical menu:
  - `/start`
  - `/help`
  - `/agents`
  - `/bitrix`
  - `/google_connect`
  - `/google_status`
  - `/ai_status`
  - `/tokens`

### What the n8n MVP currently does

Telegram commands:

- `/help`
  - Sends compact usage/help text.
- `/agents`
  - Reads legacy state and lists visible device agents according to role.
- `/bitrix TARGET`
  - Reads Bitrix tasks by responsible user first.
  - Also supports project task context in free-form questions.
  - Uses read-only Bitrix guard inside the n8n code.
- `/google_connect`
  - Builds Google OAuth URL using the existing Google OAuth client JSON from the legacy encrypted store.
  - Keeps callback pointed to old control-plane `/api/v1/google/oauth/callback`, so tokens continue to be saved in the existing encrypted store.
- `/google_status`
  - Reads encrypted Google token status for the actor.
- `/ai_status`
  - Calls Claude API and reports whether it is available.
- `/tokens`
  - Owner-only placeholder summary from legacy token usage events for the last 24 hours.
  - Full n8n token usage recording is still TODO.

Free-form messages:

- Parses Telegram message text.
- Resolves actor by Telegram ID from legacy state.
- Applies role scope:
  - OWNER can see everyone.
  - SENIOR_PM sees self and subordinate PMs.
  - PM sees self.
- Resolves target users from aliases:
  - Nikolay
  - Maksat
  - Begayym / PM1
  - PM2 / PM3 placeholders
- Builds context from:
  - legacy users/projects/device agents
  - Bitrix user tasks by `RESPONSIBLE_ID`
  - Bitrix project tasks by `GROUP_ID`
  - Google primary calendar
  - Google shared calendars, i.e. Google Calendar "Other calendars"
- For calendar/schedule questions:
  - reads connected Google accounts
  - reads `calendarList`
  - searches shared calendars by target/user aliases and phrases from the question
  - reads events from matched shared calendars
  - summarizes event counts and hours
- Sends context to Claude `claude-sonnet-4-6`.
- Prompts Claude to answer in clean Russian Telegram style:
  - short title
  - "Коротко"
  - "Детали"
  - "Что проверить дальше" only if useful
  - no raw JSON/debug/webhook/token output
  - no Markdown tables

Voice support in MVP:

- Incoming Telegram voice messages:
  - downloads Telegram voice file
  - sends to ElevenLabs Speech-to-Text if `STT_API_KEY` or `ELEVENLABS_API_KEY` is configured
  - uses the transcript as the user request
- Voice replies:
  - if user asks "ответь голосом"/"голосом", workflow tries ElevenLabs TTS
  - requires `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`
  - sends audio back to Telegram as an audio file
- This is implemented in the n8n Code node, but should be reviewed with real ElevenLabs credentials and a real voice test.

### Verification performed

Server/container:

- `docker-compose ps` shows:
  - `starlab-n8n_n8n_1` up on `127.0.0.1:5678`
  - `starlab-n8n_postgres_1` up and healthy
- Active n8n workflow verified:
  - `starlabTelegramMvp01`
- Production webhook empty POST verified:
  - `POST http://127.0.0.1:5678/webhook/starlab-telegram`
  - response: `{"message":"Workflow was started"}`

Telegram:

- Telegram webhook set successfully.
- Old polling bot disabled successfully.
- Test Telegram-style webhook updates were sent locally for Nikolay's registered Telegram ID:
  - `/help`
  - `/ai_status`
  - `/bitrix maksat`
  - free text: `Какие задачи сейчас у Максата в Битриксе?`
- n8n logs did not show workflow errors from these tests.

Claude:

- Direct call from n8n container to Anthropic API succeeded:
  - model: `claude-sonnet-4-6`
  - HTTP: `200`
  - answer: `OK`
  - this confirms the earlier `Request not allowed` issue is resolved on the new Germany server.

Bitrix:

- Direct n8n-container read-only call to Bitrix succeeded:
  - method: `tasks.task.list`
  - filter: `RESPONSIBLE_ID: 1` for Maksat
  - returned 35 tasks
  - sample task IDs observed: `1807`, `1803`, `1741`
- This confirms the "Bitrix returns 0 tasks" issue is fixed for Maksat's responsible-user task lookup.

Google:

- Direct encrypted-token check from n8n container:
  - `u-nikolay` connected as `openclawstarlab@gmail.com`, 1 calendar
  - `u-maksat` connected as `maksatsultanalieb155@gmail.com`, 17 calendars
  - `u-pm-1` connected as `starlabpm@gmail.com`, 26 calendars
- PM1 account calendar list includes shared/other calendars, which is required for the user's "Другие календари" scenario.

Browser:

- Opened `https://starlabagent.pp.ua/` in Codex in-app browser.
- n8n sign-in page rendered.

### Security/read-only notes for Claude review

- Bitrix write/delete/edit methods are blocked in the n8n Code node by a local allowlist.
- Current allowed methods in n8n code are read-only:
  - `tasks.task.list`
  - `tasks.task.get`
  - `user.get`
  - `user.search`
  - `sonet_group.get`
  - `socialnetwork.api.workgroup.list`
- The Bitrix webhook may have high privileges in Bitrix, so Claude should review that no method can be user-controlled outside the allowlist.
- n8n reads old encrypted secrets via mounted `/legacy-data`; this is pragmatic for MVP and preserving existing setup, but should be reviewed for production hardening.
- Admin credentials for n8n are stored on server only in `/opt/starlab-n8n/admin-credentials.txt`; never commit them.
- `.env` under `/opt/starlab-n8n` contains live secrets; never commit it.

### Known gaps / next steps

- Metricon integration is not yet implemented inside the n8n workflow. Tokens/env are present, but the MVP response context currently focuses on Bitrix, Google, devices, and Claude.
- Daily assistant logic (`/plan`, `/done`, blockers, nudges, daily reports) is not fully migrated to n8n yet.
- Token usage accounting for n8n Claude calls is not yet persisted into legacy `tokenUsageEvents`.
- Scheduled daily/weekly/monthly reports should be recreated as n8n Cron workflows.
- Better n8n-native structure should replace the big MVP Code node:
  - separate Bitrix node/workflow
  - separate Google node/workflow
  - separate Claude node/workflow
  - separate Telegram formatter node
  - separate error/reporting workflow
- Voice STT/TTS needs real Telegram voice message testing.
- n8n Python task runner warning remains non-blocking; review external runners or image config later.

### Files for Claude to review first

1. `C:/Users/dasmu/agent/n8n/starlab-agent-code.n8n.js`
2. `C:/Users/dasmu/agent/n8n/generate-workflow.mjs`
3. `C:/Users/dasmu/agent/n8n/starlab-agent-mvp.workflow.json`
4. Server config: `/opt/starlab-n8n/docker-compose.yml`
5. Server Nginx site: `/etc/nginx/sites-available/starlabagent.pp.ua`

## 2026-06-08 - Nikolay device/OpenClaw heartbeat mirrored into n8n

### User request

User asked whether I can connect Nikolay's OpenClaw/device agent on his computer to n8n.

### Nikolay PC access/status

- Host checked: `192.168.1.199`
- SSH port: open.
- SSH login with Windows PIN failed, but Microsoft account password worked.
- Hostname: `WIN-5IMJD8NIIM7`
- Remote user: `win-5imjd8niim7\dasmu`
- Scheduled task found:
  - `CompanyControlPlaneDeviceAgent`
  - Action: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\ProgramData\CompanyControlPlaneAgent\run-device-agent.ps1"`
- Main installed config:
  - `C:\ProgramData\CompanyControlPlaneAgent\config\device-agent.env`
  - `CONTROL_PLANE_URL=https://starlabagent.pp.ua`
  - `DEVICE_AGENT_ID=nikolay-windows`
  - `DEVICE_AGENT_USER_ID=u-nikolay`
  - `DEVICE_AGENT_DISPLAY_NAME=Nikolay Windows`
  - `DEVICE_AGENT_LABELS={"role":"OWNER","person":"Nikolay","mode":"system"}`
  - token exists but was not printed in chat or worklog.
- Legacy local config also exists under:
  - `C:\Users\dasmu\AppData\Local\CompanyControlPlaneAgent\config\device-agent.env`
- Logs:
  - `C:\ProgramData\CompanyControlPlaneAgent\logs\device-agent.out.log`
  - `C:\ProgramData\CompanyControlPlaneAgent\logs\device-agent.err.log`

### n8n workflows added/fixed

Added a new workflow:

- Name: `Starlab Device Heartbeat Mirror`
- ID: `starlabDeviceHeartbeatMirror01`
- Webhook: `POST /webhook/device-agent-heartbeat`
- Local source files:
  - `C:/Users/dasmu/agent/n8n/device-heartbeat-code.n8n.js`
  - `C:/Users/dasmu/agent/n8n/generate-device-heartbeat-workflow.mjs`
  - `C:/Users/dasmu/agent/n8n/starlab-device-heartbeat.workflow.json`

What it does:

- Receives mirrored device heartbeat JSON.
- Stores latest device snapshot in:
  - `/opt/starlab-n8n/data/device-heartbeats.json`
- Current snapshot format:
  - `version`
  - `updatedAt`
  - `totalReceived`
  - `devices[deviceId]`
  - each device contains user/device/host/platform/labels/firstSeenAt/lastSeenAt/heartbeatCount/source/remoteAddress.

Docker-compose updated:

- n8n now mounts:
  - `/opt/starlab-n8n/data:/data`
- n8n env:
  - `STARLAB_N8N_DATA_DIR=/data`
- n8n `NODE_FUNCTION_ALLOW_BUILTIN` expanded to:
  - `fs,path,crypto,http,https,url`

### Important n8n sandbox fix

During testing, the Telegram workflow was discovered to be failing in production executions because n8n Code node sandbox does not expose:

- `process.env`
- global `fetch`
- global `URL`

Fixes applied:

- `starlab-agent-code.n8n.js` no longer relies on `process.env`.
- Live secrets are read from the legacy encrypted store mounted at `/legacy-data`:
  - `telegramBotToken`
  - `claudeApiKey`
  - `bitrixWebhookUrl`
  - `elevenLabsApiKey`
  - `sttApiKey`
- Added a lightweight internal `fetch()` wrapper using Node built-ins:
  - `http`
  - `https`
  - `url`
- Reimported and reactivated workflow `starlabTelegramMvp01`.
- Verified `/ai_status` execution became `success` after the patch.

Claude should review this carefully. The wrapper covers JSON/text/x-www-form-urlencoded requests used by Telegram/Claude/Bitrix/Google. Multipart voice upload/download should still be reviewed separately before considering voice production-ready.

### Nginx mirror added

Nginx site changed:

- `/etc/nginx/sites-available/starlabagent.pp.ua`

Backup created on server before edit:

- `/etc/nginx/sites-available/starlabagent.pp.ua.bak-before-device-heartbeat-mirror-<timestamp>`

Heartbeat locations now include:

- `mirror /_n8n_device_heartbeat_mirror;`
- `mirror_request_body on;`

Internal mirror location:

- `location = /_n8n_device_heartbeat_mirror`
- proxies to:
  - `http://127.0.0.1:5678/webhook/device-agent-heartbeat`

Reason for mirror approach:

- Nikolay's installed device agent continues posting to the existing endpoint:
  - `https://starlabagent.pp.ua/api/v1/device-agents/heartbeat`
- Existing custom control-plane still receives and validates the real heartbeat.
- n8n receives a copy in the background.
- No change was required on Nikolay's PC config, so risk is lower.

### Verification

Server-side nginx mirror test:

- Posted a test heartbeat to:
  - `https://starlabagent.pp.ua/api/v1/device-agents/heartbeat`
- Old control-plane correctly returned `401` without token.
- n8n still received the mirrored request.
- `starlabDeviceHeartbeatMirror01` execution status: `success`.

Real Nikolay PC test:

- Started scheduled task on Nikolay PC:
  - `Start-ScheduledTask -TaskName CompanyControlPlaneDeviceAgent`
- Task state became:
  - `Running`
- Nikolay PC log showed:
  - `[device-agent] heartbeat ok status=online count=487`
- n8n snapshot updated:
  - file: `/opt/starlab-n8n/data/device-heartbeats.json`
  - device: `nikolay-windows`
  - user: `u-nikolay`
  - hostname: `WIN-5IMJD8NIIM7`
  - platform: `win32`
  - osRelease: `10.0.26200`
  - labels: `{"role":"OWNER","person":"Nikolay","mode":"system"}`
  - source: `nginx-mirror`
  - lastSeenAt: `2026-06-08T09:55:04.726Z`
  - remoteAddress observed: `185.138.103.254`
- Recent n8n heartbeat execution:
  - workflow: `starlabDeviceHeartbeatMirror01`
  - status: `success`

### Current state after this work

- Nikolay's installed device/OpenClaw heartbeat path is now connected to n8n.
- Old control-plane still remains the source of truth for device heartbeat API validation.
- n8n has its own live snapshot file for device status.
- Telegram workflow was repaired after sandbox issues and `/ai_status` was verified as success.

### Follow-ups

- Add the n8n device snapshot into Telegram `/agents` responses or AI context directly instead of only legacy `control-plane.json`.
- Mirror/route Maksat and PM device heartbeats the same way; likely already covered globally because nginx mirrors the shared heartbeat endpoint, but verify each device produces entries in `/opt/starlab-n8n/data/device-heartbeats.json`.
- Consider replacing mirror with full n8n-owned device heartbeat API after n8n workflows become the primary source of truth.
- Add a UI/Data Table in n8n for current devices instead of JSON file only.
- Remove test entries from `/opt/starlab-n8n/data/device-heartbeats.json` if desired.

## 2026-06-08 - n8n Telegram workflow modular refactor

User request:

- Replace the current n8n "one huge JS file" Telegram workflow with a readable workflow tree similar to the training screenshot.
- Keep the implementation understandable, correct, and working.
- Keep Telegram replies clean and readable, without mojibake/garbage symbols.
- Remove unnecessary Telegram slash commands from the bot menu.

### Local files added

Directory:

- `C:\Users\dasmu\agent\n8n\modular`

New modular Code node source files:

- `01-parse-telegram.n8n.js`
  - Parses Telegram webhook updates.
  - Extracts chat id, Telegram user id, text, command, voice metadata, and timestamp.
- `02-access-scope.n8n.js`
  - Reads legacy state from `/legacy-data/control-plane.json`.
  - Resolves actor by Telegram id.
  - Applies role hierarchy:
    - OWNER can see all users.
    - SENIOR_PM can see self and direct PMs.
    - PM can see self.
  - Resolves target employees from natural language aliases.
  - Handles `/help`, `/google_connect`, `/tokens`.
  - Computes whether the request needs Bitrix, Google, device, or Claude context.
- `03-bitrix-context.n8n.js`
  - Reads Bitrix webhook from encrypted legacy secrets.
  - Calls Bitrix REST for target users.
  - Collects task summary for user tasks.
  - Formats direct `/bitrix` command response.
- `04-google-context.n8n.js`
  - Reads Google OAuth tokens from encrypted legacy secrets.
  - Refreshes Google access token.
  - Reads Google Calendar list.
  - Important: intentionally searches non-primary calendars from Google Calendar `calendarList`, so PM accounts can answer from "Other calendars" / "Другие календари" such as `Бегайым ПМ`, `Максат`, `Daniel UX/UI`, etc.
  - Reads calendar events for the requested period.
- `05-device-context.n8n.js`
  - Reads n8n device heartbeat snapshot from `/data/device-heartbeats.json`.
  - Reads legacy device agent state.
  - Formats `/agents` response.
- `06-claude-response.n8n.js`
  - Calls Claude with gathered Bitrix, Google, device, actor, and access context.
  - Uses model `claude-sonnet-4-6`.
  - System prompt asks for Russian, clean, readable Telegram reports and no JSON/debug noise.
  - Includes fallback text if Claude API is temporarily unavailable.
- `07-send-telegram.n8n.js`
  - Reads Telegram bot token from encrypted legacy secrets.
  - Sends response through Telegram Bot API.
  - Splits long Telegram messages into safe chunks.

New workflow generator:

- `C:\Users\dasmu\agent\n8n\generate-modular-telegram-workflow.mjs`

Generated workflow JSON:

- `C:\Users\dasmu\agent\n8n\starlab-telegram-modular.workflow.json`

The generated n8n workflow has these visible nodes:

1. `Telegram Webhook`
2. `Parse Telegram Update`
3. `Access Scope & Commands`
4. `Bitrix Context`
5. `Google Calendar Context`
6. `Device Context`
7. `Claude Response`
8. `Send Telegram Response`

### Server deployment

Server:

- `root@195.238.122.228`

n8n path:

- `/opt/starlab-n8n`

Uploaded workflow:

- `/opt/starlab-n8n/workflows/starlab-telegram-modular.workflow.json`
- `/opt/starlab-n8n/workflows/starlab-agent-main-active.workflow.json`

Imported into existing workflow id:

- `starlabTelegramMvp01`

Active workflow name after import:

- `Starlab Agent - Telegram Modular`

The existing webhook path stayed unchanged:

- `/webhook/starlab-telegram`

This means Telegram webhook did not need to be changed.

n8n was restarted after import because n8n CLI warned that workflow changes do not fully apply while the service is already running.

### Telegram command menu cleanup

Telegram Bot API `setMyCommands` was called successfully.

Remaining bot menu commands:

- `/help` - help and examples
- `/agents` - connected device status
- `/bitrix` - Bitrix tasks/projects for employee
- `/google_connect` - connect Google account
- `/google_status` - check Google connection
- `/ai_status` - check Claude API
- `/tokens` - token usage for last 24 hours

Result from Telegram API:

- HTTP `200`
- `{"ok":true,"result":true}`

Note for reviewer:

- Telegram clients can cache slash commands briefly. If old commands still appear, restart Telegram or wait for cache refresh.

### Verification performed

Local:

- Generated workflow JSON successfully with Node.js.
- Parsed generated JSON and verified:
  - workflow name: `Starlab Agent - Telegram Modular`
  - node count: `8`
  - visible node chain is correct.
- Syntax-checked each modular Code node by compiling it with an async function wrapper:
  - `01-parse-telegram.n8n.js`: OK
  - `02-access-scope.n8n.js`: OK
  - `03-bitrix-context.n8n.js`: OK
  - `04-google-context.n8n.js`: OK
  - `05-device-context.n8n.js`: OK
  - `06-claude-response.n8n.js`: OK
  - `07-send-telegram.n8n.js`: OK

Server:

- n8n container restarted successfully.
- n8n healthcheck:
  - `{"status":"ok"}`
- Active workflows after import:
  - `starlabTelegramMvp01|Starlab Agent - Telegram Modular`
  - `starlabDeviceHeartbeatMirror01|Starlab Device Heartbeat Mirror`
- Test Telegram webhook executions:
  - `/agents`: execution `421`, status `success`
  - `/ai_status`: execution `422`, status `success`
  - `/bitrix maksat`: execution `426`, status `success`
- Device heartbeat mirror continued working after restart:
  - recent executions for `starlabDeviceHeartbeatMirror01` continued returning `success`.

### Important caveats / review points

- This refactor keeps the workflow reliable and readable, but it is still a single main Telegram workflow with multiple small Code nodes. It is not yet split into separate n8n sub-workflows/tools with `Execute Workflow` nodes.
- Voice input/output is not implemented in this modular workflow yet. The setup UI may have ElevenLabs/STT fields from earlier control-plane work, but the n8n voice branch still needs a dedicated implementation.
- Registration/invite management should be reviewed. The current modular workflow preserves the same command surface as the previous n8n MVP, but full invite-code creation/registration may still live in the old control-plane implementation and should be migrated into n8n if n8n becomes the only production bot brain.
- Google "Other calendars" support depends on the connected Google account actually seeing those calendars through the Google Calendar API. If a calendar is visible in the browser but not returned by `calendarList`, check Google permissions/sharing and OAuth scopes.
- Claude API availability is still dependent on Anthropic account/model access. The workflow uses `claude-sonnet-4-6` as requested earlier, but if Anthropic returns 403, Telegram will receive a fallback/error-style answer.

## 2026-06-08 - Correction: replaced modular Code workflow with native n8n visual blocks

User correction:

- The previous "modular" n8n workflow was still mostly Code nodes.
- User wanted a real n8n constructor-style workflow like the screenshot:
  - visible `Switch`
  - visible `Set/Edit Fields`
  - visible `HTTP Request`
  - visible branches for commands and AI context
  - no single hidden JS brain.

This correction was implemented.

### What changed

New generator added:

- `C:\Users\dasmu\agent\n8n\generate-visual-native-telegram-workflow.mjs`

Generated workflow:

- `C:\Users\dasmu\agent\n8n\starlab-telegram-visual-native.workflow.json`

Server copy:

- `/opt/starlab-n8n/workflows/starlab-telegram-visual-native.workflow.json`
- `/opt/starlab-n8n/workflows/starlab-agent-main-active.workflow.json`

Active workflow ID stayed unchanged:

- `starlabTelegramMvp01`

Active workflow name is now:

- `Starlab Agent - Telegram Visual Native`

### Important architectural correction

The new n8n workflow is a visual orchestrator.

It uses native n8n nodes for the flow:

- `Webhook`
- `Set`
- `Switch`
- `HTTP Request`

The workflow now calls the existing control-plane API instead of reimplementing Bitrix/Google/device/user policy inside a giant JS node.

Reason:

- control-plane already has tested endpoints for:
  - actor resolution by Telegram id
  - role hierarchy
  - accessible users/projects
  - Google OAuth/status/snapshot
  - Bitrix project status report
  - device agents
  - token usage
- n8n should show orchestration visually, while business rules stay in the backend API where tests and guards exist.

### Visual workflow node list

The active workflow has 24 nodes:

1. `Telegram Webhook` - `webhook`
2. `Extract Telegram Message` - `set`
3. `Route Request` - `switch`
4. `Prepare Help Text` - `set`
5. `Get Device Agents` - `httpRequest`
6. `Format Agents Report` - `set`
7. `Start Google OAuth` - `httpRequest`
8. `Format Google Connect` - `set`
9. `Get Google Status` - `httpRequest`
10. `Format Google Status` - `set`
11. `Get Token Usage` - `httpRequest`
12. `Format Token Report` - `set`
13. `Get Accessible Projects` - `httpRequest`
14. `Read Bitrix Project Status` - `httpRequest`
15. `Format Bitrix Report` - `set`
16. `AI Get Actor` - `httpRequest`
17. `AI List Users` - `httpRequest`
18. `AI List Projects` - `httpRequest`
19. `AI Device Context` - `httpRequest`
20. `AI Google Snapshot` - `httpRequest`
21. `AI Bitrix Project Status` - `httpRequest`
22. `Claude Assistant` - `httpRequest`
23. `Extract Claude Answer` - `set`
24. `Send Telegram Reply` - `httpRequest`

Visible command branches:

- `/help` and `/start`
- `/agents`
- `/google_connect`
- `/google_status`
- `/tokens`
- `/bitrix`
- fallback natural-language AI assistant branch

### Server changes

Added internal nginx route for n8n-to-control-plane calls:

- `/n8n-internal-api/`

It proxies to:

- `http://127.0.0.1:3099`

It is intended for Docker/internal use only.

Access rule:

- allowed: `172.16.0.0/12`
- allowed: `127.0.0.1`
- denied: all other IPs

Reason:

- n8n runs in Docker.
- `127.0.0.1:3099` from inside the n8n container points to the container itself, not the host.
- `host.docker.internal:3099` did not connect on this Linux server.
- `http://172.17.0.1/n8n-internal-api/...` works from inside the n8n container.

Backups created before nginx/docker changes:

- `/etc/nginx/sites-available/starlabagent.pp.ua.bak-before-n8n-internal-native-<timestamp>`
- `/opt/starlab-n8n/.env.bak-before-native-workflow-<timestamp>`
- `/opt/starlab-n8n/docker-compose.yml.bak-before-env-access-<timestamp>`

### n8n environment change

The visual native workflow uses expressions like:

- `$env.TELEGRAM_BOT_TOKEN`
- `$env.CLAUDE_API_KEY`
- `$env.CONTROL_PLANE_INTERNAL_URL`
- `$env.CLAUDE_MODEL`

These values are stored in `/opt/starlab-n8n/.env`, not in workflow JSON.

n8n initially failed with:

- `ExpressionError: access to env vars denied`

Fix:

- Added `N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"` to the n8n service environment in `/opt/starlab-n8n/docker-compose.yml`.

After restart, n8n confirmed:

- `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`
- Telegram token is present
- Claude API key is present
- `CONTROL_PLANE_INTERNAL_URL=http://172.17.0.1/n8n-internal-api`

### Docker-compose issue encountered and fixed

`docker-compose up -d n8n` hit the known docker-compose v1 / latest image error:

- `KeyError: 'ContainerConfig'`

Resolution:

- Removed only the stopped n8n container.
- Preserved named volumes.
- Re-created n8n container with `docker-compose up -d n8n`.

Data was not wiped because n8n data is stored in Docker named volumes and Postgres.

### Verification

Active workflows:

- `starlabTelegramMvp01|Starlab Agent - Telegram Visual Native`
- `starlabDeviceHeartbeatMirror01|Starlab Device Heartbeat Mirror`

DB summary:

- workflow name: `Starlab Agent - Telegram Visual Native`
- node count: `24`
- active: `true`

Test Telegram webhook executions after the visual-native workflow was activated:

- `/help`: execution `464`, status `success`
- `/agents`: execution `465`, status `success`
- `/google_status`: execution `467`, status `success`
- `/bitrix maksat`: execution `468`, status `success`
- natural language AI question: execution `469`, status `success`

Latest AI execution `469` contained native visual nodes including:

- `AI Get Actor`
- `AI List Users`
- `AI Google Snapshot`
- `AI Bitrix Project Status`
- `Claude Assistant`
- `Send Telegram Reply`

Device heartbeat workflow continued to succeed after these changes.

### Remaining review/follow-up

- In n8n UI, visually inspect the canvas and rearrange node positions if desired. The workflow is already placed in a tree-like layout, but UI-level polishing can be done manually.
- `/bitrix` branch currently reads the first accessible project by default. More precise natural-language target/project selection should be improved as a separate visual branch or by adding a backend endpoint that accepts `text` and resolves target/project.
- AI fallback branch currently gathers one Google snapshot and one Bitrix project report before Claude. It is visual and working, but deeper multi-project/multi-user fan-out should be added after the base visual architecture is accepted.
- Voice STT/TTS is still not implemented in this native visual workflow.

## 2026-06-08 - Fixed n8n native workflow actor authorization header

User observed bot response:

- API sources returned authorization errors.
- Error said the required `X-Actor-Telegram-Id` header was missing.

Root cause:

- The native n8n visual workflow sent actor identity as:
  - `x-telegram-user-id`
- The control-plane API expects:
  - `x-actor-telegram-id`
- Backend source:
  - `control-plane/src/api/http-utils.js`
  - `control-plane/src/api/router.js`
  - error text: `X-Actor-Telegram-Id header is required`

Fix:

- Updated `actorHeaders()` in:
  - `C:\Users\dasmu\agent\n8n\generate-visual-native-telegram-workflow.mjs`
- Regenerated:
  - `C:\Users\dasmu\agent\n8n\starlab-telegram-visual-native.workflow.json`
- Re-uploaded to server:
  - `/opt/starlab-n8n/workflows/starlab-telegram-visual-native.workflow.json`
  - `/opt/starlab-n8n/workflows/starlab-agent-main-active.workflow.json`
- Re-imported workflow id:
  - `starlabTelegramMvp01`
- Restarted n8n.

Header now sent by all control-plane HTTP Request nodes:

- `x-actor-telegram-id: {{ $('Extract Telegram Message').item.json.telegramUserId }}`

Verification:

- Natural-language test from Nikolay Telegram id `984834133`:
  - text: `Дай отчет по Максату за неделю по календарю и Bitrix`
  - execution: `488`
  - status: `success`
  - latest execution grep no longer showed `X-Actor-Telegram-Id header is required`
  - execution included `Claude Assistant`
- Direct Bitrix command:
  - text: `/bitrix maksat`
  - execution: `491`
  - status: `success`

Result:

- The previous authorization error should be gone for Google/Bitrix/device/user/token API calls in the native visual workflow.

## 2026-06-08 - Improved Bitrix, Google Calendar, Gmail, and added employee efficiency %

User feedback:

- Report quality became much better, especially Google Drive.
- Bitrix data was still weak.
- Google Calendar was showing mostly personal time instead of work calendars.
- Gmail needed better filtering/summary.
- User asked where the n8n "brain" is and why reports do not include employee efficiency in percent.

### Backend improvements

Changed:

- `control-plane/src/domain/bitrix-reports.js`
- `control-plane/src/api/router.js`
- `control-plane/src/integrations/google-oauth.js`

#### Bitrix

Added new backend report:

- `POST /api/v1/reports/bitrix/user-status`

Purpose:

- Report by employee, not just one project.
- Includes:
  - target user
  - personal assigned Bitrix tasks
  - every project connected to the user
  - combined deduplicated task summary
  - combined task list

This fixes the previous problem where `/bitrix maksat` or AI reports only queried the first accessible project and missed Maksat's personal assigned tasks.

Server verification for Maksat:

- Endpoint: `/api/v1/reports/bitrix/user-status`
- Actor Telegram id used for test: `8859688650` (Nikolay in current server state)
- Target user: `u-maksat`
- Result:
  - total tasks: `35`
  - open: `26`
  - completed: `9`
  - overdue: `7`
  - completed status count: `9`
  - pending status count: `25`
  - in_progress status count: `1`

#### Employee efficiency %

Added computed fields to every Bitrix task summary:

- `openNotOverdue`
- `completionPercent`
- `overduePercent`
- `efficiencyPercent`

Current formula:

- completed tasks = full weight
- open but not overdue tasks = `0.6` weight
- overdue tasks = `0` weight
- `efficiencyPercent = round(((completed + openNotOverdue * 0.6) / total) * 100)`

For Maksat at verification time:

- total: `35`
- completed: `9`
- openNotOverdue: `19`
- overdue: `7`
- completionPercent: `26`
- overduePercent: `20`
- efficiencyPercent: `58`

Reason:

- This is more useful than a raw completion rate because PM work often has many active tasks; non-overdue active tasks should not be treated as total failure.
- The formula is intentionally simple and visible so it can be adjusted later.

#### Google Calendar

`GET /api/v1/google/workspace-snapshot` now accepts richer limits/search query params:

- `calendarEvents`
- `calendarList`
- `sharedCalendarMatches`
- `sharedCalendarEvents`
- `gmailMessages`
- `driveFiles`
- `documentFiles`
- `docCharLimit`
- `sheetRows`
- `sheetColumns`
- repeated `calendarSearchTerm`

n8n now sends search terms for the target employee, for example:

- `Maksat`
- `Максат`
- `Максат Работа`
- `Maksat work`
- `рабочий график`
- `работа`
- `work`
- `PM`

Server verification for Maksat:

- primary calendar events: `26`
- calendar list count: `17`
- matched shared calendars: `2`
- matched calendar names:
  - `Максат Работа`
  - `Битрикс24 Максат Султаналиев`

This directly addresses the issue where the report saw personal/sleep blocks but missed actual work calendars.

#### Gmail

Improved Gmail query:

- excludes:
  - `category:promotions`
  - `category:social`
  - `category:forums`
  - `from:noreply`
  - `from:no-reply`

Added `workLikeMessages` in Gmail snapshot.

Work-like messages are detected by signals such as:

- Bitrix
- Jira
- n8n
- Google Calendar/Meet/Docs/Sheets/Drive
- task/project/report/Starlab
- Russian task/report/project/meeting/document/table words

Personal noise such as Ozon, Wallet, FACEIT, Steam, promotions/sales is excluded.

Server verification for Maksat:

- Gmail result estimate: `201`
- messages fetched: `25`
- workLikeMessages: `2`

### n8n workflow improvements

Changed:

- `n8n/generate-visual-native-telegram-workflow.mjs`
- regenerated `n8n/starlab-telegram-visual-native.workflow.json`
- deployed to `/opt/starlab-n8n/workflows/starlab-telegram-visual-native.workflow.json`

Active workflow remains:

- `starlabTelegramMvp01|Starlab Agent - Telegram Visual Native`

Node count:

- `25`

New visible "brain" node:

- `Starlab Brain - Build AI Context`

This is now the explicit center of the AI assistant in n8n.

The AI branch now flows:

1. `AI Get Actor`
2. `AI List Users`
3. `AI List Projects`
4. `AI Device Context`
5. `AI Google Snapshot`
6. `AI Bitrix User Status`
7. `Starlab Brain - Build AI Context`
8. `Claude Assistant`
9. `Extract Claude Answer`
10. `Send Telegram Reply`

The brain node builds a single context object with:

- question
- actor
- accessible users
- projects
- devices
- Google snapshot
- Bitrix user status
- report instructions

The Claude system prompt now explicitly says:

- always show employee efficiency in percent when `efficiencyPercent` exists
- use Bitrix `combined`, `userTasks`, and project summaries first
- prefer Google shared calendars / "Другие календари" over primary calendar for work schedule questions
- use Gmail `workLikeMessages` and separate personal email from work email

### Deployment

Backend deployed to server:

- `root@195.238.122.228`
- service: `company-control-plane-api.service`

Backups:

- `/opt/company-control-plane/backups/codex-data-quality-20260608140145`
- `/opt/company-control-plane/backups/codex-efficiency-20260608141150`

n8n workflow re-imported and n8n restarted.

### Verification

Local tests:

- `npm test -- --runInBand`
- result: `57/57` tests passed

Server direct API checks:

- Bitrix user-status for Maksat returned `efficiencyPercent: 58`
- Google workspace snapshot matched `Максат Работа` and `Битрикс24 Максат Султаналиев`
- Gmail returned `workLikeMessages`

Telegram/n8n checks:

- `/bitrix maksat`
  - execution `546`
  - status `success`
- natural-language AI report:
  - text included request to show efficiency %
  - execution `547`
  - status `success`
  - execution data contained:
    - `AI Bitrix User Status`
    - `AI Google Snapshot`
    - `Starlab Brain - Build AI Context`
    - `efficiencyPercent`
    - `completionPercent`
    - `overduePercent`

### Important note

Current server state has Nikolay registered as Telegram id:

- `8859688650`

The earlier id `984834133` is used for token report recipient config, but it is not the current Nikolay Telegram account in `control-plane.json`. Direct API tests must use `8859688650` unless the state is intentionally changed.

## 2026-06-08: voice input/output and Metricon replacement direction

### User request

User clarified two important product changes:

1. Metricon should not be treated as the final tracker anymore. The team wants a different Kickidler-like activity tracker, but the exact product is not chosen yet.
2. Telegram bot must be able to:
   - receive voice messages,
   - transcribe voice to text,
   - process the transcribed request like a normal AI request,
   - send a voice/audio answer when the user explicitly asks for it.

### What was changed

#### Metricon direction

No new hard dependency on Metricon should be added from this point forward.

Recommended architecture for the next implementation step:

- introduce a generic `activityTracker` / `timeTracker` connector boundary;
- keep current Metricon-related code as a legacy connector only;
- make reports read from a normalized activity model:
  - employee id,
  - active time,
  - idle time,
  - app/site usage,
  - screenshots if the future tracker supports them,
  - day/week/month aggregation;
- once the final tracker is chosen, add it as another provider behind the same boundary.

This avoids rewriting Telegram/n8n/report logic again when Metricon is replaced.

#### Voice backend

Backend already has these endpoints:

- `GET /api/v1/voice/status`
- `POST /api/v1/voice/transcribe-telegram`
- `POST /api/v1/voice/send-telegram`

`/api/v1/voice/send-telegram` has a safe fallback: if ElevenLabs TTS is not configured, the bot sends a text message instead of silently failing.

#### n8n workflow

Updated visual-native n8n workflow:

- local generator: `C:\Users\dasmu\agent\n8n\generate-visual-native-telegram-workflow.mjs`
- local workflow JSON: `C:\Users\dasmu\agent\n8n\starlab-telegram-visual-native.workflow.json`
- server workflow path: `/opt/starlab-n8n/workflows/starlab-telegram-visual-native.workflow.json`
- active workflow id: `starlabTelegramMvp01`
- active workflow name: `Starlab Agent - Telegram Visual Native`

Voice flow now contains these nodes:

1. `Route Input Type`
2. `Transcribe Telegram Voice`
3. `Apply Voice Transcript`
4. `Route Reply Type`
5. `Send Telegram Voice Reply`

Important fix:

- Previous version failed to detect text like `ответь голосом`.
- Replaced regex-only voice detection with robust `toLowerCase().includes(...)` checks for:
  - `голос`
  - `войс`
  - `аудио`
  - `voice`
  - `audio`

This logic is now present both at message extraction and at reply routing.

### Deployment

Deployed updated n8n workflow to server:

- server: `195.238.122.228`
- n8n directory: `/opt/starlab-n8n`

Commands completed successfully:

- workflow JSON uploaded to `/tmp/starlab-telegram-visual-native.workflow.json`
- copied to `/opt/starlab-n8n/workflows/starlab-telegram-visual-native.workflow.json`
- copied to `/opt/starlab-n8n/workflows/starlab-agent-main-active.workflow.json`
- imported via `n8n import:workflow`
- activated via `n8n update:workflow --id=starlabTelegramMvp01 --active=true`
- n8n container restarted
- healthcheck returned `{"status":"ok"}`

### Verification

Server workflow inspection confirmed:

- webhook path: `starlab-telegram`
- `Extract Telegram Message` has updated `voiceReplyRequested` expression
- `Route Reply Type` has updated voice routing expression

Control-plane service is active and listens on:

- `127.0.0.1:3099`

Voice status check with Nikolay actor `8859688650` returned:

```json
{
  "ok": true,
  "data": {
    "enabled": true,
    "canTranscribe": false,
    "canSynthesize": false,
    "replyMode": "on_request"
  }
}
```

### Remaining setup needed

Voice pipeline is structurally ready, but real voice processing still needs credentials in setup:

- STT provider/key:
  - either ElevenLabs STT,
  - or OpenAI/another STT provider if selected later;
- ElevenLabs API key for TTS;
- ElevenLabs voice id for the voice answer.

Until these keys are added:

- text requests continue to work;
- text requests with `ответь голосом` route to the voice-send backend;
- backend sends a text fallback explaining that ElevenLabs TTS is not configured;
- real Telegram audio replies will start only after TTS credentials are configured.

## 2026-06-09: local OpenClaw employee agent download, activation, and chat MVP

### User request

User asked to add a website section such as:

- `https://starlabagent.pp.ua/download`

Purpose:

- employees download/install a local OpenClaw-style agent for Windows, macOS, and Linux Debian;
- first launch asks for a registration code issued by Nikolay;
- the code identifies the employee and role, for example Maksat as `SENIOR_PM`;
- local agent connects to the central server and should share the same hierarchy/memory/work context as Telegram bot.

### Implemented backend

Added public download page:

- `GET /download`

Added protected file serving:

- `GET /downloads/<file>`
- `HEAD /downloads/<file>`

Files are served only from:

- `/opt/company-control-plane/public/downloads`

Path traversal is blocked by resolving the final absolute path under `public/downloads`.

Added local device activation endpoint:

- `POST /api/v1/device-agents/activate`

Request fields:

- `registrationCode`
- `deviceId`
- `displayName`
- `hostname`
- `platform`
- `arch`
- `osRelease`
- `agentVersion`
- `capabilities`

Behavior:

- validates invite/registration code;
- allows local device activation even if Telegram was already linked with the same code, as long as the invite is valid and not revoked/expired;
- creates/updates `deviceAgents[]`;
- generates a per-device secret token;
- stores only `tokenHash` in state, never the raw token;
- returns raw `deviceToken` only once to the local agent.

Added per-device heartbeat auth:

- `/api/v1/device-agents/heartbeat` still supports the global ingest token;
- it also now accepts a valid per-device `X-Device-Agent-Token` that matches `deviceId`.

Added local chat endpoint:

- `POST /api/v1/local-agent/chat`

Behavior:

- authenticates by `deviceId` + `X-Device-Agent-Token`;
- maps the local device to the correct user;
- calls existing `answerCompanyAssistant(...)` with `actorUserId`;
- uses the same backend context as Telegram assistant:
  - hierarchy,
  - Bitrix,
  - Google,
  - devices,
  - token usage logging,
  - Claude client.

### Implemented local agent

Changed:

- `control-plane/src/device-agent.js`

New behavior:

- if `DEVICE_AGENT_USER_ID` exists, it works as before and sends heartbeat;
- if not configured, or started with `--app`, it opens a local app at:
  - `http://127.0.0.1:4157`
- first screen asks for registration code;
- after activation it writes `device-agent.env`;
- then it starts heartbeat;
- local app includes a text chat box that sends requests to `/api/v1/local-agent/chat`.

Default local config paths:

- Windows: `%LOCALAPPDATA%\StarlabOpenClawAgent\device-agent.env`
- macOS: `~/Library/Application Support/StarlabOpenClawAgent/device-agent.env`
- Linux: `~/.config/starlab-openclaw-agent/device-agent.env`

### Installers/downloads

Added Windows installer script:

- `control-plane/scripts/install-local-openclaw-windows.ps1`

Behavior:

- installs local employee agent, not the central server;
- creates a scheduled task:
  - `StarlabOpenClawLocalAgent`
- creates a desktop shortcut:
  - `Starlab OpenClaw Agent.lnk`
- opens local activation app;
- downloads portable Node.js if Node is missing.

Added Windows `.exe` builder:

- `control-plane/scripts/build-local-openclaw-windows-installer.ps1`

Built local Windows installer:

- `control-plane/public/downloads/starlab-openclaw-agent-windows.exe`
- deployed to:
  - `/opt/company-control-plane/public/downloads/starlab-openclaw-agent-windows.exe`

Added macOS install script:

- `control-plane/scripts/macos/install-local-openclaw-agent.sh`
- downloadable as:
  - `/downloads/starlab-openclaw-agent-macos.sh`

Added Linux Debian/Ubuntu install script:

- `control-plane/scripts/linux/install-local-openclaw-agent.sh`
- downloadable as:
  - `/downloads/starlab-openclaw-agent-linux.sh`

Important limitation:

- Real signed `.pkg/.dmg` and `.deb` packages were not built in this pass.
- Windows `.exe` exists now.
- macOS/Linux currently have downloadable install scripts.
- Proper `.pkg/.dmg/.deb` should be built on macOS/Linux builders in the next packaging pass.

### Files changed

- `control-plane/src/api/router.js`
- `control-plane/src/domain/device-agents.js`
- `control-plane/src/setup/download-page.js`
- `control-plane/src/device-agent.js`
- `control-plane/src/assistant/company-assistant.js`
- `control-plane/src/server.js`
- `control-plane/scripts/install-local-openclaw-windows.ps1`
- `control-plane/scripts/build-local-openclaw-windows-installer.ps1`
- `control-plane/scripts/macos/install-local-openclaw-agent.sh`
- `control-plane/scripts/linux/install-local-openclaw-agent.sh`
- `control-plane/public/downloads/starlab-openclaw-agent-windows.exe`
- `control-plane/public/downloads/starlab-openclaw-agent-macos.sh`
- `control-plane/public/downloads/starlab-openclaw-agent-linux.sh`
- `control-plane/test/device-agents.test.js`

### Tests

Local:

- `npm test -- --runInBand`
- result: `58/58` passed

Server:

- deployed to `/opt/company-control-plane`
- `npm test -- --runInBand`
- result: `38/38` passed on server checkout
- `company-control-plane-api.service` restarted and active

### nginx changes

Added public proxy locations in `/etc/nginx/sites-available/starlabagent.pp.ua`:

- `/download`
- `/downloads/`
- `/api/v1/device-agents/activate`
- `/api/v1/local-agent/chat`

Backups:

- `/etc/nginx/sites-available/starlabagent.pp.ua.bak-before-download-local-agent-20260609070809`
- `/etc/nginx/sites-available/starlabagent.pp.ua.bak-before-download-https-local-agent-20260609070923`

### Production verification

External HTTPS checks from operator machine:

- `https://starlabagent.pp.ua/download`
  - HTTP `200`
  - page contains `Starlab OpenClaw Agent`
- `https://starlabagent.pp.ua/downloads/starlab-openclaw-agent-windows.exe`
  - HTTP `200`
  - size `192512`
- `https://starlabagent.pp.ua/downloads/starlab-openclaw-agent-macos.sh`
  - HTTP `200`
  - size `2150`

### Remaining work

- Build real macOS `.pkg`/`.dmg` on a Mac builder.
- Build real Debian `.deb` on a Linux builder.
- Improve local UI visual design and add persistent conversation history.
- Optionally route local chat through n8n visual workflow too. Current implementation uses the same tested control-plane assistant backend, while Telegram remains n8n-orchestrated.
- Add a Telegram command for Nikolay that clearly creates a registration code for both Telegram and local device activation.

## 2026-06-09: replaced silent Windows script installer with real desktop app, added macOS build workflow

### User issue

User downloaded the Windows file and double-clicked it, but nothing visible happened.

Root cause:

- Previous file was an IExpress self-extracting PowerShell installer.
- It was not a real desktop app window.
- It could silently fail or run hidden, which is not acceptable for employee onboarding.

### Implemented real desktop app

Added Electron desktop app:

- `control-plane/desktop-agent/package.json`
- `control-plane/desktop-agent/package-lock.json`
- `control-plane/desktop-agent/src/main.cjs`
- `control-plane/desktop-agent/src/preload.cjs`
- `control-plane/desktop-agent/src/renderer.html`
- `control-plane/desktop-agent/src/renderer.js`
- `control-plane/desktop-agent/src/styles.css`
- `control-plane/desktop-agent/README.md`

App behavior:

- opens a real native desktop window;
- shows activation form for `registration code`;
- calls `/api/v1/device-agents/activate`;
- stores device config in Electron `userData`;
- sends heartbeat to `/api/v1/device-agents/heartbeat`;
- has a local chat UI;
- local chat calls `/api/v1/local-agent/chat`;
- uses the same server-side assistant context as Telegram.

### Windows build

Built real Electron portable Windows `.exe`:

- local output:
  - `control-plane/desktop-agent/dist/starlab-openclaw-agent-windows.exe`
- deployed download:
  - `control-plane/public/downloads/starlab-openclaw-agent-windows.exe`
  - `/opt/company-control-plane/public/downloads/starlab-openclaw-agent-windows.exe`

New file size:

- `74314579` bytes

This replaced the old small `192512` byte IExpress file.

Local launch verification:

- double-started the new `.exe`;
- process appeared;
- main window title appeared:
  - `Starlab OpenClaw Agent`

Production verification:

- `https://starlabagent.pp.ua/download`
  - HTTP `200`
  - contains proper Russian text: `Локальное desktop-приложение`
- `https://starlabagent.pp.ua/downloads/starlab-openclaw-agent-windows.exe`
  - HTTP `200`
  - content length `74314579`

### macOS requirement

User said macOS is mandatory.

Important constraint:

- A proper macOS `.dmg/.app` must be built on macOS.
- Windows cannot honestly produce/sign/notarize a production macOS app.

Implemented macOS build target in Electron app:

- `npm run build:mac`

Expected outputs on macOS builder:

- `dist/starlab-openclaw-agent-macos-x64.dmg`
- `dist/starlab-openclaw-agent-macos-arm64.dmg`

Added GitHub Actions workflow:

- `.github/workflows/build-desktop-agents.yml`

It builds:

- Windows `.exe` on `windows-latest`
- macOS `.dmg` on `macos-latest`
- Linux `.deb` on `ubuntu-latest`

After workflow completion, upload/download artifacts to server path:

- `/opt/company-control-plane/public/downloads/starlab-openclaw-agent-macos-x64.dmg`
- `/opt/company-control-plane/public/downloads/starlab-openclaw-agent-macos-arm64.dmg`

### Page fix

Fixed broken/mojibake Russian on:

- `control-plane/src/setup/download-page.js`

The page now describes:

- Windows desktop `.exe`
- macOS desktop `.dmg`
- Linux `.deb`/script status

### Server deployment

Deployed:

- fixed `/download` page;
- real Windows desktop app `.exe`.

Backup:

- `/opt/company-control-plane/backups/codex-real-desktop-app-20260609114617`

Restarted:

- `company-control-plane-api.service`

Status:

- active

## 2026-06-09 - corrected direction: build local desktop agent from OpenClaw sources

User clarified that the previous standalone `control-plane/desktop-agent` approach was the wrong direction.
The required direction is:

- customize/build from `openclaw/openclaw` sources;
- Windows must be a real `.exe` desktop installer;
- macOS must use the real OpenClaw macOS app path where possible;
- app must know which employee/device it runs on through Nikolay-issued registration code;
- app must talk to the central server and share the same server-side assistant/memory as Telegram.

### What changed in OpenClaw

OpenClaw repo path:

- `C:\Users\dasmu\agent\openclaw`

macOS OpenClaw Swift app:

- added `apps/macos/Sources/OpenClaw/StarlabAgentClient.swift`
  - talks to `https://starlabagent.pp.ua`;
  - activation: `POST /api/v1/device-agents/activate`;
  - heartbeat: `POST /api/v1/device-agents/heartbeat`;
  - local chat: `POST /api/v1/local-agent/chat`;
  - stores user/device/server config in app defaults;
  - starts heartbeat every 60 seconds after activation.
- added `apps/macos/Sources/OpenClaw/StarlabAgentWindow.swift`
  - registration-code screen;
  - connected employee/device summary;
  - local assistant chat;
  - reset activation button.
- patched `apps/macos/Sources/OpenClaw/MenuBar.swift`
  - first launch now opens Starlab registration if the device is not activated;
  - activated devices start heartbeat immediately;
  - Dock menu includes `Open Starlab Agent`.
- patched `apps/macos/Sources/OpenClaw/MenuContentView.swift`
  - menu bar menu includes `Starlab Agent`.
- patched `apps/macos/Sources/OpenClaw/AppNavigationActions.swift`
  - added `openStarlabAgent()`.

Windows OpenClaw desktop target:

- added `apps/windows/`
  - `package.json`;
  - `package-lock.json`;
  - `src/main.cjs`;
  - `src/preload.cjs`;
  - `src/renderer.html`;
  - `src/renderer.js`;
  - `src/styles.css`;
  - `README.md`.
- This is now inside the OpenClaw source tree, not `control-plane/desktop-agent`.
- It builds a Windows NSIS installer:
  - `apps/windows/dist/starlab-openclaw-agent-windows.exe`
- Windows app behavior:
  - employee enters registration code;
  - app activates device through central server;
  - stores device token using Electron `safeStorage` when available;
  - sends heartbeat every 60 seconds;
  - sends chat questions to central assistant endpoint.

OpenClaw build helpers:

- patched root `openclaw/package.json` with:
  - `starlab:windows:install`
  - `starlab:windows:build`
  - `starlab:mac:package`
  - `starlab:linux:build`
- added `scripts/package-starlab-mac-dist.sh`
  - wraps existing OpenClaw macOS Swift packaging;
  - uses bundle id `com.starlab.openclaw.agent`;
  - outputs `dist/starlab-openclaw-agent-macos-universal.dmg` on macOS builder.
- added `.github/workflows/starlab-desktop-build.yml`
  - Windows installer on `windows-latest`;
  - macOS DMG on `macos-latest`;
  - Linux `.deb` on `ubuntu-latest`.

### What changed in control-plane

- Replaced `control-plane/public/downloads/starlab-openclaw-agent-windows.exe`
  with the new OpenClaw-source Windows installer.
- Rewrote `control-plane/src/setup/download-page.js`
  - fixed mojibake Russian text;
  - points Windows to `.exe`;
  - points macOS to `starlab-openclaw-agent-macos-universal.dmg`;
  - points Linux to `.deb`.

### Build / verification

Ran:

- `npm install` in `openclaw/apps/windows`
- `npm run build:win` in `openclaw/apps/windows`
- `node --check apps/windows/src/main.cjs`
- `node --check apps/windows/src/preload.cjs`
- `node --check apps/windows/src/renderer.js`
- `node --check control-plane/src/setup/download-page.js`
- `node --test control-plane/test/device-agents.test.js`

Results:

- Windows installer built successfully.
- Artifact:
  - `openclaw/apps/windows/dist/starlab-openclaw-agent-windows.exe`
  - size: `81686916`
- Device-agent tests:
  - 3 passed, 0 failed.
- Download page JS syntax check passed.
- Windows JS syntax checks passed.

Not yet verified locally:

- macOS Swift compile, because current machine is Windows.
- macOS `.dmg`, because it must be built on macOS/Xcode or a macOS GitHub runner.

### Production server deployment

Deployed to VPS:

- `/opt/company-control-plane/public/downloads/starlab-openclaw-agent-windows.exe`
- `/opt/company-control-plane/src/setup/download-page.js`

Restarted:

- `company-control-plane-api.service`

Production verification:

- `https://starlabagent.pp.ua/download`
  - HTTP `200`
  - contains readable Russian text: `Скачать локального агента`
  - contains `starlab-openclaw-agent-windows.exe`
- `https://starlabagent.pp.ua/downloads/starlab-openclaw-agent-windows.exe`
  - HTTP `200`
  - content length: `81686916`
  - content type: `application/vnd.microsoft.portable-executable`

### Important review notes for Claude

Please review:

1. Swift compile correctness in:
   - `apps/macos/Sources/OpenClaw/StarlabAgentClient.swift`
   - `apps/macos/Sources/OpenClaw/StarlabAgentWindow.swift`
   - `apps/macos/Sources/OpenClaw/MenuBar.swift`
   - `apps/macos/Sources/OpenClaw/MenuContentView.swift`
   - `apps/macos/Sources/OpenClaw/AppNavigationActions.swift`
2. Whether macOS token storage should move from `UserDefaults` to Keychain before production.
3. Whether the Windows installer should stay `requestedExecutionLevel=requireAdministrator`.
4. Whether Electron Builder transitive vulnerabilities from `npm audit` require pin/upgrade before pilot.
5. Whether the legacy `control-plane/desktop-agent` should be deleted or kept as obsolete reference.
6. Whether `openclaw/apps/windows` should be added to `pnpm-workspace.yaml` or intentionally stay isolated with npm.

## 2026-06-09 - Codex: macOS OpenClaw build on Maksat Mac

Context:

- User asked to continue the real OpenClaw desktop-app path, not the earlier wrapper approach.
- Connected to Maksat Mac over SSH: `asik@192.168.1.221`.
- Mac has Apple Silicon / arm64 and only Command Line Tools, not full Xcode.

### Source changes made after the interrupted run

Updated OpenClaw macOS source:

- `openclaw/apps/macos/Sources/OpenClaw/SessionMenuLabelView.swift`
  - replaced SwiftUI `@Entry` macro with explicit `EnvironmentKey`;
  - reason: Command Line Tools build cannot load `SwiftUIMacros.EntryMacro`.
- `openclaw/apps/macos/Sources/OpenClaw/StarlabAgentClient.swift`
  - fixed heartbeat store logic: `updated.agent` is non-optional, so assign directly.
- `openclaw/scripts/package-starlab-mac-dist.sh`
  - defaulted Starlab packaging to `SKIP_DMG=1` for the upstream styled DMG step;
  - added a simple `hdiutil create -srcfolder` DMG fallback/output;
  - reason: upstream `create-dmg.sh` uses Finder/AppleScript and times out under SSH/headless builds.

Temporary build helper files:

- `agent/.codex-temp/patch-textual-mac.py`
  - patches SwiftPM checkout `textual` only on the Mac build machine;
  - strips `#Preview` blocks and orphaned `@available` attributes;
  - rewrites `@Entry` environment values to explicit keys.
- `agent/.codex-temp/patch-swiftui-math-mac.sh`
  - patches SwiftPM checkout `swiftui-math` only on the Mac build machine;
  - strips previews and rewrites `@Entry` usage for CLT-only compile.
- `agent/.codex-temp/create-simple-mac-dmg.sh`
  - creates the final simple DMG from the built `OpenClaw.app`.

These dependency patches are intentionally temporary and should not be treated as upstream source changes.
The cleaner production path is full Xcode or GitHub Actions macOS runner.

### Mac build result

On Maksat Mac:

- Installed Node locally under `~/.local/node-v24.16.0-darwin-arm64`.
- Enabled Corepack/pnpm.
- Ran `pnpm install --frozen-lockfile --config.node-linker=hoisted`.
- Ran Starlab macOS package build.

Build status:

- `OpenClaw` product compiled successfully.
- `openclaw-mlx-tts` helper compiled successfully.
- `OpenClaw.app` created successfully.
- Zip created successfully.
- Upstream styled DMG failed due Finder AppleEvent timeout `-1712`.
- Created simple final DMG manually with `hdiutil`.

Artifacts on Maksat Mac:

- `/Users/asik/agent/openclaw/dist/OpenClaw.app`
- `/Users/asik/agent/openclaw/dist/OpenClaw-2026.6.2.zip`
- `/Users/asik/agent/openclaw/dist/OpenClaw-2026.6.2.dmg`
- `/Users/asik/agent/openclaw/dist/starlab-openclaw-agent-macos-universal.dmg`

Final DMG:

- size: `34815627` bytes
- local copy: `control-plane/public/downloads/starlab-openclaw-agent-macos-universal.dmg`
- SHA256: `FEF9AF8FECB4E0E57F20BBB5C5FACB61641B244C558742171D5467F9E7EE788C`

### Maksat Mac installation

Installed built app to:

- `/Applications/OpenClaw.app`

Launched:

- `/Applications/OpenClaw.app/Contents/MacOS/OpenClaw`

Stopped old wrong wrapper process:

- old `StarlabOpenClawAgent.app` AppTranslocation process was killed;
- current real app process remained running.

Important:

- Build used ad-hoc codesigning because no Apple Developer certificate exists on this Mac.
- Ad-hoc signed macOS apps may require Accessibility/Screen Recording permissions again after rebuild/relaunch.
- For production pilot, sign with real Apple Developer ID and notarize.

### Server deployment

Uploaded final macOS DMG to:

- `/opt/company-control-plane/public/downloads/starlab-openclaw-agent-macos-universal.dmg`

Verified externally:

- `https://starlabagent.pp.ua/download`
  - HTTP `200`
- `https://starlabagent.pp.ua/downloads/starlab-openclaw-agent-macos-universal.dmg`
  - HTTP `200`
  - content type: `application/x-apple-diskimage`
  - content length: `34815627`

### Claude review checklist

Please review:

1. `StarlabAgentClient.swift` API contract and token/config storage.
2. `SessionMenuLabelView.swift` explicit `EnvironmentKey` replacement.
3. `package-starlab-mac-dist.sh` simple DMG fallback logic.
4. Whether production macOS builds should move to full Xcode/GitHub Actions instead of CLT dependency patching.
5. Whether old wrapper artifacts should be removed from repo/device once the real OpenClaw app is confirmed by the user.

## 2026-06-10 - Codex: local OpenClaw desktop-control queue for n8n/Telegram

User request:

- Build the Starlab version of the local OpenClaw agent as the "hands" of the Telegram/n8n assistant.
- Keep the original OpenClaw UI/design, but make the local app understand the employee registration code, connect to the Starlab server, know which employee/device it is, and execute desktop actions requested through Telegram/n8n.
- Do this for Windows and macOS, with an expanded command set.
- Publish installable builds through `https://starlabagent.pp.ua/download`.
- Do not push to GitHub. Log work here for Claude review.

Important safety note:

- `kickidler/` was not touched.
- Existing `/setup` secrets and `/var/lib/company-control-plane/control-plane.json` were not overwritten.
- No git push was performed.

### Server/control-plane changes

Implemented a first production-style device command queue:

- `control-plane/src/domain/device-agents.js`
  - Added `DEVICE_ACTION_TYPES`.
  - Added `createDeviceCommand`.
  - Added `claimDeviceCommands`.
  - Added `completeDeviceCommand`.
  - Added `listVisibleDeviceCommands`.
  - Added queue expiry, claim timeout and command pruning.
  - Added target alias resolution:
    - exact `deviceId`;
    - device display name/hostname/labels;
    - user id;
    - employeeId;
    - displayName;
    - simplified aliases like `maksat`, `pm1`.
  - All command creation still goes through hierarchy visibility:
    - Owner can target everyone;
    - Senior PM can target self and subordinate PMs;
    - PM can target only self.

- `control-plane/src/api/router.js`
  - Added `GET /api/v1/device-actions`.
  - Added `POST /api/v1/device-commands`.
  - Added `GET /api/v1/device-commands`.
  - Added `GET /api/v1/device-agents/commands?deviceId=...`.
  - Added `POST /api/v1/device-agents/commands/:id/result`.
  - Local agents authenticate command polling/result upload through their existing device token.

- `control-plane/src/infra/seed.js`
  - Added initial `deviceCommands: []`.

- `control-plane/test/device-agents.test.js`
  - Added command lifecycle coverage:
    - owner queues command for subordinate PM device via alias;
    - PM cannot command Maksat device;
    - device claims command;
    - device completes command.

### Telegram changes

- `control-plane/src/telegram/handler.js`
  - Added `/device`.
  - Examples:
    - `/device maksat open_app Chrome`
    - `/device u-pm-1 screenshot`
    - `/device pm-1 active_window`
    - `/device maksat open_url https://starlabagent.pp.ua`
    - `/device maksat hotkey ctrl+r`
    - `/device maksat keyboard_type текст для ввода`
  - Added parser for:
    - `open_app`
    - `close_app`
    - `open_url`
    - `open_file`
    - `list_running_apps`
    - `active_window`
    - `screenshot`
    - `clipboard_get`
    - `clipboard_set`
    - `keyboard_type`
    - `hotkey`
    - `mouse_click`
  - `/device help` returns usage and examples.

- `control-plane/src/telegram/bot-commands.js`
  - Rewritten as clean UTF-8 command menu.
  - Added `/device`.

### n8n visual workflow changes

- Updated `n8n/starlab-telegram-visual-native.workflow.json`.
- Added five separate visual nodes, not one giant Code node:
  - `Parse Device Command`
  - `Route Device Command`
  - `Prepare Device Help`
  - `Create Device Command`
  - `Format Device Command Result`
- Updated `Route Request` with `/device` branch.
- The n8n `/device` branch calls:
  - `POST /api/v1/device-commands`
  - header: `x-actor-telegram-id`
  - body: `{ target, type, args, source: "n8n-telegram", ttlSeconds: 300 }`
- The active n8n workflow on VPS was updated directly in Postgres:
  - workflow id: `starlabTelegramMvp01`
  - node count after update: `35`
  - workflow remained `active=true`
  - `versionCounter` became `15`
- n8n container was restarted and logs showed:
  - `Activated workflow "Starlab Agent - Telegram Visual Native"`
  - `Activated workflow "Starlab Device Heartbeat Mirror"`

### Windows OpenClaw local agent

- `openclaw/apps/windows/src/main.cjs`
  - Added command polling every 5 seconds.
  - Local app now calls:
    - `GET /api/v1/device-agents/commands?deviceId=...&limit=5`
    - `POST /api/v1/device-agents/commands/:id/result`
  - Added capabilities sent in activation/heartbeat.
  - Implemented actions:
    - `open_app`
    - `close_app`
    - `open_url`
    - `open_file`
    - `list_running_apps`
    - `active_window`
    - `screenshot`
    - `clipboard_get`
    - `clipboard_set`
    - `keyboard_type`
    - `hotkey`
    - `mouse_click`
  - `ocr_screen` and `openclaw_prompt` return explicit `unsupported` for now.

Windows build:

- Ran `npm run build:win` in `openclaw/apps/windows`.
- Build succeeded.
- New installer:
  - `openclaw/apps/windows/dist/starlab-openclaw-agent-windows.exe`
  - copied to `control-plane/public/downloads/starlab-openclaw-agent-windows.exe`
  - size: `81689936` bytes.

### macOS OpenClaw local agent source changes

- `openclaw/apps/macos/Sources/OpenClaw/StarlabAgentClient.swift`
  - Added command polling.
  - Added command DTOs and JSON value support.
  - Added command result upload.
  - Added last command status fields in config.
  - Activation/heartbeat now include expanded capabilities.

- `openclaw/apps/macos/Sources/OpenClaw/StarlabDeviceCommandExecutor.swift`
  - New file.
  - Implements macOS desktop-control actions via:
    - `NSWorkspace`
    - `screencapture`
    - `NSPasteboard`
    - `CGEvent`
    - AppleScript for app quit.
  - Implemented actions:
    - `open_app`
    - `close_app`
    - `open_url`
    - `open_file`
    - `list_running_apps`
    - `active_window`
    - `screenshot`
    - `clipboard_get`
    - `clipboard_set`
    - `keyboard_type`
    - `hotkey`
    - `mouse_click`
  - `ocr_screen` and `openclaw_prompt` return explicit `unsupported` for now.

- `openclaw/apps/macos/Sources/OpenClaw/MenuBar.swift`
  - Starts command polling on app launch when already activated.

macOS build status:

- Not rebuilt in this pass because SSH to Maksat Mac `192.168.1.221` timed out.
- Existing old DMG on download page was not replaced.
- Need rebuild once user and Maksat Mac are on same network again.

### VPS deployment

Deployed to VPS `195.238.122.228`:

- Updated files under `/opt/company-control-plane`:
  - `src/domain/device-agents.js`
  - `src/api/router.js`
  - `src/infra/seed.js`
  - `src/telegram/handler.js`
  - `src/telegram/bot-commands.js`
  - `test/device-agents.test.js`
  - `public/downloads/starlab-openclaw-agent-windows.exe`
- Backup before deploy:
  - `/opt/company-control-plane/backups/codex-device-commands-20260610-100002`
- Ran on VPS:
  - `node --check src/api/router.js`
  - `node --check src/domain/device-agents.js`
  - `node --check src/telegram/handler.js`
  - `node --check src/telegram/bot-commands.js`
  - `node --test test/device-agents.test.js`
- Restarted:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Verified:
  - services are `active`
  - internal API health OK on `http://127.0.0.1:3099/health`
  - external `https://starlabagent.pp.ua/download` returns `200`
  - external `https://starlabagent.pp.ua/downloads/starlab-openclaw-agent-windows.exe` returns `200`
  - Windows installer external content length: `81689936`
  - Telegram command menu synchronized with `18 commands`

### Local verification

Ran locally:

- `node --test control-plane/test/device-agents.test.js`
- `node --check control-plane/src/api/router.js`
- `node --check control-plane/src/domain/device-agents.js`
- `node --check control-plane/src/telegram/handler.js`
- `node --check control-plane/src/telegram/bot-commands.js`
- `node --check openclaw/apps/windows/src/main.cjs`
- `npm run build:win` in `openclaw/apps/windows`

All above passed.

### Git/tracking note

The top-level repository ignores `openclaw/` by design:

- `.gitignore` contains `openclaw/`.

To prevent Starlab OpenClaw source changes from being lost when the user pushes the main `agent` repo, a patch artifact was generated:

- `OPENCLAW_STARLAB_DEVICE_CONTROL.patch`

It includes the selected Starlab local-agent changes for:

- Windows Electron app files under `apps/windows/`
- macOS Starlab client/executor files
- macOS `MenuBar.swift` polling startup change
- `scripts/package-starlab-mac-dist.sh`
- `.github/workflows/starlab-desktop-build.yml`

Claude should review whether the project should:

1. keep `openclaw/` ignored and apply this patch to a separate OpenClaw checkout, or
2. add OpenClaw as a git submodule/fork, or
3. track only Starlab patch files in the main repo.

### Claude review checklist

Please review:

1. Security model for remote desktop-control commands:
   - hierarchy checks;
   - command TTL;
   - device-token polling;
   - audit events.
2. Windows executor safety:
   - `close_app` uses `taskkill`;
   - `keyboard_type` uses clipboard paste;
   - screenshot result can be large and currently stored in state result.
3. macOS executor compile/runtime details after Mac is reachable.
4. n8n visual workflow branch:
   - `Parse Device Command`;
   - `Route Device Command`;
   - `Create Device Command`.
5. Whether to add user confirmation/approval for dangerous actions such as `close_app`, `keyboard_type`, `mouse_click`, and `screenshot`.
6. Whether command results should move from JSON state to file/blob storage for screenshots.

---

## 2026-06-10 - Maksat macOS OpenClaw replacement and Gateway/onboarding fix

### User request

User showed Maksat's Mac screen with OpenClaw native app stuck on the original OpenClaw `Setup Wizard` error:

- `Gateway did not become ready. Check that it is running.`

User asked whether yesterday's installed OpenClaw should be removed or replaced by today's version.

### Decision

Do not fully wipe the app state. Replace only `/Applications/OpenClaw.app` with today's Starlab build and preserve:

- `com.starlab.openclaw.agent` UserDefaults;
- registration/device token;
- current Maksat identity;
- existing local OpenClaw config.

Reason: the old app binary can be stale, but the activation/token state is correct and should not require Maksat to re-enter a registration code.

### Maksat Mac access and current state

Connected successfully to:

- host: `192.168.1.221`
- user: `asik`
- hostname: `Mac.lan`

Found project paths:

- `/Users/asik/agent`
- `/Users/asik/agent/openclaw`
- `/Users/asik/agent/openclawagent`

Existing app before replacement:

- `/Applications/OpenClaw.app`

Preserved/verified Starlab activation:

- user id: `u-maksat`
- display name: `Maksat`
- role: `SENIOR_PM`
- employeeId: `maksat`
- deviceId: `asik-mac-mini.local`
- display name: `asik on Mac mini`

### Root cause notes

The screenshot was not a Starlab registration failure. It was the original OpenClaw onboarding wizard waiting for the local Gateway.

On the Mac, the Gateway was actually running after startup:

- `http://127.0.0.1:18789/health` returned `{"ok":true,"status":"live"}`.

So the visible wizard error was a bad onboarding state/UX for our corporate build. A Starlab-activated employee should not be blocked by the original OpenClaw setup wizard.

### macOS source changes

Changed OpenClaw macOS app behavior:

- `apps/macos/Sources/OpenClaw/OnboardingWizard.swift`
  - `shouldSkipWizard()` now returns `true` when `StarlabAgentClient.shared.isActivated`.
  - This prevents the original OpenClaw wizard from blocking a Starlab-activated device.

- `apps/macos/Sources/OpenClaw/MenuBar.swift`
  - On app launch, if Starlab is activated:
    - starts heartbeat;
    - starts command polling;
    - marks original OpenClaw onboarding as complete;
    - opens the `Starlab Agent` window.
  - If Starlab is not activated:
    - opens the `Starlab Agent` registration window so the employee can enter Nikolay's registration code.

- `apps/macos/Sources/OpenClaw/StarlabAgentClient.swift`
  - Fixed command polling state handling.
  - Successful polling with zero pending commands now clears stale `lastCommandError`.
  - This removed the old misleading `HTTP 404` status after nginx was fixed.

### Server nginx fix

Fixed public nginx proxy on VPS because new command polling endpoint was not exposed:

- VPS: `195.238.122.228`
- nginx config: `/etc/nginx/sites-enabled/starlabagent.pp.ua`
- backup created:
  - `/etc/nginx/sites-enabled/starlabagent.pp.ua.bak-20260610045027`

Added in both HTTP and HTTPS server blocks:

- `location ^~ /api/v1/device-agents/commands`
- proxied to `http://127.0.0.1:3099`

Verification:

- `nginx -t` passed.
- `systemctl reload nginx` completed.
- External request to `https://starlabagent.pp.ua/api/v1/device-agents/commands?deviceId=test` now returns `401 Invalid device agent ingest token` instead of `404`.
- This is expected without the device token and proves nginx routes to the control-plane API.

Note: nginx still prints warnings about duplicate `server_name starlabagent.pp.ua` blocks. I did not change that because it existed already and was unrelated; Claude should inspect later.

### Build and install on Maksat Mac

Uploaded changed source files to:

- `/Users/asik/agent/openclaw/apps/macos/Sources/OpenClaw/OnboardingWizard.swift`
- `/Users/asik/agent/openclaw/apps/macos/Sources/OpenClaw/MenuBar.swift`
- `/Users/asik/agent/openclaw/apps/macos/Sources/OpenClaw/StarlabAgentClient.swift`

Built on Maksat Mac:

```bash
cd /Users/asik/agent/openclaw
PATH=/Users/asik/.local/node-v24.16.0-darwin-arm64/bin:$PATH SKIP_DMG=1 bash scripts/package-starlab-mac-dist.sh
```

Build result:

- `dist/OpenClaw.app`
- `dist/OpenClaw-2026.6.2.dmg`
- `dist/starlab-openclaw-agent-macos-universal.dmg`

Installed by replacing:

- `/Applications/OpenClaw.app`

Backups created on Maksat Mac:

- `/Users/asik/agent/backups/OpenClaw.app.before-starlab-onboarding-*`
- `/Users/asik/agent/backups/OpenClaw.app.before-command-status-fix-*`

Set onboarding defaults:

- `openclaw.onboardingSeen = true`
- `openclaw.onboardingVersion = 7`

Final installed app verification:

- running process: `/Applications/OpenClaw.app/Contents/MacOS/OpenClaw`
- bundle id: `com.starlab.openclaw.agent`
- binary: Mach-O universal `x86_64 arm64`
- signature: ad-hoc
- Gateway health: `{"ok":true,"status":"live"}`

Important warning:

- The app is still ad-hoc signed because no Apple Developer ID certificate is available.
- macOS TCC permissions such as Accessibility/Screen Recording may need to be re-granted after replacing/restarting the app.
- Production needs a real Apple signing certificate and notarization.

### Final Starlab status on Maksat Mac

Verified after one polling cycle:

```json
{
  "activated": true,
  "user": {
    "employeeId": "maksat",
    "role": "SENIOR_PM",
    "id": "u-maksat",
    "displayName": "Maksat"
  },
  "agent": {
    "displayName": "asik on Mac mini",
    "heartbeatCount": 841,
    "lastSeenAt": "2026-06-10T05:05:15.291Z",
    "status": "online",
    "deviceId": "asik-mac-mini.local"
  },
  "lastHeartbeatError": null,
  "lastCommandError": null,
  "onboardingSeen": true,
  "onboardingVersion": 7
}
```

### Download artifact

Updated local and VPS macOS DMG:

- local:
  - `C:\Users\dasmu\agent\control-plane\public\downloads\starlab-openclaw-agent-macos-universal.dmg`
- VPS:
  - `/opt/company-control-plane/public/downloads/starlab-openclaw-agent-macos-universal.dmg`
- public URL:
  - `https://starlabagent.pp.ua/downloads/starlab-openclaw-agent-macos-universal.dmg`

Final public verification:

- HTTP: `200`
- content type: `application/x-apple-diskimage`
- content length: `63469318`
- SHA256:
  - `56b820b41f408de7d6f3efc5a7371083172463ddaf8e4ffe55e7b50271d452dd`

### End-to-end command test

Ran a safe command test from the control-plane API as Nikolay:

- actor: `u-nikolay`
- target device: `asik-mac-mini.local`
- command: `active_window`

Result:

- command id: `cmd-f895746d-5c5f-4133-a006-69947fdccfe5`
- status: `succeeded`
- claimed by Mac agent after polling;
- attempts: `1`;
- result:

```json
{
  "app": {
    "name": "OpenClaw",
    "processId": 16065,
    "bundleIdentifier": "com.starlab.openclaw.agent"
  }
}
```

This verifies the full path:

1. server creates a command;
2. native macOS OpenClaw agent polls `/api/v1/device-agents/commands`;
3. local app executes the command;
4. local app posts command result back to the server.

Important follow-up:

- There are currently two Maksat device records:
  - `maksat-mac-mini` - older daemon-style device with only `heartbeat/openclaw-client`;
  - `asik-mac-mini.local` - today's native OpenClaw app with `command-polling` and desktop actions.
- A command created with alias `target: "maksat"` resolved to old `maksat-mac-mini`.
- This did not execute because that older daemon does not poll desktop commands.
- Fixed immediately after this test:
  - `src/domain/device-agents.js` now resolves alias targets by combining device alias matches with the matched user's devices.
  - Device candidates are ranked by:
    - `online` status;
    - `command-polling` capability;
    - requested command capability;
    - latest `lastSeenAt`.
  - Added regression test:
    - `test/device-agents.test.js`
    - `device command aliases prefer command-capable agent for the target user`

Deploy for alias fix:

- VPS backup:
  - `/opt/company-control-plane/backups/codex-device-alias-20260610051946`
- Uploaded:
  - `/opt/company-control-plane/src/domain/device-agents.js`
  - `/opt/company-control-plane/test/device-agents.test.js`
- Ran on VPS:
  - `node --check src/domain/device-agents.js`
  - `node --test test/device-agents.test.js`
- Restarted:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Both services returned `active`.

Final alias e2e verification:

- Created command with `target: "maksat"` and `type: "active_window"`.
- Server selected `deviceId: "asik-mac-mini.local"`.
- Mac native app claimed and completed the command.
- Result:

```json
{
  "status": "succeeded",
  "deviceId": "asik-mac-mini.local",
  "result": {
    "app": {
      "name": "OpenClaw",
      "processId": 16065,
      "bundleIdentifier": "com.starlab.openclaw.agent"
    }
  }
}
```

### Patch artifact

Regenerated:

- `OPENCLAW_STARLAB_DEVICE_CONTROL.patch`

This patch is necessary because top-level git ignores `openclaw/`.

Included Starlab-relevant OpenClaw paths only:

- `.github/workflows/starlab-desktop-build.yml`
- `package.json`
- `apps/macos/Sources/OpenClaw/AppNavigationActions.swift`
- `apps/macos/Sources/OpenClaw/MenuBar.swift`
- `apps/macos/Sources/OpenClaw/MenuContentView.swift`
- `apps/macos/Sources/OpenClaw/OnboardingWizard.swift`
- `apps/macos/Sources/OpenClaw/SessionMenuLabelView.swift`
- `apps/macos/Sources/OpenClaw/StarlabAgentClient.swift`
- `apps/macos/Sources/OpenClaw/StarlabAgentWindow.swift`
- `apps/macos/Sources/OpenClaw/StarlabDeviceCommandExecutor.swift`
- `apps/windows/**`
- `scripts/package-starlab-mac-dist.sh`

Intentionally not included:

- random `CLAUDE.md` modifications inside the `openclaw/` checkout;
- unrelated OpenClaw repo noise.

### Claude review checklist for this item

1. Confirm the Starlab onboarding bypass is acceptable for activated devices.
2. Check whether always opening `Starlab Agent` on launch is desired or should be first-run only.
3. Review command polling security:
   - device token validation;
   - command TTL;
   - hierarchy enforcement;
   - audit trail.
4. Review macOS command executor safety before enabling broader actions by default.
5. Decide how to handle Apple signing/notarization for stable permissions.
6. Clean up nginx duplicate `server_name` warnings when there is a maintenance window.

## 2026-06-10 - Platrum replaces Bitrix as task/project source (planning only)

User request:

- Temporarily forget the local OpenClaw desktop agent.
- Replace Bitrix task/project data with the company's internal product `Platrum`.
- Local source checkout: `C:\Users\dasmu\platrum`.
- Public API docs: `https://platrum.starlabit.com/api/docs/`.
- Superuser test credentials were provided by the user and used only for read-only API exploration.
- Important additional requirement from user: the Starlab agent must not only display Platrum data, but analyze it, save analytics/history in our own DB/state, and allow Nikolay to compare employee statistics after weeks/months.
- n8n requirement: keep the workflow as understandable visual blocks. JS is allowed only where useful, mainly normalizers/calculators/formatters, not one huge all-in-one Code node.

Local Platrum code explored:

- `C:\Users\dasmu\platrum\platrum-backend\README.md`
- `C:\Users\dasmu\platrum\platrum-backend\docs\openapi.generated.json`
- `C:\Users\dasmu\platrum\platrum-backend\docs\api-paths.generated.md`
- `C:\Users\dasmu\platrum\platrum-backend\apps\tasks\views.py`
- `C:\Users\dasmu\platrum\platrum-backend\apps\tasks\serializers.py`
- `C:\Users\dasmu\platrum\platrum-backend\reports\views.py`
- `C:\Users\dasmu\platrum\platrum-backend\reports\serializers.py`
- Existing Starlab n8n modules:
  - `C:\Users\dasmu\agent\n8n\modular\01-parse-telegram.n8n.js`
  - `C:\Users\dasmu\agent\n8n\modular\02-access-scope.n8n.js`
  - `C:\Users\dasmu\agent\n8n\modular\03-bitrix-context.n8n.js`
  - `C:\Users\dasmu\agent\n8n\modular\04-google-context.n8n.js`
  - `C:\Users\dasmu\agent\n8n\modular\06-claude-response.n8n.js`

Platrum stack:

- Backend is Django + DRF + JWT (`rest_framework_simplejwt`).
- Frontend is Vite/React.
- API base used for live checks: `https://platrum.starlabit.com`.
- OpenAPI title: `Onboarding API`, version `1.0.0`.

Live read-only API checks completed:

- `POST /api/v1/auth/login/` returns `refresh` and `access`.
- `GET /api/v1/auth/me/` returned user `maslov`, role `superadmin`, email `openclawstarlab@gmail.com`.
- `GET /api/v1/accounts/org/users/` returned 26 users.
- `GET /api/v1/accounts/org/structure/` returned 8 departments.
- `GET /api/v1/accounts/company/structure/` returned owner/departments structure.
- `GET /api/v1/accounts/me/team/` returned 21 team users for the superuser account.
- `GET /api/v1/tasks/team/` returned 11 tasks.
- `GET /api/v1/tasks/projects/` returned 2 projects. Example project:
  - id `6`
  - name `ИИ агенты для каждого сотрудника`
  - PM/owner `Султаналиев Максат`, username `max`, user id `23`
  - deadline `2026-06-20`
- `GET /api/v1/tasks/projects/6/report/` returned project report with totals/progress/overdue tasks.
- `GET /api/v1/tasks/projects/6/tasks/` returned project task id `8`, status `review`, overdue true, assignee `max`.
- `GET /api/v1/tasks/report-summary/?scope=team` returned total `11`, completed `5`, overdue `1`, progress `45.45`.
- `GET /api/v1/tasks/report-summary/?scope=team&due_date_from=01.06.2026&due_date_to=10.06.2026` returned period summary.
- `GET /api/v1/reports/employee/daily/` returned employee daily reports.
- `GET /api/v1/attendance/team/?year=2026&month=6` returned attendance marks.
- `GET /api/v1/metrics/team/` returned team metrics such as team size, tasks created/closed, overdue tasks, attendance percent.

Important endpoint behavior discovered:

- Task filters in `apps/tasks/views.py` support:
  - `assignee`
  - `status`
  - `priority`
  - `overdue`
  - `due_date_from`
  - `due_date_to`
- Task status model:
  - `new`
  - `in_progress`
  - `review`
  - `completed`
- Project report payload includes:
  - `project_id`
  - `total_task_count`
  - `completed_task_count`
  - `overdue_task_count`
  - `progress_percentage`
  - `status_counts`
  - `overdue_tasks`
- Daily report GET only officially filters by `date`; `user_id` is supported for POST/write but not GET filtering, so user-level filtering must happen client-side unless Platrum adds a query param.
- Attendance team endpoint requires `year` and `month`.
- Some live text came back mojibake in PowerShell output, but browser/API JSON likely uses UTF-8. Future n8n workflow export must be UTF-8 clean because current `06-claude-response.n8n.js` already contains corrupted Russian text.
- Some endpoints return plain arrays unless pagination params are used; implementation must handle both arrays and paginated `{ results }` shapes.

Proposed integration architecture:

1. Add a read-only Platrum connector in control-plane.
   - Suggested file: `control-plane/src/connectors/platrum-client.js`
   - Auth via `/api/v1/auth/login/` and `/api/v1/auth/refresh/`.
   - Store base URL, username and password/refresh token through setup secrets.
   - Default to read-only methods only; do not call write/move/approve/delete endpoints in the first version.

2. Add Platrum fields to setup UI.
   - `PLATRUM_BASE_URL`
   - `PLATRUM_USERNAME`
   - encrypted `PLATRUM_PASSWORD`
   - optional `PLATRUM_READ_ONLY=true`
   - Replace visible "Bitrix" setup section with "Platrum" or mark Bitrix as legacy/fallback.

3. Add mapping between Starlab users and Platrum users.
   - Prefer mapping by explicit `platrumUserId`.
   - Fallback matching by email, username, full name, Telegram handle.
   - Add `platrumUserId` and maybe `platrumUsername` to existing state users.
   - Add `platrumProjectId` to existing projects or sync projects dynamically from Platrum.

4. Replace Bitrix context in assistant with Platrum context.
   - In `company-assistant.js`, replace `bitrix` / `bitrixUserTasks` context with `platrum`.
   - Collect:
     - user profile/team
     - team tasks
     - project tasks
     - project report
     - employee daily reports
     - attendance
     - team metrics
   - Keep Google Calendar/Drive/Gmail as complementary context, not source of task truth.

5. Save daily analytics snapshots in our own state/DB.
   - Current control-plane uses JSON state via `JsonStore`; for MVP can add arrays:
     - `platrumSnapshots`
     - `employeeKpiDaily`
     - `projectKpiDaily`
     - `assistantInsights`
   - Better next step: move analytics history to SQLite/Postgres because monthly history will grow and JSON store will become fragile.

6. n8n workflow should be visual/modular:
   - Telegram Trigger
   - Parse Message / Extract Intent
   - Resolve Actor + Role Guard
   - Route Intent Switch
   - Platrum Auth / Token Cache
   - Get Users
   - Get Team Structure
   - Get Projects
   - Get Team Tasks
   - Get Project Tasks
   - Get Daily Reports
   - Get Attendance
   - Get Metrics
   - Normalize Platrum Data (small JS)
   - Merge with Google/Gmail/Drive Context
   - Calculate KPI/Efficiency (small JS)
   - Save Snapshot to Control-plane
   - Claude/AI Agent "brain"
   - Format Telegram Report
   - Send Telegram Message / Voice reply

7. Efficiency model draft:
   - `taskCompletionRate = completed / total`
   - `reviewCredit = review * 0.5`
   - `overduePenalty = overdue / total`
   - `reportCompleteness = submitted daily reports / expected work days`
   - `attendanceSignal = present work days / expected work days`
   - MVP formula:
     - `efficiency = clamp(100 * ((completed + review * 0.5) / total) - overduePenalty * 25 + reportCompleteness * 10 + attendanceSignal * 10, 0, 100)`
   - Keep raw components in DB so formula can be changed later without losing history.

Security and review notes for Claude:

- Current user-provided Platrum credentials are superuser; production should use a dedicated AI service user with read-only API permissions if Platrum supports that.
- Even if using superuser internally, control-plane/n8n must expose only hierarchy-filtered data:
  - Nikolay sees all.
  - Maksat sees his team/projects.
  - PM sees own projects/team only.
- First version must be read-only: no task move, approve, rework, delete, create.
- Do not print access/refresh tokens in Telegram responses, logs, n8n execution output, or worklog.
- Existing n8n Russian strings are mojibake in at least `06-claude-response.n8n.js`; fix encoding when implementing the new workflow.

Implementation status:

- Planning/research only. No code changes to Platrum or control-plane/n8n have been made for this integration yet.

## 2026-06-10 - Platrum read-only integration implemented locally

User follow-up:

- Keep using the current Platrum superuser for now.
- Add a strict agent-side ban on changing, deleting, approving, moving, creating or otherwise mutating anything in Platrum.
- Proceed with implementation.

Implemented files:

- `C:\Users\dasmu\agent\control-plane\src\connectors\platrum-client.js`
  - New Platrum connector.
  - Supports JWT login via `POST /api/v1/auth/login/`.
  - Business data access is GET-only.
  - `POST` is allowed only for auth login/refresh.
  - Blocks `POST/PATCH/PUT/DELETE` task/user/project operations before any network request.
  - Normalizes projects, tasks, project reports, report summary and daily reports.
- `C:\Users\dasmu\agent\control-plane\src\domain\platrum-reports.js`
  - Builds read-only project/user status reports.
  - Calculates task summaries and employee KPI.
  - Saves local snapshots to:
    - `platrumSnapshots`
    - `employeeKpiDaily`
    - `projectKpiDaily`
  - Writes audit actions:
    - `platrum.project_status.read`
    - `platrum.user_status.read`
- `C:\Users\dasmu\agent\control-plane\src\setup\setup-service.js`
  - Added setup support for:
    - `platrumBaseUrl`
    - encrypted `platrumUsername`
    - encrypted `platrumPassword`
  - Exports env:
    - `PLATRUM_BASE_URL`
    - `PLATRUM_USERNAME`
    - `PLATRUM_PASSWORD`
  - Setup readiness now requires Platrum credentials.
- `C:\Users\dasmu\agent\control-plane\src\setup\setup-page.js`
  - Added `Platrum` setup card.
  - The setup hint states that the server-side guard is read-only and blocks task changes/deletes/writes.
  - Bitrix card renamed to `Bitrix Legacy`.
- `C:\Users\dasmu\agent\control-plane\src\infra\seed.js`
  - Added initial Platrum mappings:
    - Nikolay: `platrumUserId: 25`, `platrumUsername: maslov`
    - Maksat: `platrumUserId: 23`, `platrumUsername: max`
    - Begayym/PM1: `platrumUserId: 18`, `platrumUsername: beks`
    - Project Alpha: `platrumProjectId: 6`
  - Added analytics arrays:
    - `platrumSnapshots`
    - `employeeKpiDaily`
    - `projectKpiDaily`
    - `assistantInsights`
- `C:\Users\dasmu\agent\control-plane\src\domain\policy.js`
  - Public user/project views now include Platrum IDs.
- `C:\Users\dasmu\agent\control-plane\src\assistant\company-assistant.js`
  - Assistant context now includes `platrum`.
  - Prompt instructs Claude to treat Platrum as primary task/project source and Bitrix as legacy fallback.
  - Assistant stores Platrum KPI snapshots after free-form assistant usage.
- `C:\Users\dasmu\agent\control-plane\src\domain\daily-assistant.js`
  - Daily progress/manager reports use Platrum tasks when `platrumClient` is available.
  - Existing Bitrix path remains fallback.
- `C:\Users\dasmu\agent\control-plane\src\api\router.js`
  - Added:
    - `POST /api/v1/reports/platrum/project-status`
    - `POST /api/v1/reports/platrum/user-status`
  - Local agent chat now passes `platrumClient` into the assistant.
- `C:\Users\dasmu\agent\control-plane\src\server.js`
  - Creates `platrumClient` from env/setup.
  - Logs connector status with `readOnly`.
- `C:\Users\dasmu\agent\control-plane\src\telegram-bot.js`
  - Passes `platrumClient` to Telegram handlers and daily automation.
- `C:\Users\dasmu\agent\control-plane\src\telegram\handler.js`
  - Added `/platrum`.
  - `/bitrix` now uses Platrum when `platrumClient` exists, otherwise falls back to old Bitrix behavior for compatibility.
  - Free-form assistant questions receive Platrum context.
- `C:\Users\dasmu\agent\control-plane\src\telegram\bot-commands.js`
  - Added `/platrum`.
  - `/bitrix` is now described as a legacy alias.
- `C:\Users\dasmu\agent\n8n\generate-visual-native-telegram-workflow.mjs`
  - Visual workflow generator now calls control-plane Platrum user-status endpoint instead of Bitrix user-status endpoint.
  - Brain context now includes `platrum` instead of `bitrix` for the AI path.
- `C:\Users\dasmu\agent\n8n\starlab-telegram-visual-native.workflow.json`
  - Regenerated from the visual workflow generator.
- `C:\Users\dasmu\agent\control-plane\test\platrum.test.js`
  - New tests for read-only guard, network blocking before fetch, normalization, project report snapshots and employee KPI snapshots.
- Updated tests:
  - `test/setup-service.test.js`
  - `test/telegram.test.js`

Read-only guard details:

- Allowed business-data calls are only GET endpoints such as:
  - `/api/v1/accounts/org/users/`
  - `/api/v1/tasks/team/`
  - `/api/v1/tasks/projects/`
  - `/api/v1/tasks/projects/{id}/tasks/`
  - `/api/v1/tasks/projects/{id}/report/`
  - `/api/v1/reports/employee/daily/`
  - `/api/v1/attendance/team/`
  - `/api/v1/metrics/team/`
- Blocked before network:
  - `POST /api/v1/tasks/projects/`
  - `PATCH /api/v1/tasks/{id}/`
  - `POST /api/v1/tasks/{id}/approve/`
  - `POST /api/v1/tasks/{id}/move/`
  - `DELETE /api/v1/tasks/{id}/`
  - `PUT /api/v1/accounts/...`

Verification:

- Syntax checks passed for:
  - `src/connectors/platrum-client.js`
  - `src/domain/platrum-reports.js`
  - `src/assistant/company-assistant.js`
  - `src/domain/daily-assistant.js`
  - `src/telegram/handler.js`
  - `src/api/router.js`
  - `src/setup/setup-service.js`
  - `n8n/generate-visual-native-telegram-workflow.mjs`
- Full control-plane test suite passed:
  - `node --test test/*.test.js`
  - 66 tests passed, 0 failed.
- Live read-only Platrum check passed against `https://platrum.starlabit.com`:
  - login as `maslov` returned user id `25`, role `superadmin`
  - project `6` returned 1 task
  - first task id `8`, status `review`, overdue `true`
  - project report total `1`, completed `0`, overdue `1`, progress `0`
  - no token values were printed
  - no write endpoint was called

Not yet done / next:

- Changes are local only; not deployed to the VPS/n8n instance in this step.
- Existing Telegram/daily report text still has old Bitrix wording in some legacy template strings because those files contain earlier mojibake text. Logic is Platrum-first, but a separate UTF-8 cleanup pass is recommended for beautiful Russian output.
- Need fill `/setup` on server with:
  - `Platrum API Base URL`: `https://platrum.starlabit.com`
  - `Platrum Username`: current service/superuser login
  - `Platrum Password`: current password
- Later: replace superuser with dedicated read-only Platrum service account when available.

## 2026-06-10 - Deployed Platrum integration to live control-plane and n8n

User clarified that the previous Platrum work must also be applied in the live
n8n instance, not only prepared locally.

Live server:

- `195.238.122.228`
- n8n directory: `/opt/starlab-n8n`
- control-plane directory: `/opt/company-control-plane`
- public domain: `https://starlabagent.pp.ua`

### n8n workflow updates

Updated local visual-native generator and workflow:

- `C:\Users\dasmu\agent\n8n\generate-visual-native-telegram-workflow.mjs`
- `C:\Users\dasmu\agent\n8n\starlab-telegram-visual-native.workflow.json`

Changes:

- Added `/platrum` route in the visual n8n workflow.
- Kept `/bitrix` only as a legacy alias that routes to the same Platrum branch.
- Renamed the visual nodes:
  - `Resolve Platrum Target User`
  - `Read Platrum User Status`
  - `Format Platrum Report`
  - `AI Platrum User Status`
- Replaced the old Bitrix report endpoint with:
  - `POST /api/v1/reports/platrum/user-status`
- Added clean UTF-8 Russian strings for the main n8n-generated Telegram replies:
  - help text;
  - devices report;
  - Google connect/status;
  - token report;
  - Platrum employee report;
  - Claude fallback;
  - voice reply caption / empty reply fallback.
- Fixed Cyrillic target matching in n8n expressions:
  - `максат`
  - `бегай`
  - `бегайым`
- Fixed Google calendar search terms in n8n expressions:
  - `Работа`
  - `рабочий график`
  - `работа`
  - `ПМ`

Deployment:

- Uploaded workflow JSON to:
  - `/tmp/starlab-telegram-visual-native.workflow.json`
  - `/opt/starlab-n8n/workflows/starlab-telegram-visual-native.workflow.json`
- Imported workflow into existing n8n workflow:
  - `starlabTelegramMvp01`
- Reactivated it.
- Restarted n8n container:
  - `starlab-n8n_n8n_1`

### control-plane live deployment

The first live n8n test showed the new endpoint did not exist yet on the server:

- `POST /api/v1/reports/platrum/user-status`
- old result: `404 Route not found`

So the control-plane source was deployed too.

Uploaded source-only deployment tarball to the server and extracted into:

- `/opt/company-control-plane`

No runtime data or secrets were overwritten.

Backup before replacing source files:

- `/opt/company-control-plane/backups/codex-platrum-20260610-090715`

Files included:

- `src/connectors/platrum-client.js`
- `src/domain/platrum-reports.js`
- `src/setup/setup-service.js`
- `src/setup/setup-page.js`
- `src/infra/seed.js`
- `src/domain/policy.js`
- `src/assistant/company-assistant.js`
- `src/domain/daily-assistant.js`
- `src/api/router.js`
- `src/server.js`
- `src/telegram-bot.js`
- `src/telegram/daily-assistant-reporter.js`
- `src/telegram/handler.js`
- `src/telegram/bot-commands.js`

Server syntax checks passed for the deployed files:

- `src/connectors/platrum-client.js`
- `src/domain/platrum-reports.js`
- `src/api/router.js`
- `src/server.js`
- `src/assistant/company-assistant.js`
- `src/domain/daily-assistant.js`

Restarted services:

- `company-control-plane-api.service`
- `company-control-plane-telegram-bot.service`

Both returned `active`.

### Platrum setup on server

Saved Platrum config through local setup API on the server.

No secrets were written into this worklog.

Verified setup response:

- `configured: true`
- `platrumBaseUrl: https://platrum.starlabit.com`
- `platrumUsername.configured: true`
- `platrumPassword.configured: true`

After restart, server logs show:

- `platrum connector: platrum configured=true readOnly=true`

### Existing state migration

Because `createInitialState()` only affects new stores, the live
`/var/lib/company-control-plane/control-plane.json` still did not contain the
new Platrum IDs. Added a small one-time migration for the existing state.

State backup:

- `/var/lib/company-control-plane/backups/codex-platrum-state-20260610091330`

Updated live state mappings:

- `u-nikolay`
  - `platrumUserId: 25`
  - `platrumUsername: maslov`
- `u-maksat`
  - `platrumUserId: 23`
  - `platrumUsername: max`
- `u-pm-1`
  - `platrumUserId: 18`
  - `platrumUsername: beks`
- `project-alpha`
  - `platrumProjectId: 6`

Also ensured these analytics arrays exist:

- `platrumSnapshots`
- `employeeKpiDaily`
- `projectKpiDaily`
- `assistantInsights`

### Live verification

Direct control-plane Platrum endpoint test:

- request:
  - `POST http://127.0.0.1:3099/api/v1/reports/platrum/user-status`
  - actor header: Nikolay Telegram id from live state
  - body target: `u-maksat`
- response:
  - HTTP `200`
  - `ok: true`
  - `source: platrum`
  - `configured: true`
  - `readOnly: true`
  - requester Nikolay resolved with `platrumUserId: 25`
  - Maksat resolved with `platrumUserId: 23`
  - Project Alpha resolved with `platrumProjectId: 6`
  - current Platrum summary included 1 task in review, overdue true

n8n smoke test:

- Sent a fake Telegram webhook update to local n8n:
  - `POST http://127.0.0.1:5678/webhook/starlab-telegram`
  - text: `/platrum максат`
  - chat id: `0` to avoid messaging a real user
- n8n returned HTTP `200`:
  - `Workflow was started`
- Fresh n8n/control-plane logs showed no new runtime errors.

Known note:

- n8n still logs the existing Python runner warning because the container does
  not include Python. This is non-blocking for the current workflow because it
  uses JS/HTTP nodes.
- The `update:workflow` n8n CLI command is deprecated but still worked; n8n
  suggested `publish:workflow` for the future.

## 2026-06-10 - Metricon data outage fix and n8n Metricon context

User reported that Metricon is actively used in the company but the agent does
not receive data from it.

### Root causes found

1. Stored Metricon refresh token was no longer usable.
   - Live control-plane returned `Metricon token refresh failed`.
   - Metricon API body contained `REFRESH_TOKEN_REUSE_DETECTED`.
   - Metricon rotates refresh tokens, but the old client did not persist the new
     rotated refresh token after refresh.

2. Metricon base URL in setup was `http://metriconapp.com/`.
   - Direct server-side test with the same stored token:
     - `https://metriconapp.com/api/v1/activity/report` returned HTTP `200`.
     - `http://metriconapp.com/api/v1/activity/report` returned HTTP `401`.
   - The HTTP to HTTPS transition drops the Authorization header, so the control
     plane was effectively calling Metricon unauthenticated.

3. The n8n visual workflow did not yet include Metricon in the AI context.
   - Even after fixing control-plane, Claude through n8n would not see Metricon
     activity unless a direct command branch and AI context branch were added.

### Local code changes

Files changed for Metricon:

- `control-plane/src/connectors/kickidler-client.js`
  - Added refresh-token support to `createKickidlerClientFromEnv`.
  - Added refresh lock to prevent concurrent refresh calls from reusing the same
    refresh token in one process.
  - Added callback `onTokenRefresh(tokens)` so rotated tokens can be persisted.
  - Added `/api/v1` URL builder that supports both base URLs with and without
    `/api/v1`.
  - Refresh is now attempted only on HTTP `401`, not on `403`, so permission
    errors are not hidden behind refresh failures.

- `control-plane/src/setup/setup-service.js`
  - Added encrypted `kickidlerRefreshToken` support.
  - Added `saveMetriconTokens({ accessToken, refreshToken })` for automatic
    token persistence.

- `control-plane/src/server.js`
  - API Metricon client now persists rotated tokens through setup service.

- `control-plane/src/telegram-bot.js`
  - Telegram bot Metricon client now persists rotated tokens too.

- `control-plane/src/domain/reports.js`
  - Normalizes Metricon fields into `activeSeconds`, `idleSeconds`,
    `totalSeconds` while preserving raw Metricon payload.

- `control-plane/src/telegram/handler.js`
  - `/metricon` report uses a clean readable formatter instead of the older
    rough/debug output.

- `control-plane/test/metricon-client.test.js`
  - Added tests for token rotation persistence and no refresh on `403`.

Files changed for n8n:

- `n8n/generate-visual-native-telegram-workflow.mjs`
  - Added `/metricon` command route.
  - Added direct workflow nodes:
    - `Resolve Metricon Target User`
    - `Read Metricon Activity`
    - `Format Metricon Report`
  - Added AI context node:
    - `AI Metricon Activity`
  - Added Metricon data into the `Starlab Brain - Build AI Context` payload.

- `n8n/starlab-telegram-visual-native.workflow.json`
  - Regenerated from the visual workflow generator.
  - Current workflow has 34 nodes and includes Metricon branches.

### Local verification

Passed locally:

- `node --check src/connectors/kickidler-client.js`
- `node --check src/setup/setup-service.js`
- `node --check src/server.js`
- `node --check src/telegram-bot.js`
- `node --check src/domain/reports.js`
- `node --check src/telegram/handler.js`
- `node --test test/metricon-client.test.js test/reports.test.js`
  - 8 passed, 0 failed

Earlier in the same work session the full control-plane suite also passed:

- `node --test test/*.test.js`
  - 67 passed, 0 failed

### Server deployment

Server:

- `195.238.122.228`
- control-plane path: `/opt/company-control-plane`
- n8n workflow path: `/opt/starlab-n8n/workflows/starlab-telegram-visual-native.workflow.json`

Control-plane files deployed and services restarted:

- `company-control-plane-api.service`
- `company-control-plane-telegram-bot.service`

Backups created:

- `/opt/company-control-plane/backups/codex-metricon-20260610-095900`
- `/opt/company-control-plane/backups/codex-metricon-403-20260610-101105`

n8n workflow imported and container restarted:

- workflow id: `starlabTelegramMvp01`
- workflow name: `Starlab Agent - Telegram Visual Native`
- verified DB export contains:
  - `/metricon`
  - `AI Metricon Activity`
  - `Read Metricon Activity`
  - `Format Metricon Report`

### Live setup changes

No secrets are written here.

Actions completed:

- Saved fresh Metricon access/refresh tokens through
  `POST http://127.0.0.1:3099/api/v1/setup/services`.
- Changed Metricon base URL from `http://metriconapp.com/` to
  `https://metriconapp.com`.
- Restarted Telegram bot after updating encrypted secrets.

Setup status after save:

- `configured: true`
- `kickidlerBaseUrl: https://metriconapp.com`
- `kickidlerAccessToken.configured: true`
- `kickidlerRefreshToken.configured: true`

### Live verification

Direct Metricon endpoint through control-plane:

- request:
  - `POST http://127.0.0.1:3099/api/v1/reports/metricon/activity-summary`
  - actor header: Nikolay Telegram id from live setup
  - target user: `u-maksat`
  - period: last 7 days
- response:
  - HTTP `200`
  - `ok: true`
  - `source: metricon`
  - `configured: true`
  - `employees: 1`
  - first employee: `Maksat`
  - normalized values currently returned by Metricon:
    - `activeSeconds: 0`
    - `idleSeconds: 0`
  - raw Metricon payload also returned zeros:
    - `totalActiveTime: 0`
    - `totalIdleTime: 0`
    - `totalAppTime: 0`
    - `totalWebTime: 0`

Important interpretation:

- Integration is now working: the control-plane reaches Metricon and receives
  authenticated HTTP `200`.
- Metricon itself currently returns zero activity for Maksat in the tested
  period/employee mapping. Claude should review whether `u-maksat` has the
  correct `kickidlerEmployeeId` and whether Metricon stores activity under a
  different employee/device/date range.

### What Claude should review

- Confirm no accidental broad refactor in `control-plane/src/telegram/handler.js`
  from earlier work affects existing Telegram commands.
- Confirm Metricon report formatting is good enough for the user-facing bot.
- Verify all employees have correct `kickidlerEmployeeId` values in live state.
- Test `/metricon` from Telegram with a real authorized chat after the user is
  ready, because I avoided sending test messages to real users.

### Follow-up test stability fix

While running the final full suite, one pre-existing device-agent test failed
because it created a command at fixed `2026-06-10T10:00:00Z`, then called a
negative command creation path without a fixed `now`. Since the real current
time was already past the command TTL, that helper expired the queued command
before the test claimed it.

Changed only the test:

- `control-plane/test/device-agents.test.js`
  - Added the same fixed `now` to the negative `createDeviceCommand` call.

Final local verification:

- `node --test test/*.test.js`
  - 68 passed, 0 failed

## 2026-06-10 - Nikolay local OpenClaw registration code

User installed the local OpenClaw agent from the Starlab site on Nikolay's
computer and asked what registration number to enter.

Action:

- Created a one-time invite/registration code through the live control-plane
  API, not by editing the JSON database manually.
- Endpoint used:
  - `POST http://127.0.0.1:3099/api/v1/invite-codes`
  - actor: Nikolay
  - target user: `u-nikolay`
  - ttl: 1440 minutes

Result:

- Code created for `Nikolay` / `u-nikolay`.
- Expires at `2026-06-11T10:40:26.732Z`.

Security note:

- The actual one-time code was given to the user in chat. It is intentionally
  not written into this worklog because it can activate a device.

## 2026-06-10 - Plan for official OpenClaw Starlab desktop distribution

User clarified the desired product direction:

- Use official OpenClaw release/source as the real desktop agent base.
- Keep OpenClaw's built-in capabilities instead of replacing it with a tiny
  custom helper.
- Customize first-run setup for Starlab:
  - no provider picker
  - no channel/messaging picker
  - no manual Anthropic API key entry by employees
  - first screen should be Starlab registration code only
- Local OpenClaw app becomes the "hands" of the Telegram/n8n assistant.
- Telegram/n8n/control-plane remains the "brain" and hierarchy/permissions
  layer.
- Improved Starlab builds should later be published on the Starlab `/download`
  page for macOS and Windows.

Local artifacts found:

- `C:\Users\dasmu\Downloads\openclaw-2026.6.5.zip`
- `C:\Users\dasmu\Downloads\OpenClaw-2026.6.5.dmg`
- `C:\Users\dasmu\Downloads\starlab-openclaw-agent-windows.exe`
- source repo at `C:\Users\dasmu\agent\openclaw`

Important technical decision:

- Do not binary-patch the official `.dmg`/`.exe` as the main strategy.
- Correct strategy is to build a Starlab distribution from the official
  OpenClaw source/tag and use official release binaries only as reference and
  smoke-test baselines.
- Do not embed the company Anthropic API key into desktop apps. Desktop clients
  should authenticate to Starlab control-plane with device tokens; Claude calls
  should stay server-side.

High-level architecture planned:

1. Telegram user message enters Starlab Telegram bot / n8n.
2. n8n/control-plane resolves actor, hierarchy, target device, and intent.
3. If action requires the employee computer, control-plane creates a
   `deviceCommand` for the user's activated local OpenClaw device.
4. Starlab OpenClaw desktop app polls or maintains a secure channel to
   control-plane, claims commands, executes them using OpenClaw/Gateway tools,
   and reports result/screenshots/status back.
5. Telegram bot replies to the user with the action result.
6. Scheduled actions are stored server-side and fired by n8n/control-plane into
   the same command queue.

Planned implementation phases:

- Phase 1: clean source baseline
  - create a clean Starlab branch/worktree from official `v2026.6.5`
  - preserve current dirty changes separately for review before reusing them

- Phase 2: Starlab managed onboarding
  - modify macOS onboarding so first run asks only for registration code
  - registration calls `/api/v1/device-agents/activate`
  - store only Starlab device token locally
  - show connected user/device/status after activation

- Phase 3: Starlab command channel
  - local OpenClaw polls or streams `/api/v1/device-agents/commands`
  - command execution maps onto existing OpenClaw/Gateway capabilities
  - command result returns to `/api/v1/device-agents/commands/:id/result`

- Phase 4: server/n8n integration
  - n8n routes local-computer intents into structured `deviceCommand` payloads
  - add scheduled-action workflow/table for "tomorrow at 12 do X on my Mac"
  - preserve role hierarchy and self-device rules

- Phase 5: packaging
  - macOS: build Starlab OpenClaw `.app`/`.dmg`
  - Windows: build Starlab OpenClaw installer `.exe`
  - publish artifacts to server downloads folder
  - update `/download` page to point to real Starlab OpenClaw builds

Risks/notes for Claude:

- macOS code signing/notarization may be needed for a smooth install. Without
  Apple Developer signing, users may see Gatekeeper warnings.
- Windows SmartScreen may warn until the executable is signed/reputed.
- Current `C:\Users\dasmu\agent\openclaw` worktree is dirty and includes earlier
  Starlab attempts; review before reusing.

## 2026-06-10 - Starlab OpenClaw desktop distribution pass

User request:

- Continue after Codex Desktop crashed.
- Take the official OpenClaw `v2026.6.5` source/release direction and make a
  Starlab company build instead of a separate toy helper.
- Preserve OpenClaw capabilities where source support exists.
- First launch must ask only for Starlab registration code.
- Telegram/n8n/control-plane should be the brain; local OpenClaw app should be
  the employee computer hands.
- Windows must produce a real `.exe` installer.
- macOS must be buildable as a real OpenClaw `.app`/`.dmg`.
- Publish/download flow must use `/download`.

Important decision:

- I did not binary-patch the official `.dmg`/`.exe`. The maintainable path is
  source-based Starlab builds.
- macOS customization is integrated into official OpenClaw Swift sources.
- Windows official source tree does not contain an equivalent native Windows UI
  app, so Windows is implemented as a Starlab Electron desktop target inside the
  OpenClaw source tree. It uses the same Starlab control-plane protocol and is
  suitable for employee computers.
- The Anthropic/Claude key is not embedded into desktop apps. Local desktop apps
  store only per-device Starlab tokens; Claude remains server-side.

Created clean source baseline:

- `C:\Users\dasmu\agent\openclaw-starlab-2026.6.5`
- Extracted from `C:\Users\dasmu\Downloads\openclaw-2026.6.5.zip`.
- This is separate from the dirty older `C:\Users\dasmu\agent\openclaw` tree.

macOS source changes in clean tree:

- `apps/macos/Sources/OpenClaw/StarlabAgentClient.swift`
  - Adds Starlab activation against `/api/v1/device-agents/activate`.
  - Stores Starlab device config in UserDefaults.
  - Sends heartbeat to `/api/v1/device-agents/heartbeat`.
  - Polls `/api/v1/device-agents/commands`.
  - Sends command results to
    `/api/v1/device-agents/commands/:id/result`.
  - Sends local chat to `/api/v1/local-agent/chat`.

- `apps/macos/Sources/OpenClaw/StarlabDeviceCommandExecutor.swift`
  - Adds local macOS actions:
    `open_app`, `close_app`, `open_url`, `open_file`,
    `list_running_apps`, `active_window`, `screenshot`,
    `clipboard_get`, `clipboard_set`, `keyboard_type`, `hotkey`,
    `mouse_click`.
  - `ocr_screen` and `openclaw_prompt` are reserved/unsupported for now.

- `apps/macos/Sources/OpenClaw/StarlabAgentWindow.swift`
  - Adds Starlab registration/chat window.
  - First screen asks for server URL and registration code only.
  - After activation it shows binding info, heartbeat, command status, and
    local chat with the same server assistant as Telegram.

- `apps/macos/Sources/OpenClaw/AppNavigationActions.swift`
  - Adds `openStarlabAgent()`.

- `apps/macos/Sources/OpenClaw/MenuContentView.swift`
  - Adds menu item `Starlab Agent`.

- `apps/macos/Sources/OpenClaw/MenuBar.swift`
  - Adds dock menu item `Open Starlab Agent`.
  - Starts Starlab managed mode on launch.
  - If already activated, marks original OpenClaw onboarding complete and starts
    heartbeat/command polling.
  - If not activated, opens Starlab registration window.

- `apps/macos/Sources/OpenClaw/OnboardingWizard.swift`
  - Skips original wizard after Starlab activation.

- `scripts/package-starlab-mac-dist.sh`
  - Builds Starlab macOS `.app`/`.dmg` from the existing OpenClaw Swift target.
  - Defaults to ad-hoc signing/no notarization for internal builds.

Windows/Linux desktop target added in clean tree:

- `apps/windows/package.json`
  - Electron/electron-builder app.
  - `npm run build:win` creates `dist/starlab-openclaw-agent-windows.exe`.
  - `npm run build:linux` creates `dist/starlab-openclaw-agent-linux-amd64.deb`
    when run on a Linux builder.
  - Windows installer requests administrator rights and creates desktop/start
    menu shortcuts.

- `apps/windows/src/main.cjs`
  - Activates with registration code only.
  - Stores device token with Electron `safeStorage` when available.
  - Sends heartbeat every 60 seconds.
  - Polls device commands every 5 seconds.
  - Sends local chat to `/api/v1/local-agent/chat`.
  - Starts at Windows login using Electron login item settings.
  - Supports Windows local actions:
    `open_app`, `close_app`, `open_url`, `open_file`,
    `list_running_apps`, `active_window`, `screenshot`,
    `clipboard_get`, `clipboard_set`, `keyboard_type`, `hotkey`,
    `mouse_click`.
  - Added common app aliases for Chrome, Edge, Telegram, VS Code, Office apps,
    Notepad, Explorer, Calculator.

- `apps/windows/src/preload.cjs`
  - Exposes safe IPC bridge to renderer.

- `apps/windows/src/renderer.html`, `renderer.js`, `styles.css`
  - Registration UI and local assistant chat UI.
  - No provider/channel/API-key questions.

- `apps/windows/README.md`
  - Documents flow, commands, and build instructions.

Root scripts added:

- `starlab:mac:package`
- `starlab:windows:install`
- `starlab:windows:build`
- `starlab:linux:build`

CI workflow added:

- `.github/workflows/starlab-desktop-build.yml`
  - Windows installer on `windows-latest`.
  - macOS DMG on `macos-latest`.
  - Linux `.deb` on `ubuntu-latest`.
  - Uploads build artifacts.

Build and verification completed:

- `node --check apps/windows/src/main.cjs` passed.
- `node --check apps/windows/src/renderer.js` passed.
- `npm --prefix apps/windows install` completed.
  - NPM reported 10 high severity vulnerabilities in Electron/electron-builder
    dependency tree. Build still works; Claude should review whether to bump
    Electron/electron-builder or accept short-term for internal build.
- `npm --prefix apps/windows run build:win` passed.
- New Windows artifact:
  - `C:\Users\dasmu\agent\openclaw-starlab-2026.6.5\apps\windows\dist\starlab-openclaw-agent-windows.exe`
  - size: 81,690,518 bytes
- Copied new Windows artifact to download folder:
  - `C:\Users\dasmu\agent\control-plane\public\downloads\starlab-openclaw-agent-windows.exe`
  - size: 81,690,518 bytes
- JSON validation passed for:
  - `openclaw-starlab-2026.6.5\package.json`
  - `openclaw-starlab-2026.6.5\apps\windows\package.json`

Known limitations / next checks for Claude:

- macOS DMG was not rebuilt on this Windows machine. Build it on a Mac or via
  the added GitHub Actions workflow.
- macOS Swift was not compiled here because Windows has no macOS Swift/AppKit
  toolchain.
- Windows `.exe` is unsigned; SmartScreen warning is expected until a code
  signing certificate/reputation is added.
- macOS ad-hoc build will trigger Gatekeeper warnings unless Developer ID
  signing and notarization are configured.
- `ocr_screen` and deeper `openclaw_prompt` bridge are not implemented yet.
- `/download` currently has the fresh Windows `.exe`; macOS `.dmg` should be
  replaced after a Mac build from the clean source tree.

Server deployment completed:

- VPS: `195.238.122.228`
- Production app path found:
  - `/opt/company-control-plane`
- Uploaded fresh Windows installer to:
  - `/opt/company-control-plane/public/downloads/starlab-openclaw-agent-windows.exe`
- Set ownership:
  - `company-control-plane:company-control-plane`
- Verified server file:
  - size: 81,690,518 bytes
  - mode: `644`
- Verified public URL:
  - `https://starlabagent.pp.ua/downloads/starlab-openclaw-agent-windows.exe`
  - HTTP 200
  - `Content-Type: application/vnd.microsoft.portable-executable`
  - `Content-Length: 81690518`
- Verified download page:
  - `https://starlabagent.pp.ua/download`
  - HTTP 200

Git hygiene:

- Updated `C:\Users\dasmu\agent\.gitignore` to ignore generated desktop
  installers:
  - `control-plane/public/downloads/*.exe`
  - `control-plane/public/downloads/*.dmg`
  - `control-plane/public/downloads/*.deb`
- Reason: installer binaries are large generated artifacts and should be served
  from VPS/download storage or CI artifacts, not committed into Git history.

## 2026-06-10 - macOS Starlab OpenClaw build on Maksat Mac

User request:

- Build the normal macOS OpenClaw version using Maksat's Mac after Xcode was
  installed.
- Put the macOS build into the Starlab `/download` section.

Mac connection:

- Host: `192.168.88.42`
- User: `asik`
- Machine: `Mac-mini.local`
- macOS: `26.5`
- Architecture: `arm64`
- Xcode: `26.5` / build `17F42`
- Free space before build: about `171 GiB`

Tooling prepared on the Mac:

- Installed portable Node.js under:
  - `/Users/asik/.local/node-v24`
- Node version:
  - `v24.16.0`
- npm version:
  - `11.13.0`
- pnpm via corepack:
  - `11.2.2`

Important source correction:

- The local release source zip that had been extracted into
  `C:\Users\dasmu\agent\openclaw-starlab-2026.6.5` was not enough for a normal
  macOS package build.
- It was missing at least:
  - root `tsconfig.json`
  - `ui/`
- Because of that the first package attempt failed:
  - `tsdown`: `No input files`
  - then `ui:build`: no `ui/package.json`
- Corrected by cloning the full official GitHub repo/tag on the Mac:
  - `/Users/asik/starlab-build/openclaw-official-v2026.6.5`
  - source: `https://github.com/openclaw/openclaw.git`
  - tag: `v2026.6.5`
- The official clone did include:
  - `ui/`
  - `tsconfig.json`

Starlab changes copied into the full official clone:

- `apps/macos/Sources/OpenClaw/StarlabAgentClient.swift`
- `apps/macos/Sources/OpenClaw/StarlabDeviceCommandExecutor.swift`
- `apps/macos/Sources/OpenClaw/StarlabAgentWindow.swift`
- `apps/macos/Sources/OpenClaw/AppNavigationActions.swift`
- `apps/macos/Sources/OpenClaw/MenuContentView.swift`
- `apps/macos/Sources/OpenClaw/MenuBar.swift`
- `apps/macos/Sources/OpenClaw/OnboardingWizard.swift`
- `scripts/package-starlab-mac-dist.sh`
- Added `starlab:mac:package` script to the Mac clone package.json.

Build completed:

- Command:
  - `SKIP_NOTARIZE=1 ALLOW_ADHOC_SIGNING=1 pnpm starlab:mac:package`
- Full JS build completed.
- Control UI build completed.
- Swift release build completed for:
  - `arm64`
  - `x86_64`
- App bundle generated:
  - `/Users/asik/starlab-build/openclaw-official-v2026.6.5/dist/OpenClaw.app`
- DMG generated:
  - `/Users/asik/starlab-build/openclaw-official-v2026.6.5/dist/starlab-openclaw-agent-macos-universal.dmg`

macOS build verification:

- `hdiutil verify dist/starlab-openclaw-agent-macos-universal.dmg` passed:
  - checksum valid
- `codesign --verify --deep --strict --verbose=2 dist/OpenClaw.app` passed:
  - valid on disk
  - satisfies Designated Requirement
- `lipo -archs dist/OpenClaw.app/Contents/MacOS/OpenClaw`:
  - `x86_64 arm64`
- Bundle metadata:
  - `CFBundleIdentifier`: `com.starlab.openclaw.agent`
  - `CFBundleShortVersionString`: `2026.6.5`
  - `CFBundleVersion`: `2606000590`
- Binary strings confirmed Starlab integration:
  - `Open Starlab Agent`
  - `/api/v1/device-agents/activate`
  - `/api/v1/device-agents/heartbeat`
  - `/api/v1/device-agents/commands`
  - `/api/v1/local-agent/chat`
  - `Starlab OpenClaw Agent`

macOS artifact:

- Local copied artifact:
  - `C:\Users\dasmu\agent\.codex-temp\starlab-openclaw-agent-macos-universal.dmg`
- Local control-plane download copy:
  - `C:\Users\dasmu\agent\control-plane\public\downloads\starlab-openclaw-agent-macos-universal.dmg`
- Size:
  - `63,688,991` bytes
- SHA256:
  - `3ef91cac41bb464bc51af4dc6e8ee216819a9ebd6dd274f69f4209402a53b93d`

Server deployment completed:

- Uploaded to VPS:
  - `/opt/company-control-plane/public/downloads/starlab-openclaw-agent-macos-universal.dmg`
- Owner:
  - `company-control-plane:company-control-plane`
- Mode:
  - `644`
- Verified server file:
  - size: `63,688,991`
  - SHA256:
    `3ef91cac41bb464bc51af4dc6e8ee216819a9ebd6dd274f69f4209402a53b93d`
- Verified public URL:
  - `https://starlabagent.pp.ua/downloads/starlab-openclaw-agent-macos-universal.dmg`
  - HTTP `200`
  - `Content-Type: application/x-apple-diskimage`
  - `Content-Length: 63688991`
- Verified download page:
  - `https://starlabagent.pp.ua/download`
  - HTTP `200`

Known limitation:

- The app is ad-hoc signed and not notarized because no Apple Developer
  certificate/notarization credentials were provided.
- macOS Gatekeeper may warn on first launch. For production, configure
  Developer ID Application signing and notarization.

## 2026-06-10 - Telegram reset/reissue registration code for Nikolay

User request:

- Add a way for Nikolay to reset/reissue employee registration codes from the Telegram bot.

Implemented:

- Added domain-level invite reissue flow:
  - `control-plane/src/domain/invite-codes.js`
  - new `reissueInviteCode(...)`
  - new `revokeActiveInviteCodesForUser(...)`
- Behavior:
  - only `OWNER` can reissue codes via existing `assertCanIssueInvite`
  - old non-expired, non-revoked invite codes for the selected employee are revoked
  - a new invite/registration code is created
  - Telegram/user bindings and employee history are not deleted
- Added Telegram commands:
  - `/reset_code USER_ID`
  - hidden alias `/reissue_code USER_ID`
- Added `/reset_code` to the Telegram slash command menu:
  - `control-plane/src/telegram/bot-commands.js`
- Added Telegram UX:
  - help text for reset code
  - reissue result message with employee, new code, expiry, revoked count, and `/register CODE`
- Added HTTP endpoint for future setup/admin UI:
  - `POST /api/v1/invite-codes/reissue`
  - body: `{ "userId": "...", "ttlMinutes": 1440 }`
  - returns new code, invite info, revoked count
  - read/write protection still restricted to OWNER
- Added audit actions:
  - `telegram.invite.reissue`
  - `invite_code.reissue`

Files changed:

- `control-plane/src/domain/invite-codes.js`
- `control-plane/src/telegram/handler.js`
- `control-plane/src/telegram/bot-commands.js`
- `control-plane/src/api/router.js`
- `control-plane/test/invite-codes.test.js`
- `control-plane/test/telegram.test.js`

Verification:

- Ran `npm test` in `control-plane`.
- Result:
  - 70 tests passed
  - 0 failed
- New coverage:
  - domain reissue revokes old active employee codes
  - Telegram command menu includes `/reset_code`
  - Telegram `/help` includes `/reset_code`
  - OWNER can run `/reset_code u-maksat`
  - old code is revoked
  - new code can register employee

Claude review checklist:

- Confirm whether used invite codes should also be rejected by device activation.
  Current device activation already blocks revoked codes, and reset marks old codes
  revoked, but activation does not check `usedAt`.
- Confirm whether the admin setup page should expose a button for this new
  `/api/v1/invite-codes/reissue` endpoint.
- After deployment, verify in Telegram as Nikolay:
  - `/help`
  - `/reset_code u-maksat`
  - `/reset_code u-pm-1`

Deployment:

- Uploaded changed runtime files to VPS `/opt/company-control-plane`:
  - `src/domain/invite-codes.js`
  - `src/telegram/handler.js`
  - `src/telegram/bot-commands.js`
  - `src/api/router.js`
- Uploaded updated touched tests:
  - `test/invite-codes.test.js`
  - `test/telegram.test.js`
- Server targeted verification:
  - `node --test test/invite-codes.test.js test/telegram.test.js`
  - 19 passed, 0 failed
- Restarted services:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Post-restart status:
  - both services active
  - bot log: `telegram command menu synchronized (20 commands)`

Operational note:

- A full `npm test` on the VPS still has unrelated stale-test/code mismatch
  failures outside this change. Local full suite passes 70/70. For this change,
  the targeted server suite passes 19/19.

## 2026-06-10 - Real natural-language desktop commands for Telegram and local OpenClaw

User-reported problem:

- Maksat had multiple local agent records after repeated registration.
- Telegram assistant answered as if it queued `open_app Chrome`, but server state
  showed no `open_app` command was created.
- The local OpenClaw chat also replied that opening YouTube / playing a song was
  outside its capabilities.

Root cause:

- Free-form Telegram text and local `/api/v1/local-agent/chat` were sent straight
  to Claude.
- Claude could describe device actions but could not actually enqueue commands.
- Old heartbeat-only agents were still visible and could be selected/mentioned,
  even though they cannot claim command queue items.

Implemented:

- Added shared natural-language desktop intent handling:
  - `control-plane/src/domain/natural-device-actions.js`
- Supported obvious action intents before Claude is called:
  - open app: `открой Chrome`, `запусти Telegram`, `open Chrome`
  - open URL: `открой https://...`
  - YouTube/music: `открой YouTube`, `запусти любую песню`
  - screenshot: `сделай скриншот`
  - active window: `какое активное окно`
- Telegram free-form text now checks this intent first:
  - `control-plane/src/telegram/handler.js`
  - If matched, it creates a real `deviceCommand` and returns a queued-command message.
  - Claude is not called for desktop action intents.
- Local OpenClaw chat endpoint now checks the same intent first:
  - `POST /api/v1/local-agent/chat`
  - If matched, it queues the command for the current local device by default.
  - This lets installed local agents execute phrases like:
    - `открой YouTube`
    - `запусти любую песню`
    - `открой Chrome`
- Strengthened command targeting:
  - `createDeviceCommand` now rejects target agents that do not have both
    `command-polling` and the requested command capability.
  - This prevents commands from being silently queued to old heartbeat-only agents.
- Updated Claude system prompt:
  - Claude must not claim it sent/queued/executed local device commands.
  - Real desktop actions are handled by server code before Claude.

Files changed:

- `control-plane/src/domain/natural-device-actions.js`
- `control-plane/src/domain/device-agents.js`
- `control-plane/src/telegram/handler.js`
- `control-plane/src/api/router.js`
- `control-plane/src/assistant/company-assistant.js`
- `control-plane/test/natural-device-actions.test.js`
- `control-plane/test/device-agents.test.js`
- `control-plane/test/telegram.test.js`

Verification:

- Ran `npm test` locally in `control-plane`.
- Result:
  - 74 tests passed
  - 0 failed

Deployment:

- Uploaded changed runtime files to VPS `/opt/company-control-plane`:
  - `src/domain/natural-device-actions.js`
  - `src/domain/device-agents.js`
  - `src/telegram/handler.js`
  - `src/api/router.js`
  - `src/assistant/company-assistant.js`
- Uploaded updated tests:
  - `test/natural-device-actions.test.js`
  - `test/device-agents.test.js`
  - `test/telegram.test.js`
- Server targeted verification:
  - `node --test test/natural-device-actions.test.js test/device-agents.test.js test/telegram.test.js`
  - 24 passed, 0 failed
- Restarted services:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Post-restart status:
  - both services active
  - bot log: `telegram command menu synchronized (20 commands)`

Claude review checklist:

- Check whether YouTube/music should open a fixed playlist/video instead of
  YouTube search results.
- Consider adding an admin/device cleanup command to hide or retire old
  heartbeat-only agent records for users who re-registered multiple times.

## 2026-06-10 - Persistent assistant memory and structured follow-ups

User-reported problem:

- Agent memory was poor.
- Example 1:
  - user asked to open something on Mac
  - assistant said it was opening
  - user replied `не открылось`
  - assistant no longer remembered what needed to be opened
- Example 2:
  - Begayym created tasks for the day
  - she marked half as completed
  - later said she completed the remaining tasks
  - assistant forgot the first half and handled remaining progress incorrectly
- User also wants n8n to have a DB-backed memory.

Architecture found:

- n8n is deployed at `/opt/starlab-n8n`.
- n8n uses Postgres via docker-compose.
- control-plane is currently the real runtime for Telegram/local-agent chat.
- control-plane state is persisted in JSON at:
  - `/var/lib/company-control-plane/control-plane.json`
- Existing structured state:
  - `dailyWorkPlans`
  - `assistantCheckins`
  - `assistantNudges`
  - `deviceCommands`
  - audit/token usage/KPI snapshots
- Missing piece:
  - no durable conversation/action memory was included in Claude context.

Implemented now in control-plane:

- Added persistent assistant memory:
  - `control-plane/src/domain/assistant-memory.js`
  - state key: `assistantMemory`
  - max retained events: `10000`
- Memory records:
  - user free-form questions
  - assistant answers
  - natural device action requests/responses
  - local-agent chat action requests/responses
  - daily remaining-task updates
  - targets such as `userId`, `deviceId`, `commandId`, project ids
- Claude context now includes:
  - `context.memory`
  - `context.recentDeviceCommands`
- Updated prompt:
  - use memory for follow-up phrases like `не открылось`, `то же самое`, `оставшиеся`
  - use recent device command state to understand queued/claimed/succeeded/failed/expired actions

Structured follow-up handling:

- `не открылось`, `не сработало`, etc:
  - server finds the actor's latest relevant device command within 60 minutes
  - retries the same command on the same device with the same args
  - records the retry in memory
- `сделала оставшиеся задачи`, `выполнила все остальные`, etc:
  - server reads today's `dailyWorkPlans`
  - preserves already done items
  - marks only currently open items as done
  - records the update in memory
  - returns full checklist with `[x]` statuses

Files changed:

- `control-plane/src/domain/assistant-memory.js`
- `control-plane/src/domain/natural-device-actions.js`
- `control-plane/src/domain/daily-assistant.js`
- `control-plane/src/assistant/company-assistant.js`
- `control-plane/src/telegram/handler.js`
- `control-plane/src/api/router.js`
- `control-plane/src/infra/seed.js`
- `control-plane/test/natural-device-actions.test.js`
- `control-plane/test/telegram.test.js`

Verification:

- Ran `npm test` locally in `control-plane`.
- Result:
  - 76 tests passed
  - 0 failed

Deployment:

- Uploaded changed runtime files to VPS `/opt/company-control-plane`:
  - `src/domain/assistant-memory.js`
  - `src/domain/natural-device-actions.js`
  - `src/domain/daily-assistant.js`
  - `src/assistant/company-assistant.js`
  - `src/telegram/handler.js`
  - `src/api/router.js`
  - `src/infra/seed.js`
- Uploaded updated tests:
  - `test/natural-device-actions.test.js`
  - `test/daily-assistant.test.js`
  - `test/telegram.test.js`
- Server targeted verification:
  - `node --test test/natural-device-actions.test.js test/daily-assistant.test.js test/telegram.test.js`
  - 23 passed, 0 failed
- Restarted services:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Post-restart status:
  - both services active
  - bot log: `telegram command menu synchronized (20 commands)`

Important note for n8n:

- The memory is implemented in control-plane first because this is where Telegram
  and local-agent chat currently execute.
- n8n already has Postgres. A next step can expose memory through control-plane
  API or mirror `assistantMemory` into n8n Postgres tables.
- Recommended later Postgres tables:
  - `agent_memory_events`
  - `agent_action_events`
  - `daily_plan_events`
  - `conversation_summaries`

## 2026-06-10 - YouTube music playback device action

User problem:

- Telegram request like `open Chrome on Mac and play XXXTENTACION - Moonlight` opened Chrome/YouTube but did not start the song.
- Root cause: control-plane parsed YouTube/music requests as plain `open_url`; local agents had no dedicated command that tried to search and press play.

Implemented:

- Added new device command type: `play_youtube`.
- Updated natural language parser:
  - generic request like `open youtube and play any song` still falls back to `open_url` music search
  - specific request like `open Chrome and play song XXXTENTACION - Moonlight` becomes `play_youtube` with `args.query = "XXXTENTACION - Moonlight"`
- Added compatibility fallback for older installed local agents:
  - if target device supports `play_youtube`, queue `play_youtube`
  - if target device only supports `open_url`, queue exact YouTube search URL instead of failing
- Added `/device` command support:
  - `/device maksat play_youtube XXXTENTACION - Moonlight`
  - aliases: `youtube`, `song`, `music`
- Updated macOS Starlab OpenClaw local agent source:
  - advertises `play_youtube`
  - opens Chrome with exact YouTube search query
  - best-effort keyboard automation: waits briefly, tabs to first result, presses Enter
- Updated Windows Starlab OpenClaw local agent source similarly:
  - advertises `play_youtube`
  - opens exact YouTube search query
  - best-effort SendKeys automation to press first result

Files changed:

- `control-plane/src/domain/device-agents.js`
- `control-plane/src/domain/natural-device-actions.js`
- `control-plane/src/telegram/handler.js`
- `control-plane/test/natural-device-actions.test.js`
- `openclaw-starlab-2026.6.5/apps/macos/Sources/OpenClaw/StarlabAgentClient.swift`
- `openclaw-starlab-2026.6.5/apps/macos/Sources/OpenClaw/StarlabDeviceCommandExecutor.swift`
- `openclaw-starlab-2026.6.5/apps/windows/src/main.cjs`

Verification:

- Local `control-plane` test run: `npm test`
- Result: 79 tests passed, 0 failed
- Server targeted test run: `node --test test/natural-device-actions.test.js`
- Result: 6 tests passed, 0 failed

Deployment:

- Uploaded updated server runtime files to `/opt/company-control-plane` on VPS:
  - `src/domain/device-agents.js`
  - `src/domain/natural-device-actions.js`
  - `src/telegram/handler.js`
  - `test/natural-device-actions.test.js`
- Created backups with suffix `.bak-play-youtube-20260610` before replacing files.
- Restarted:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`
- Post-restart status:
  - both services active

Important remaining item:

- The currently installed Mac/Windows local OpenClaw apps will not fully execute `play_youtube` until rebuilt and reinstalled, because capabilities are advertised by the installed app during heartbeat.
- Until reinstall, server fallback prevents breakage and opens exact YouTube search URL.
- For true human-like web control beyond this best-effort command, next implementation should connect the original OpenClaw computer-use/runtime loop behind `openclaw_prompt` so the agent can visually inspect pages, click, recover from layout changes, and continue multi-step tasks.

## 2026-06-11 - План следующего этапа Starlab Assistant

По запросу пользователя подготовлен архитектурный план без изменения runtime-кода.

Документ:
- `STARLAB_ASSISTANT_IMPLEMENTATION_PLAN_RU.md`

В план включены:
- ограниченный developer recovery для Telegram ID 984834133;
- автозапуск Windows/macOS;
- подписанное автообновление через electron-updater и Sparkle;
- завершение Telegram voice и добавление voice в локальные агенты;
- draft/confirm запись задач в YouGile и Google Calendar;
- утренний план, вечерний отчет, meeting brief и weekly trends;
- перенос production-памяти в PostgreSQL;
- визуальные n8n workflows;
- риски регрессий и решения, которые нужно утвердить.

Безопасность:
- ElevenLabs API key был опубликован в чате и должен быть отозван до внедрения.
- Новый key должен храниться только через encrypted `/setup`.

На этом шаге код, сервер и устройства не изменялись: пользователь попросил сначала обсудить и утвердить план.

## 2026-06-11 - Утвержденные решения по следующему этапу

Обновлен `STARLAB_ASSISTANT_IMPLEMENTATION_PLAN_RU.md`.

Утверждено:
- YouGile дополняет Platrum и Bitrix, существующие команды не удаляются.
- Утренний план: через 10 минут после вычисленного начала работы.
- Вечерний отчет: за 20 минут до вычисленного окончания работы.
- Рабочее окно определяется Schedule Resolver по Platrum и рабочим Google Calendar; LLM не придумывает время.
- Создание и редактирование задач/событий разрешены только через draft + confirm + version check.
- Удаление пока запрещено.
- ElevenLabs Voice ID: `dxhwlBCxCrnzRlP4wDeE`.
- Apple Developer Account и Windows code-signing certificate отсутствуют.

Защита существующего production:
- additive DB migrations only;
- feature flags выключены по умолчанию;
- shadow mode;
- pilot order: developer -> Maksat -> one PM -> all;
- старые `/platrum`, `/bitrix`, Telegram/Google/device routes не удаляются;
- rollback через feature flag;
- updater без сертификатов сначала только уведомляет/скачивает, установка подтверждается пользователем;
- старые workflows выключаются только после smoke-теста новых;
- backups и release version перед каждым rollout.

На этом шаге runtime-код и production не изменялись: обновлен только утверждаемый план.

## 2026-06-11 - Реализация динамического ассистента, voice, YouGile stub и desktop updates

Запрос пользователя:

- учитывать индивидуальный график сотрудников с понедельника по пятницу и рабочую
  субботу для отдельных сотрудников;
- брать график сначала из Platrum, затем из Google Calendar;
- если оба источника пустые, уведомлять только developer Telegram ID `984834133`;
- подготовить YouGile, но оставить интеграцию выключенной;
- включить прием Telegram voice и голосовой ответ по запросу;
- добавить developer recovery регистрационного кода Николая;
- включить автозапуск и проверку обновлений desktop-агентов;
- вынести расписание в понятный визуальный n8n workflow;
- не ломать существующий production.

### Dynamic Work Schedule Resolver

Добавлен `control-plane/src/domain/work-schedule.js`.

Поведение:

- Platrum является первичным источником утвержденного недельного графика.
- Google Calendar является fallback-источником.
- Для Google проверяются:
  - подключенный аккаунт самого сотрудника;
  - подключенные аккаунты менеджеров;
  - shared calendars с совпадающим именем сотрудника;
  - primary calendar целевого сотрудника.
- Расписание определяется отдельно для каждого дня недели.
- Понедельник-пятница поддерживаются всегда.
- Суббота считается рабочей только при наличии явного графика.
- Воскресенье всегда выходной и не вызывает уведомление об отсутствующем графике.
- Утренний черновик отправляется через 10 минут после начала смены.
- Вечерний отчет запрашивается за 20 минут до конца смены.
- Если после 07:00 график отсутствует и в Platrum, и в Google Calendar,
  уведомление один раз в день получает только Telegram ID `984834133`.
- Время не придумывается LLM.
- В state сохраняются дневные snapshots `workScheduleDaily`.

Изменены:

- `control-plane/src/connectors/platrum-client.js`
- `control-plane/src/domain/work-schedule.js`
- `control-plane/src/telegram/daily-assistant-reporter.js`
- `control-plane/src/telegram-bot.js`
- `control-plane/src/infra/seed.js`

### Developer recovery для Николая

Добавлена скрытая команда `/reset_owner_code`.

Безопасность:

- команда доступна только Telegram ID из `DEVELOPER_TELEGRAM_IDS`;
- значение по умолчанию: `984834133`;
- требуется двухшаговое подтверждение:
  - `/reset_owner_code`
  - `/reset_owner_code confirm <challenge>`
- challenge действует 5 минут;
- создается новый одноразовый код Николая на 24 часа;
- Telegram-привязка, память и устройства Николая не удаляются.

### YouGile

Добавлен `control-plane/src/connectors/yougile-client.js`.

Используется официальный API v2:

- Bearer JWT;
- `GET /api-v2/task-list`;
- `POST /api-v2/tasks`;
- `PUT /api-v2/tasks/{id}`.

Ограничения:

- `YOUGILE_ENABLED=false` по умолчанию;
- чтение при выключенном флаге возвращает пустой результат;
- запись требует явный `confirmed: true`;
- удаление через `deleted: true` запрещено всегда;
- API key сохраняется encrypted через `/setup`.

YouGile подготовлен в коде и интерфейсе, но production-интеграция намеренно
остается выключенной до выдачи credentials.

### Telegram Voice

Настроено:

- ElevenLabs STT `scribe_v2`;
- ElevenLabs TTS `eleven_multilingual_v2`;
- Voice ID сохранен через `/setup`;
- API key сохранен только в encrypted secret store;
- reply mode: `on_request`;
- голосовые сообщения Telegram транскрибируются и передаются обычному ассистенту;
- текстовые запросы с формулировками `голосом`, `аудио`, `voice` получают
  текстовый и голосовой ответ;
- voice marker больше не воспринимается как имя сотрудника в slash-командах.

Production smoke test:

- TTS успешно вернул MP3, `41004` bytes;
- STT успешно обработал этот MP3;
- оба production clients отмечены как configured;
- synthetic round-trip transcription была неточной, поэтому качество на живом
  русском голосовом нужно дополнительно проверить в Telegram.

Секрет ElevenLabs в этот файл не записывался.

### Desktop autostart и update manifest

Windows:

- версия поднята до `2026.6.6`;
- автозапуск включен через Electron login item;
- каждые 6 часов проверяется `/downloads/releases.json`;
- обновление скачивается во внутреннюю папку приложения;
- перед установкой проверяется SHA-256;
- после подтверждения запускается проверенный NSIS installer с `/S`;
- собран production EXE:
  - `control-plane/public/downloads/starlab-openclaw-agent-windows.exe`
  - size: `81691906`
  - SHA-256:
    `1bd850f79ab5214f03967516277d090a8e2935d8b8fe7a3bcadd8df1b04fca82`

macOS:

- source version поднята до `2026.6.6`;
- после activation включается Launch at Login;
- manifest проверяется каждые 6 часов;
- доступное обновление показывается в приложении;
- кнопка открывает DMG для установки;
- новый DMG не собран, так как Mac Максата по `192.168.88.42` недоступен
  по SSH (connection timeout);
- текущий публичный DMG остается `2026.6.5`.

Добавлен manifest:

- `control-plane/public/downloads/releases.json`

### n8n

Добавлен визуальный workflow:

- `n8n/starlab-daily-assistant.workflow.json`
- ID: `starlabDailyAssistant01`
- name: `Starlab - Daily Assistant Schedule`

Дерево:

- `Every 5 Minutes`
- `Resolve Platrum + Google Schedule`
- `Messages Sent?`
- `Record Sent Result`
- `Nothing Due`
- sticky notes с описанием scheduling и выключенного YouGile.

Workflow использует обычные Schedule Trigger, HTTP Request, IF и Set nodes.
Большого Code/JS node в этом workflow нет.

Защищенный endpoint:

- `POST /api/v1/automation/daily-assistant/run`
- header: `X-Automation-Token`
- отдельный случайный automation token создан на VPS;
- token не записывался в git/worklog;
- тот же token передан control-plane через systemd override и n8n через `.env`.

Deployment:

- workflow импортирован и опубликован;
- после restart n8n log подтверждает:
  `Activated workflow "Starlab - Daily Assistant Schedule"`;
- вызов из n8n container в control-plane вернул HTTP 200 и `{sent: 0}`;
- `sent: 0` означает, что на момент smoke test ни один prompt не попадал
  в свое временное окно.

Во время пересоздания контейнера старый `docker-compose 1.29.2` получил
`KeyError: ContainerConfig` из-за несовместимости с новым image metadata.
Контейнер был безопасно удален и создан заново на существующих named volumes.
PostgreSQL и n8n data не потеряны.

### Production deployment

VPS:

- `/opt/company-control-plane`
- backup:
  `/opt/company-control-plane/.deploy-backups/20260611-105636`

В production загружены:

- обновленный `control-plane/src`;
- Windows EXE;
- `releases.json`;
- n8n workflow.

Настроено:

- encrypted ElevenLabs credentials;
- voice enabled;
- YouGile disabled;
- automation token;
- корректный ownership runtime/public файлов.

Перезапущены и активны:

- `company-control-plane-api.service`
- `company-control-plane-telegram-bot.service`
- `starlab-n8n_n8n_1`

Публичная проверка:

- `https://starlabagent.pp.ua/download` открывается;
- Windows download link присутствует;
- `/downloads/releases.json` возвращает Windows version `2026.6.6`;
- Windows EXE возвращает:
  - HTTP 200
  - `Content-Length: 81691906`
  - `Content-Type: application/vnd.microsoft.portable-executable`.

Примечание:

- root `/health` сейчас обслуживается n8n из-за существующей nginx routing
  конфигурации;
- внутренний control-plane endpoint и защищенный automation endpoint работают;
- routing `/health` не менялся, потому что это не требовалось для функций
  ассистента и могло затронуть существующий n8n frontend.

### Verification

Локально:

- `npm test`
- result: `91 passed, 0 failed`
- `git diff --check`
- whitespace errors: none; только существующие CRLF warnings.

Новые/обновленные tests покрывают:

- Platrum weekly schedule normalization;
- индивидуальный weekday schedule;
- shared Google Calendar fallback;
- morning start + 10 minutes;
- missing schedule developer-only alert;
- Sunday behavior;
- YouGile disabled/read/write/delete guards;
- developer owner recovery;
- Telegram voice receive/reply;
- voice marker parsing;
- desktop device actions.

### Что остается

- собрать `2026.6.6` DMG на доступном Mac с Xcode;
- проверить живое русское voice message в Telegram и при необходимости
  настроить голос/модель/язык;
- подключить YouGile credentials и только после отдельного smoke test включить
  `YOUGILE_ENABLED=true`;
- code signing отсутствует и для Windows, и для macOS, поэтому updater сохраняет
  SHA-256 verification и требует пользовательское подтверждение установки.

## 2026-06-11 - Google OAuth disabled_client investigation

User reported Google authorization screen:

- `Access blocked: authorization error`
- `The OAuth client was disabled`
- `Error 401: disabled_client`

Production config checked on VPS without printing client secret.

Current stored Google OAuth client:

- type: `web`
- project_id: `spry-acolyte-498414-r6`
- client_id suffix: `q5ha6fg.apps.googleusercontent.com`
- redirect URI:
  `https://starlabagent.pp.ua/api/v1/google/oauth/callback`
- JavaScript origin:
  `https://starlabagent.pp.ua`

Connected Google users in encrypted store:

- `u-nikolay` -> `openclawstarlab@gmail.com`
- `u-maksat` -> Maksat Google account
- `u-pm-1` -> `starlabpm@gmail.com`

Smoke test result:

- Existing refresh tokens also fail.
- Google token refresh returns:
  - HTTP `401`
  - error `disabled_client`
  - description `The OAuth client was disabled.`

Conclusion:

- This is not a redirect URI or server-code problem.
- The Google Cloud OAuth Client itself is disabled inside Google Cloud project
  `spry-acolyte-498414-r6`.
- The OAuth client JSON does not store the creator/owner Google account, so the
  exact Cloud Console owner cannot be proven from server files alone.
- The strongest clue is that Nikolay was connected through
  `openclawstarlab@gmail.com`, and n8n owner was also created with that email,
  but this does not prove the Google Cloud project was created by that account.

Recommended fix:

1. Try to recover/unblock the Google account that owns project
   `spry-acolyte-498414-r6`.
2. In Google Cloud Console, select project `spry-acolyte-498414-r6`, open
   Google Auth Platform / Clients, and re-enable the web OAuth client ending
   `q5ha6fg.apps.googleusercontent.com`.
3. If project owner cannot be recovered, create a new Google Cloud project and
   OAuth Web Client from a stable admin Google account, add the same redirect
   URI, upload the new JSON in `/setup`, then have employees run
   `/google_connect` again.

No runtime code was changed for this investigation.

## 2026-06-11 - Google OAuth branding pages for verification

User opened Google Auth Platform / Branding and wanted to fill App Domain
fields correctly to avoid future OAuth problems.

Problem found:

- `https://starlabagent.pp.ua/download` existed and returned 200.
- `https://starlabagent.pp.ua/privacy` returned 404.
- `https://starlabagent.pp.ua/terms` returned 404.

Implemented:

- Added public `renderPrivacyPage`.
- Added public `renderTermsPage`.
- Added links to privacy and terms from `/download`.
- Added router endpoints:
  - `GET /privacy`
  - `GET /terms`
- Updated Nginx routing for both HTTP and HTTPS server blocks so `/privacy`
  and `/terms` proxy to control-plane instead of n8n.

Files changed:

- `control-plane/src/setup/download-page.js`
- `control-plane/src/api/router.js`
- server Nginx config `/etc/nginx/sites-enabled/starlabagent.pp.ua`

Verification:

- `npm test` in `control-plane`: 93 passed, 0 failed.
- `node --check src/setup/download-page.js`
- `node --check src/api/router.js`
- `git diff --check` for changed local files: no issues.
- Public HTTP checks:
  - `/download` -> 200
  - `/privacy` -> 200
  - `/terms` -> 200
- `/privacy` includes explicit Google API Services User Data Policy / Limited
  Use statement.

Google Console fields to use:

- Application home page:
  `https://starlabagent.pp.ua/download`
- Privacy policy:
  `https://starlabagent.pp.ua/privacy`
- Terms of service:
  `https://starlabagent.pp.ua/terms`
- Authorized domain:
  `starlabagent.pp.ua`

Note:

- Nginx reports existing duplicate server_name warnings during `nginx -t`.
  Syntax is OK and reload succeeded. This was pre-existing routing duplication
  and was not changed in this step beyond adding the two new public paths.

## 2026-06-11 - Google OAuth client JSON replacement

Request:

- Replace the Google OAuth client JSON in `/setup` with the newly downloaded
  Google Cloud OAuth client file from the local Downloads folder.

Actions:

- Validated the local JSON file shape without logging secrets.
- Opened a temporary SSH tunnel to the server-local control-plane API on
  `127.0.0.1:3099`.
- Saved the new Google OAuth client JSON through
  `POST /api/v1/setup/services`.
- Closed the temporary SSH tunnel after the save completed.

Verification:

- Setup API returned `Saved: True`.
- `/api/v1/setup/status` returned `GoogleOAuthJsonSaved: True`.
- The uploaded OAuth client JSON contains the expected redirect URI:
  `https://starlabagent.pp.ua/api/v1/google/oauth/callback`.

Notes:

- The JSON content and client secret were intentionally not written into this
  worklog.
- Existing Google refresh tokens from the disabled OAuth client will still need
  users to reconnect through `/google_connect`.

## 2026-06-11 - Metricon integration repair and runtime mapping

Request:

- Investigate why Metricon data is visible in the Metricon admin UI but not in
  the AI agent reports.
- Make the integration more reliable because Metricon is already running on
  several employee computers.

Findings:

- The server had Metricon configured, but the stored refresh token failed with
  `REFRESH_TOKEN_REUSE_DETECTED`.
- The existing connector called an old placeholder endpoint:
  `GET /api/v1/activity/report`.
- The live Metricon Swagger and direct API checks show the real activity report
  endpoint is:
  `POST /api/v1/reports/activity`.
- The control-plane user mappings still used mock Metricon employee IDs `1..5`.
  Real Metricon employee IDs found through `employees/available` include:
  - Nikolay -> `74`
  - Begayym / Project Manager 1 -> `32`
- Maksat was not present as a Metricon employee in the API employee list returned
  by the provided Metricon account, so his old mock ID was cleared instead of
  inventing a mapping.

Code changes:

- Reworked `control-plane/src/connectors/kickidler-client.js`:
  - uses `POST /api/v1/reports/activity`;
  - normalizes `totalActiveTime`, `totalIdleTime`, app/web time, employee name,
    and top applications;
  - returns per-employee errors instead of failing the entire report;
  - supports Metricon login/password fallback when refresh token is expired or
    rejected;
  - saves rotated access/refresh tokens through the existing setup callback.
- Extended setup secrets with:
  - `kickidlerUsername`
  - `kickidlerPassword`
- Updated `/setup` UI to accept Metricon service login/password.
- Updated API and Telegram runtime factories so Metricon secrets are reloaded
  from setup storage before creating a client, reducing stale-token reuse.
- Updated tests for the real Metricon activity endpoint and login fallback.

Server runtime changes:

- Saved Metricon service login/password and fresh access/refresh tokens through
  encrypted setup storage.
- Updated `/var/lib/company-control-plane/control-plane.json` Metricon mappings:
  - `u-nikolay`: `74`
  - `u-pm-1`: `32`
  - `u-maksat`: `null` until the real Metricon employee ID is known
  - `u-pm-2`: `null`
  - `u-pm-3`: `null`
- Created a server-side backup before changing runtime state:
  `/var/lib/company-control-plane/control-plane.json.metricon-backup-1781170994120`
- Fixed file ownership after runtime state was written from root:
  `company-control-plane:company-control-plane`.
- Restarted:
  - `company-control-plane-api.service`
  - `company-control-plane-telegram-bot.service`

Verification:

- Local `npm test`: 95 passed, 0 failed.
- Server `npm test`: 66 passed, 0 failed.
- Server services are active.
- Direct Metricon API check for Begayym ID `32` returned real activity data.
- Control-plane API check through
  `POST /api/v1/reports/metricon/activity-summary` with Nikolay as actor returned:
  - Nikolay / Metricon ID `74`: active and idle seconds present.
  - Project Manager 1 / Metricon ID `32`: active and idle seconds present.

Remaining follow-up:

- Need the real Metricon employee IDs for Maksat, PM2 and PM3 if they should
  appear in Metricon reports. The provided Metricon account currently did not
  return a `Maksat` employee record in the available/company employee list.

## 2026-06-12 - Full Russian handoff document for new developer

Request:

- Create a local full project handoff document in `C:\Users\dasmu`.
- The document should explain the project structure, how to access the server,
  how the current product works, what it is built on, the overall goal, and all
  important context for a new employee who knows nothing about the project.

Created:

- `C:\Users\dasmu\STARLAB_AGENT_FULL_HANDOFF_RU.md`

Contents:

- Product goal and role hierarchy.
- Local repository/folder structure.
- `control-plane` module structure.
- Server access commands and host key.
- systemd services, runtime state paths and ownership notes.
- `/setup` usage through SSH tunnel.
- n8n Docker deployment paths and containers.
- Telegram bot commands and flow.
- Claude, Google OAuth, Metricon, Platrum, Bitrix, YouGile and ElevenLabs notes.
- Local OpenClaw/device-agent architecture.
- Deployment commands and health checks.
- Known problems, fixes and remaining technical debt.

Security note:

- Plaintext passwords/API keys were intentionally not copied into the handoff
  document. The file explains where secrets live and how to update them, but
  credentials should be issued separately through the owner/password manager.

## 2026-06-12 - Memory v2 + Telegram render layer (Claude multi-agent orchestration)

### User Request

Strengthen assistant memory so each employee's assistant remembers everything
(open follow-ups, long-term facts), and fix ugly unstructured Telegram answers
with raw Markdown garbage. Also apply previously proposed fixes. Work done on
Nikolay's PC (`C:\Users\dasmu\openclawagent`, branch `server`), via Claude Code
orchestration: Architect (Fable 5) -> expert (Opus) -> developer (Sonnet).

### Implemented - Memory v2

- Cross-process file lock in `src/infra/json-store.js` (`<file>.lock`, `wx`
  create, backoff, 5s timeout, 30s stale reap) - fixes API/bot write race.
- New `src/domain/assistant-open-loops.js` - open follow-ups (command_follow_up,
  promise, question, task_progress) with open/resolve/expire lifecycle; failed
  device commands auto-open a loop in router, successful retry resolves it.
- New `src/domain/assistant-facts.js` - long-term per-user facts with dedup,
  supersede, cap 200 active per user.
- New `src/assistant/memory-distiller.js` - after each free-form answer, Claude
  (`CLAUDE_MEMORY_MODEL`, default `claude-haiku-4-5-20251001`) extracts facts /
  resolves loops from the exchange; fully fail-safe; usage recorded as
  `assistant.memory.distill`.
- New `src/domain/assistant-summaries.js` - daily per-user summaries
  (yesterday, Asia/Bishkek), generated in bot loop, cap 30 per user.
- New `src/infra/memory-archive.js` - per-user JSONL archive next to data file;
  journal cap changed from global 10000 to per-user 2000; evicted events are
  archived, nothing is lost; keyword search over archive tail.
- `buildAssistantMemoryContextV2` - context = facts + open loops + last 3 daily
  summaries + recent events + keyword-relevant events (journal + archive),
  replaces "last 24 events" in `company-assistant`.
- `claude-client.js` `complete()` accepts optional per-call `model`.

### Implemented - Telegram render layer

- New `src/telegram/render.js`: typed blocks -> Telegram HTML, limited
  Markdown -> HTML converter (always balanced tags), `splitTelegramMessage`
  (4096 limit, paragraph/line boundaries, tag-safe splits), `sendLongMessage`.
- `company-assistant` system prompt now requires strict JSON answer
  ({title, sections, next_steps}); parsed defensively, rendered via blocks;
  fallback Markdown->HTML. Returns `{html, plainText}`; plainText goes to
  memory/distiller/TTS, html to Telegram - raw `**`/`###` garbage eliminated.
- Long reports (`/report`, `/platrum`, `/bitrix`, `/daily_report`, assistant
  answers) sent via `sendLongMessage`.
- Bot loop: per-update try/catch isolation (`processTelegramUpdate` in
  handler.js), offset always advances, poison message cannot stall the queue,
  user gets a short error notice.
- Architect review fix: device-agent chat endpoint
  (`POST .../device-agents/...` in router.js) kept returning a string `answer`
  (plainText) for backward compatibility with `device-agent.js` and
  `desktop-agent/main.cjs`; `answerHtml` added alongside.

### Verification

- Local `npm test`: **149 passed, 0 failed** (baseline was 95; +32 memory
  tests, +22 render/loop tests).
- `git diff --check`: clean. `node --check` on all changed files.
- Node.js v24.16.0 installed on this PC (was missing).

### Not Done / Next

- Deployed to production on 2026-06-12 (see next section).
- `CLAUDE_MEMORY_MODEL` env var optional; default haiku is fine.
- Distillation adds a post-answer Haiku call per free-form message; if API is
  slow, consider full fire-and-forget later.
- No git commits made; everything is in the working tree for review.

## 2026-06-12 - Production deployment of Memory v2 + render layer

### Deployed

- Server: starlabopenclaw-1 (195.238.122.228), /opt/company-control-plane.
- Backup before deploy:
  - /opt/company-control-plane/.deploy-backups/20260612-142335 (src + test)
  - /var/lib/company-control-plane/control-plane.json.memory-v2-backup-20260612-142335
- Copied full `control-plane/src` and `control-plane/test` via pscp
  (test suites are now in sync: server had 15 test files, now 22).
- Ownership fixed: company-control-plane:company-control-plane.

### Verification

- Server `npm test`: 149 passed, 0 failed (server Node v22.22.3).
- Restarted both systemd services; both `active`.
- `GET /health` on 127.0.0.1:3099: ok.
- Startup logs clean: metricon/platrum/bitrix connectors configured,
  telegram polling started, 20 commands synchronized.
- 3-minute journal scan after restart: no errors/warnings.
- `control-plane.json.lock` observed transiently and released correctly;
  state file is being written by the bot loop as expected.

### Pending live checks (need a real Telegram user)

- Free-form question: answer must be structured HTML without raw `**`/`###`.
- Long `/report` or `/platrum`: must arrive split into parts, not fail.
- Voice reply: TTS must read plain text without HTML tags.
- Next day: `assistantDailySummaries` and `assistantFacts` should appear in
  runtime state for active users.

### Security note

- Server root password was shared in chat during this deployment. Recommend
  rotating it and/or switching to SSH key auth. Password is not recorded in
  this worklog or anywhere in the repository.

## 2026-06-12 - Hotfix: raw JSON leaked to Telegram user

### Problem (reported by user with screenshot)

Free-form assistant answer arrived in Telegram as raw JSON text, cut off
mid-string. Root cause chain:

1. `claudeClient.complete()` was called without `maxTokens`, so the default
   `900` applied; a rich structured answer did not fit and was truncated by
   the token limit mid-JSON.
2. Truncated JSON failed `JSON.parse`, and the fallback path sent the raw
   model output (the broken JSON) to the user as plain text.

### Fix (control-plane/src/assistant/company-assistant.js, claude-client.js)

- Assistant answers now request `maxTokens: 3000`.
- `claude-client` returns `stopReason` (`payload.stop_reason`); when it is
  `max_tokens`, the rendered answer gets a visible note that it was shortened.
- `parseStructuredAnswer` now repairs truncated JSON: closes an unterminated
  string, drops dangling `,`/`:` separators or a dangling key, closes all open
  brackets, and tries progressively more aggressive candidates.
- Hard guarantee: if text looks like structured JSON but cannot be parsed even
  after repair, readable string values are salvaged and sent as plain lines;
  raw JSON syntax can never reach the user anymore.

### Verification

- Local `npm test`: 155 passed, 0 failed (+6 salvage/repair tests in
  `test/assistant-answer-salvage.test.js`).
- Server `npm test`: 155 passed, 0 failed.
- Both services restarted and active; /health ok; bot polling started.

## 2026-06-12 - Sprint: attribution bugfix + production hardening pack

### Bug: Maksat's Platrum task attributed to Begayym (user-reported)

Root causes found and fixed in three layers:

1. Prompt: system prompt now forbids attributing tasks with another
   assignee; personal stats/efficiency only from tasks where the target
   user is the assignee (`company-assistant.js`).
2. Data, /platrum report: `buildPlatrumUserStatusReport` computed employee
   KPI from `combinedTasks` = user tasks + ALL project board tasks.
   Now project tasks are filtered by assignee match (platrumUserId or
   platrumUsername) before combining (`platrum-reports.js`,
   `taskAssignedToUser` exported).
3. Data, daily assistant: `calculateDailyMetrics` merged all project tasks
   into personal daily metrics. Now filtered via `taskBelongsToUser`
   (platrum assigneeId/assigneeUsername or bitrix responsibleId)
   (`daily-assistant.js`).
Also: Platrum task `raw` payload no longer sent into Claude context
(token bloat). `tasksScope: "all_project_members"` marks project task lists.
Regression tests added (platrum.test.js, daily-assistant.test.js updated).

### Production checks performed

- Production mappings verified: u-pm-1 platrum 18/beks, u-maksat 23/max -
  mappings were correct; bug was attribution logic.
- Memory v2 confirmed accumulating in production (facts: 6, open loops: 4,
  daily summaries: 2 at check time).
- Metricon employees list pulled live: Maksat is STILL absent in Metricon -
  cannot map without inventing data. PM candidates present in Metricon:
  29 (Айзирек пм), 39 (Жибек), 75 (aizirek1@), 76 (Перизат) - business
  decision needed for u-pm-2/u-pm-3 mapping.
- Live Google token validation: u-nikolay and u-maksat REFRESH_FAILED
  (tokens from the disabled OAuth client) - both must redo /google_connect;
  u-pm-1 and u-pm-2 are live; u-pm-3 never connected.

### Infrastructure pack (developer agent, reviewed)

- `src/domain/integration-health.js` + `GET /api/v1/health/integrations`
  (automation token or OWNER actor) + `/status` Telegram command (OWNER).
  Live check on production: all 7 integrations ok.
- Internal API token (opt-in): `INTERNAL_API_TOKEN` env + `X-Internal-Token`
  header for `/api/v1/*` with exemptions for device/automation/setup/oauth/
  local-agent paths. Architect review added the missing `/api/v1/local-agent/`
  exemption (publicly proxied desktop-agent chat would have broken).
  Enabled on production; verified 401 without header, 200 with.
- CI: `.github/workflows/control-plane-tests.yml` (npm test on push/PR).
- `scripts/deploy-to-server.ps1` - one-command deploy with backup/rollback.
- `scripts/linux/backup-runtime.sh` + `install-backup-timer.sh`: daily
  03:30 UTC systemd timer, 14 archives retention. Installed on production;
  first backup created.

### Server/ops changes

- SSH key auth set up (ed25519, `~/.ssh/starlab_server` on Nikolay's PC);
  password no longer used in commands. Recommend rotating root password.
- n8n duplicate Telegram workflow `starlabTelegramMvp01` deactivated
  (control-plane bot is the single Telegram owner). Schedules
  (`starlabDailyAssistant01`) and heartbeat mirror remain active.
- Nginx: public `/health` now routed to control-plane (was n8n);
  config backup kept; nginx -t + reload verified; other public pages 200.

### Verification

- Local and server `npm test`: **165 passed, 0 failed**.
- Services + backup timer active, `/health` ok, integrations health all ok.

### Deferred (explicitly, with reasons)

- PostgreSQL migration: deferred from this 2-day sprint; cross-process
  file lock covers the race for current load. Plan next.
- kickidler->metricon rename and handler/router refactor: deferred as
  non-blocking code-quality work.

### Needs user/business action

1. Nikolay and Maksat: re-run /google_connect in Telegram.
2. Decide Metricon mapping for u-pm-2/u-pm-3; add Maksat to Metricon if
   his activity should be tracked.
3. Rotate server root password (SSH key now available).

## 2026-06-12 - Auto-resolve employee mappings (Perizat case)

### Problem (user-reported)

Perizat (last PM) registered via Telegram; the assistant told her a manager
must add her to Platrum and Bitrix, although she exists in both (30 tasks in
her Bitrix kanban). Cause: control-plane user u-pm-3 had placeholder
displayName "Project Manager 3" and null platrum/bitrix/metricon mappings;
connectors bail out when the mapping is missing.

### Production data fix (immediate)

State backup `control-plane.json.pm3-fix-backup-*`, then u-pm-3 set to:
displayName "Перизат Усенкулова", platrumUserId 19 (jesus), bitrixUserId 15,
kickidlerEmployeeId 76 - all resolved live through the company-wide service
accounts. Verified: Platrum returns 1 task, Bitrix returns 30 tasks.

### Systemic fix (code)

- `bitrix-client.js`: new `resolveBitrixUser` - when bitrixUserId is
  missing, searches the company directory via `user.search` (admin webhook,
  read-only allowlist) by display/telegram name; only unambiguous (single)
  matches are used; `getUserTasks` now resolves instead of bailing.
- `platrum-client.js`: candidate tokens now include telegram
  firstName/lastName; matching upgraded to word-level
  (`userTokenMatchesValue`, "Перизат" matches "Усенкулова Перизат") with an
  ambiguity guard (multiple matches -> null, never guess).
- `kickidler-client.js`: new `listEmployees()` (GET employees/available).
- New `src/domain/external-mapping.js`: `autoResolveUserMappings` resolves
  Platrum + Bitrix + Metricon IDs by name and persists them (audit event
  `user.mapping.autoresolved`); network calls run outside the state lock;
  existing mappings never overwritten; placeholder names skipped.
- `/register` flow: stores telegram first/last name, replaces placeholder
  displayName with the real name, then auto-resolves all three systems and
  tells the user which systems were found.
- Lazy healing: `buildPlatrumUserStatusReport` and the assistant context
  persist IDs discovered on the fly, so legacy users heal on first use.
- USER_ALIASES: "перизат"/"perizat"/"усенкулова" for u-pm-3.

### Verification

- Local and server `npm test`: **171 passed, 0 failed** (+6 new tests:
  token matching, metricon matcher ambiguity, autoResolve persist/fault
  tolerance, bitrix name resolution, register name storage).
- Services restarted, active, /health ok, journal clean.
- Bitrix test "skips lookup when mapping missing" updated: placeholder
  names produce no search tokens (no network); real names auto-resolve.

## 2026-06-12 - u-pm-2 mapped to Aizirek

User confirmed PM2 = Aizirek. Production state updated (backup
`control-plane.json.pm2-fix-backup-*`):

- displayName: "Айзирек Аликенова" (normalized whitespace from Bitrix)
- platrumUserId 9 (aisyy), bitrixUserId 101
- kickidlerEmployeeId 29 ("Айзирек пм"): of the two Metricon candidate
  records, 29 reported real activity over the last 7 days (~4.2h active),
  while 75 ("aizirek1@gmail.com") reported zero - 75 looks like an unused
  duplicate.

Verified live: Platrum 1 task, Bitrix 1 task (ДТМ, completed) flow for her.
Audit event `user.mapping.manual_fix` recorded. No code changes.

## 2026-06-12 - Hotfix: "This operation was aborted" on long summaries

### Problem (user-reported)

Free-form summary request for an employee returned "Ошибка / This operation
was aborted". Server journal also showed
"JsonStore: failed to acquire lock within 5000ms".

Two root causes:

1. Claude client timeout stayed at 30s while answers now request
   maxTokens 3000 - long structured summaries get aborted mid-generation.
2. Bot loop ran reporters (daily assistant / token usage / memory
   summaries) on EVERY poll iteration; some legacy mutators do network
   reads inside store.update, holding the cross-process file lock for many
   seconds and starving user-triggered writes (5s acquire timeout).

### Fix

- Claude timeout: 120s default, `CLAUDE_TIMEOUT_MS` override
  (claude-client.js factory).
- Lock tuning: acquire timeout 5s -> 25s, stale reap 30s -> 120s,
  env-overridable (`CONTROL_PLANE_LOCK_TIMEOUT_MS`,
  `CONTROL_PLANE_LOCK_STALE_MS`); stale-lock test updated accordingly.
- Bot loop throttle: reporters now run at most once per 60s
  (`BOT_REPORTERS_INTERVAL_MS`), not every iteration.
- Friendly Telegram error for abort/timeout instead of raw
  "This operation was aborted" (handler.js `isAbortLikeError`).

### Verification

- Local + server `npm test`: 171 passed, 0 failed. Services active.

### Known debt (next)

- Proper fix for lock holds: two-phase refactor so reports fetch network
  data BEFORE store.update and apply state changes in a short mutation
  (daily-assistant-reporter, platrum/bitrix report paths). Tracked for the
  Postgres migration milestone.

## 2026-06-12 - Desktop agent stages 2 & 3: tools + planner (Claude multi-agent)

Built in one sprint via orchestration: Architect (Fable 5) did stage 3 +
shared infra; an Opus sub-agent did stage 2 (executor) on isolated files.

### Stage 2 - cross-platform device executor ("hands")

- Server already had the command queue (create/claim/result) and capability
  gating; what was missing was a CLIENT that claims and runs commands.
  Before this, no client executed anything.
- New `src/agent-tools/executor.js` (zero-dep, node:* only):
  `supportedActionsForPlatform(platform)`, `executeAction({type,args,...})`.
- Action types expanded in `src/domain/device-agents.js` to 27, incl.
  run_script, notify, read_file/write_file, list_dir, search_files,
  make_dir, move_path, delete_path, media_control, set_volume, system_info.
  `SENSITIVE_DEVICE_ACTION_TYPES` + `isSensitiveDeviceAction()` added.
- Implementations: win32 via PowerShell, darwin via osascript+shell, linux
  best-effort (xdotool/wmctrl/xclip/scrot/notify-send). File ops via fs work
  everywhere. screenshot returns base64 (size-capped).
- Safety: sensitive actions require a confirmCallback. CLI honors
  `DEVICE_AGENT_ALLOW_SENSITIVE`; Electron pops a native confirm dialog so a
  human authorizes every dangerous action. exec timeouts, output caps,
  argument escaping.
- Clients now advertise real capabilities
  (`["heartbeat","command-polling",...supported]`) so the server queues only
  executable commands. CLI `device-agent.js` + Electron `main.cjs` both run a
  command-polling loop; desktop app shows an action log. Version 0.2.0.
- NOT implemented (needs native modules): mouse_click, ocr_screen ->
  report `unsupported`. set_volume on Windows is approximate.

### Stage 3 - server-side planner ("brain")

- `claude-client.js`: new `sendMessages()` (multi-turn + tool_use),
  `extractToolUseBlocks()`. Claude timeout already 120s.
- New `src/assistant/agent-loop.js`: `runAgentTask()` runs a tool-use loop -
  Claude plans, calls a device tool, the loop enqueues the command and waits
  (up to 90s) for the executor's real result, feeds it back, repeats until
  `finish_task`/end_turn/maxSteps. 21 tool schemas exposed (filtered by the
  target device's capabilities). `makeDeviceCommandRunner()` enqueues+waits;
  `resolveAgentTaskDevice()` picks the actor's device. Token usage + audit
  recorded; sensitive steps flagged.
- Endpoint `POST /api/v1/agent/task`; Telegram `/task <instruction>` with a
  per-step report (✅/🚫/⚠️/❌) and final summary.

### Verification

- Local + server `npm test`: 196 passed, 0 failed (+19 executor, +6 planner).
- Deployed; services active; /health ok; journal clean; `/api/v1/device-actions`
  returns 27 types in production.
- Desktop-agent (Electron) changes ride CI (build-desktop-agents.yml) to
  produce new signed-later 0.2.0 .exe/.dmg; server got control-plane only.

### How it works end to end

Employee (or manager) sends `/task собери все xlsx из Загрузок в архив`.
Server planner asks Claude, which calls search_files -> read results ->
make_dir/run_script (employee confirms on the desktop) -> notify. Each step
runs on the real machine through the command queue; progress streams to
Telegram.

## 2026-06-15 - Work timeline (full chronology) + Obsidian vault + web memory graph

Goal: store EVERYTHING each user does as a chronology the assistant reads for
"what did X do over the month" reports, and show it as a memory graph in the
browser (Obsidian-style). Built via orchestration: Architect (Opus) +
Opus sub-agent (Obsidian exporter).

### Timeline store (source of truth, machine-first)
- `src/domain/work-timeline.js`: append-only JSONL per user under
  `<data dir>/work-timeline/`. appendTimelineEvent / appendTimelineEventForUsers
  / readTimeline (period+kind filter) / summarizeTimeline / listTimelineUserIds.
  Rich events {id, ts, userId, actorUserId, kind, title, detail, links:
  {projectIds, taskIds, userIds}, source, metadata}. 14 kinds. Kept OUT of
  control-plane.json (lock-guarded) to handle high volume.
- Hooks capture everything: dialogues (company-assistant), agent task runs
  (agent-loop), device actions (router complete), and task lifecycle.
- `src/domain/task-sync.js`: pure diff of a user's task list vs a per-user
  snapshot in state.taskSyncState → emits task_created / task_status_change /
  task_completed timeline events. Hooked in the assistant context where
  Platrum user tasks are read. This is what captures "кому какие таски ставила".

### Work-history report
- `src/domain/work-history.js`: buildWorkHistoryReport(user, from, to) reads the
  timeline and produces a digest (totals, tasks, by-day, collaborators).
  parseHistoryPeriod (за месяц/неделю/сегодня/«за июнь»…; fixed Cyrillic word
  boundaries — \b is ASCII-only in JS). isWorkHistoryRequest detects intent.
  Wired into the assistant: history questions attach context.workHistory and
  the system prompt tells Claude to answer from it. So Begayym asking "что я
  делала за месяц" gets a real chronology-based report.

### Obsidian vault export (mirror, source of truth on server)
- `src/domain/obsidian-export.js` (sub-agent): exportObsidianVault writes
  People/<name>.md, Projects/<name>.md, Daily/<date>.md, Home.md with [[wiki
  links]] from timeline + state. Single safeNoteName() keeps links consistent
  so the graph connects. Idempotent (cleans only vaultDir).

### Web memory graph (the "website like n8n" showcase)
- Perlite (PHP) was php-fpm-only → needs nginx+fpm pair → fragile. Pivoted to a
  self-contained static site I fully control:
  `src/domain/memory-graph-site.js`: exportMemoryGraphSite builds graph.json
  (people/project nodes, org+collaboration+project edges, per-node detail with
  recent events) + a single index.html with an interactive force-graph (CDN,
  no backend). Click a node → side panel with that person's totals and recent
  events.
- Bot loop auto-exports vault + graph site hourly (STARLAB_VAULT_DIR,
  STARLAB_GRAPH_SITE_DIR envs).
- Served at https://starlabagent.pp.ua/memory/ via nginx (alias
  /opt/starlab-vault-web), protected by HTTP basic auth
  (/etc/nginx/starlab-memory.htpasswd, user nikolay). Verified 401 without
  auth, 200 with; auto-export logs "memory graph site exported".

### Verification
- Local + server npm test: 217 passed, 0 failed (+ timeline/task-sync/history/
  obsidian/graph-site tests). Services active, logs clean.

### Notes / next
- Timeline starts empty; it fills as people use the assistant/agent. The graph
  shows structure now (5 people, 3 projects) and gets richer over time.
- Vault also opens in desktop Obsidian if ever wanted (same folder).
- Basic-auth creds for /memory are NOT stored in git; issue to Nikolay
  separately. Consider Tailscale-only access later.

## 2026-06-15 - Fix: open_app failed for human app names ("Visual Studio Code")

### Problem (user-reported)
User sent "открыть Visual Studio Code"; command queued but VS Code never
opened. Diagnosis: user's device (dasmu-win, ver 2026.6.7, online,
command-polling works — other commands succeed) ran
`Start-Process -FilePath 'Visual Studio Code'`, which fails because that is a
display name, not an executable. The agent's own alias map had "vscode"/"code"
but not "visual studio code".

### Fix (server-side, immediate for ALL installed agents — no rebuild)
- New `src/domain/app-aliases.js` `resolveOpenAppTarget(appName, platform)`:
  Windows maps human names to launch targets (Visual Studio Code → "code",
  Google Chrome → "chrome", Блокнот → "notepad", …); macOS keeps display names
  (for `open -a`); linux unchanged.
- `createDeviceCommand` (device-agents.js) resolves open_app's app name against
  the TARGET device's platform before queuing. Original kept as args.appLabel
  (only when changed). So existing agents receive a target their Start-Process
  / open -a can resolve.

### Fix (clients, defense-in-depth, ships on next build)
- `src/agent-tools/executor.js` (our Electron/CLI executor): open_app now tries
  multiple candidates (mapped target, PATH name, full paths, %ENV% expansion)
  via a foreach loop instead of one Start-Process.
- `openclaw-starlab-2026.6.5/apps/windows/src/main.cjs`: added
  "visual studio code"/"vs code" to WINDOWS_APP_ALIASES.

### Verification
- Local + server npm test: 220 passed, 0 failed (+ app-aliases tests).
- LIVE: queued open_app "Visual Studio Code" to user's device; server rewrote
  args.app -> "code"; agent executed; status succeeded in ~4s.

## 2026-06-15 - Universal open_app: open ANY installed application

### Goal
User wants to open any app installed on the device, not just a dictionary of
common ones.

### Implemented (agent-side; opens any installed app)
- Windows openApp now uses a 3-stage universal resolver:
  1. Direct Start-Process (PATH + App Paths registry + full paths / known
     alias target).
  2. `Get-StartApps` fuzzy match by the human label → launch via
     `shell:AppsFolder\<AppID>` — covers Win32 AND Store/UWP apps (Start menu).
  3. Start Menu `.lnk` shortcut search by name.
  Echoes which method matched; errors only if nothing found.
- Applied in both clients:
  - `openclaw-starlab-2026.6.5/apps/windows/src/main.cjs` (the agent users run).
  - `control-plane/src/agent-tools/executor.js` (our Electron/CLI executor).
- Server passes the human label as args.appLabel so the agent can fuzzy-search
  by display name even when the alias target ("code") is used for direct launch.

### Validation
- Get-StartApps verified on a real Windows box: 171 apps enumerated, fuzzy
  name match works. Server + local npm test: 220 passed, 0 failed.

### Delivery note (IMPORTANT)
- This is agent-side logic → it reaches a user's machine only via a new agent
  build. The Windows agent auto-updates from /downloads/releases.json (checks
  ~6h, SHA-256 verified, user confirms install). To ship: build new
  starlab-openclaw-agent-windows.exe (bump 2026.6.7 → 2026.6.8), publish to
  server /downloads, bump releases.json. Until then, the CURRENT agent already
  opens: dictionary apps (server-side resolver, ~20 common apps) + anything on
  PATH / App Paths registry. Display-name-only and Store apps need the update.

## 2026-06-15 - Natural-language daily plan: create & complete without commands

### User request
Employees shouldn't need slash commands. They should be able to write a plan
as free text ("План на сегодня\n1. ...\n2. ...") and mark items done naturally
("переговоры на 17:00 провели", "я выполнил отчёт"). Also /plan with no text
must not error.

### Implemented
- New `src/domain/natural-plan-actions.js` (pure parsing/matching):
  - parseNaturalPlanIntent: detects a plan header ("план на сегодня", "мой
    план", "todo", "задачи на день") followed by a list; ignores plan
    QUESTIONS ("какой план?").
  - parseNaturalDoneIntent: detects completion verbs (выполнил/сделал/провёл/
    закрыл/готово…); defers "всё/остальные" to the existing remaining-done path.
  - matchPlanItemByPhrase: fuzzy-matches a phrase to a plan item by keyword
    overlap (stopwords + done-verbs stripped) and time tokens ("17:00" is a
    strong signal).
- `daily-assistant.js`: exported findTodayPlanForUser.
- `telegram/handler.js` free-form path now, before the assistant:
  - maybeCreateNaturalPlan → createOrUpdateDailyPlan from natural text.
  - maybeMarkNaturalDone → marks the matching plan item done (specific),
    after the existing "всё сделал" remaining-done handler.
- `/plan` with no text no longer errors: shows the current plan (if any) plus
  a friendly example of writing a plan as free text.

### Order of free-form intent handling
natural plan create → remaining-done ("всё") → specific natural done →
natural device command → assistant. Non-matches fall through safely (e.g.
"что я сделал за месяц" → no plan match → work-history assistant).

### Verification
- Local + server npm test: 225 passed, 0 failed (+ natural-plan tests).
- Services active, logs clean.
