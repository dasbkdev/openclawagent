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
