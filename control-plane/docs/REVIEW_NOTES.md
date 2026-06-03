# Review Notes

## Scope

Implemented a standalone MVP control plane under `C:\Users\dasmu\agent\control-plane`.
No files in `kickidler` or `openclaw` were changed.

## Implemented

- Pure Node.js HTTP API with no runtime dependencies.
- JSON file store for MVP state.
- Seed hierarchy: Nikolay -> Maksat -> three PMs.
- RBAC policy helpers.
- One-time invite codes stored as hashes.
- Telegram registration endpoint.
- Accessible users/projects endpoints.
- Read-only Metricon activity summary endpoint.
- Read-only Bitrix project status endpoint.
- Mock Metricon connector plus real HTTP connector shape.
- Mock Bitrix connector plus real webhook connector shape.
- Telegram Bot API long-polling runner.
- Telegram commands for registration, profile, accessible users/projects,
  Metricon summaries, and Bitrix project status.
- Audit log for invite creation, Telegram registration, and Metricon reads.
- Audit log for Bitrix project status reads.
- Local setup wizard at `/setup`.
- Encrypted local secret storage for Telegram, Claude, Google OAuth, Metricon,
  and Bitrix credentials.
- Windows installer now opens setup after install.
- macOS packaging scaffold for `.app`, `.pkg`, and `.dmg`.
- Company Claude model policy enforcing latest Sonnet:
  `claude-sonnet-4-6` / `anthropic/claude-sonnet-4-6`.
- Token usage analytics:
  - `POST /api/v1/token-usage/events`
  - `GET /api/v1/token-usage/summary`
  - Telegram daily/weekly/monthly reports to `984834133`
  - `/tokens day|week|month` command for the configured recipient
- Node test coverage for policy, invites, and reports.

## Known MVP Limitations

- JSON storage should become Postgres before production.
- `BOOTSTRAP_OWNER_TELEGRAM_ID` default is for local development only.
- Metricon connector currently normalizes only the mock response; real response is returned under `raw`.
- Bitrix connector expects projects to have `bitrixGroupId` before real webhook calls.
- Jira/Google connectors are not implemented yet.
- Telegram runner uses long polling, not webhook hosting.
- Windows installer uses Scheduled Tasks running as `SYSTEM`, not a Windows
  Service wrapper.
- EXE packaging uses built-in Windows `iexpress.exe`; review the generated
  bootstrap and installer scripts before production signing/distribution.
- Local encrypted storage uses a key file on disk. Upgrade to DPAPI/Keychain or
  managed secrets before production.
- macOS `.pkg/.dmg` scripts must be run and tested on a real Mac.
- The current model policy must be updated when Anthropic releases a newer
  Sonnet model.
- Token analytics depend on agents sending usage events. OpenClaw has not yet
  been modified to emit them automatically.

## Verification

```powershell
npm test
```

Current test count: 22/22 passing.

Also smoke-tested the running service on `http://127.0.0.1:3099`.
