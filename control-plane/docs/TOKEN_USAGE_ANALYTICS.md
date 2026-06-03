# Token usage analytics

The control plane records model token usage events and builds reports by:

- user;
- action;
- model;
- project;
- period.

Automatic Telegram reports are sent only to:

```text
984834133
```

This recipient can be changed in the setup wizard field
`tokenReportRecipientTelegramId`.

## Record usage

Agents should call this endpoint after each model request:

```text
POST /api/v1/token-usage/events
```

If `TOKEN_USAGE_INGEST_TOKEN` is configured, agents must send:

```text
X-Usage-Ingest-Token: <token>
```

Single event example:

```json
{
  "userId": "u-nikolay",
  "projectId": "project-alpha",
  "action": "coding",
  "source": "openclaw",
  "provider": "anthropic",
  "model": "anthropic/claude-sonnet-4-6",
  "sessionId": "session-123",
  "requestId": "request-456",
  "inputTokens": 1200,
  "outputTokens": 300,
  "cacheReadTokens": 50,
  "cacheWriteTokens": 0,
  "costUsd": 0.12
}
```

Batch example:

```json
{
  "events": [
    {
      "userId": "u-nikolay",
      "action": "coding",
      "model": "anthropic/claude-sonnet-4-6",
      "inputTokens": 1200,
      "outputTokens": 300
    },
    {
      "userId": "u-maksat",
      "action": "project_summary",
      "model": "anthropic/claude-sonnet-4-6",
      "inputTokens": 800,
      "outputTokens": 180
    }
  ]
}
```

The event can identify the user by either:

- `userId`
- `telegramUserId`

## Read summary

Owner-only endpoint:

```text
GET /api/v1/token-usage/summary?period=day
GET /api/v1/token-usage/summary?period=week
GET /api/v1/token-usage/summary?period=month
```

The request must include Nikolay/owner's Telegram id:

```text
X-Actor-Telegram-Id: <owner telegram id>
```

Custom range:

```text
GET /api/v1/token-usage/summary?from=2026-06-01T00:00:00Z&to=2026-06-02T00:00:00Z
```

## Telegram reports

The Telegram runner checks due reports during polling:

- daily: last 24 hours;
- weekly: last 7 days;
- monthly: last 30 days.

Reports include:

- total tokens;
- input/output/cache tokens;
- estimated cost when `costUsd` is provided;
- top users;
- top actions;
- top models.

Manual command for the configured recipient:

```text
/tokens day
/tokens week
/tokens month
```

## Current limitations

- This records usage only after agents send usage events.
- OpenClaw source code has not been modified yet.
- Pricing is not calculated automatically; agents may send `costUsd`.
- Long-term production storage should move from JSON to Postgres.
