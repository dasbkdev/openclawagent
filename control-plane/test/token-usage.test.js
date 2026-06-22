import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTokenUsageSummary,
  checkUserTokenBudget,
  DEFAULT_USER_DAILY_TOKEN_LIMIT,
  enforceUserTokenBudget,
  formatTokenUsageSummary,
  getUserTokenUsage,
  recordTokenUsageEvent,
  resolveTokenUsagePeriod,
} from "../src/domain/token-usage.js";
import { createInitialState } from "../src/infra/seed.js";
import { getUserById } from "../src/domain/policy.js";

test("per-user 24h token budget: window sum, hard block, owner exempt", () => {
  const now = new Date("2026-06-10T12:00:00Z");
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });

  // within window counts; older-than-24h and other users are ignored
  recordTokenUsageEvent(state, { occurredAt: "2026-06-10T06:00:00Z", userId: "u-pm-1", action: "a", totalTokens: 1_500_000 }, { now });
  recordTokenUsageEvent(state, { occurredAt: "2026-06-09T06:00:00Z", userId: "u-pm-1", action: "a", totalTokens: 5_000_000 }, { now }); // >24h ago
  recordTokenUsageEvent(state, { occurredAt: "2026-06-10T06:00:00Z", userId: "u-maksat", action: "a", totalTokens: 9_000_000 }, { now });

  assert.equal(getUserTokenUsage(state, "u-pm-1", { now }), 1_500_000);

  const under = checkUserTokenBudget(state, "u-pm-1", { now });
  assert.equal(under.limit, DEFAULT_USER_DAILY_TOKEN_LIMIT);
  assert.equal(under.exceeded, false);
  assert.equal(enforceUserTokenBudget(state, getUserById(state, "u-pm-1"), { now }).allowed, true);

  // push the PM over the 2.2M limit
  recordTokenUsageEvent(state, { occurredAt: "2026-06-10T11:00:00Z", userId: "u-pm-1", action: "a", totalTokens: 800_000 }, { now });
  const over = enforceUserTokenBudget(state, getUserById(state, "u-pm-1"), { now });
  assert.equal(over.allowed, false);
  assert.match(over.message, /лимит токенов/i);

  // owner is never hard-blocked even when over
  recordTokenUsageEvent(state, { occurredAt: "2026-06-10T11:00:00Z", userId: "u-nikolay", action: "a", totalTokens: 9_000_000 }, { now });
  assert.equal(enforceUserTokenBudget(state, getUserById(state, "u-nikolay"), { now }).allowed, true);
});

test("token budget honours TOKEN_USER_DAILY_LIMIT override", () => {
  const now = new Date("2026-06-10T12:00:00Z");
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  recordTokenUsageEvent(state, { occurredAt: "2026-06-10T11:00:00Z", userId: "u-pm-1", action: "a", totalTokens: 600 }, { now });
  const gate = enforceUserTokenBudget(state, getUserById(state, "u-pm-1"), { now, env: { TOKEN_USER_DAILY_LIMIT: "500" } });
  assert.equal(gate.allowed, false);
});

test("token usage records and summarizes by user, action, and model", () => {
  const state = createInitialState();

  recordTokenUsageEvent(state, {
    occurredAt: "2026-06-02T09:00:00Z",
    userId: "u-nikolay",
    action: "telegram_report",
    model: "anthropic/claude-sonnet-4-6",
    inputTokens: 100,
    outputTokens: 40,
    cacheReadTokens: 10,
    costUsd: 0.02,
  });
  recordTokenUsageEvent(state, {
    occurredAt: "2026-06-02T10:00:00Z",
    userId: "u-maksat",
    action: "project_summary",
    model: "anthropic/claude-sonnet-4-6",
    promptTokens: 200,
    completionTokens: 60,
  });

  const summary = buildTokenUsageSummary(state, {
    from: "2026-06-02T00:00:00Z",
    to: "2026-06-02T23:59:59Z",
  });

  assert.equal(summary.eventCount, 2);
  assert.equal(summary.totals.totalTokens, 410);
  assert.equal(summary.byUser[0].userId, "u-maksat");
  assert.equal(summary.byAction[0].action, "project_summary");
  assert.equal(summary.byModel[0].model, "anthropic/claude-sonnet-4-6");

  const text = formatTokenUsageSummary(summary, { label: "test" });
  assert.match(text, /Расход токенов/);
  assert.match(text, /По пользователям/);
  assert.match(text, /project_summary/);
});

test("token usage period resolver supports day week and month", () => {
  const now = new Date("2026-06-02T12:00:00Z");
  assert.equal(resolveTokenUsagePeriod("day", now).from, "2026-06-01T12:00:00.000Z");
  assert.equal(resolveTokenUsagePeriod("week", now).from, "2026-05-26T12:00:00.000Z");
  assert.equal(resolveTokenUsagePeriod("month", now).from, "2026-05-03T12:00:00.000Z");
});

test("token usage period resolver accepts Russian synonyms", () => {
  assert.equal(resolveTokenUsagePeriod("день").key, "daily");
  assert.equal(resolveTokenUsagePeriod("сегодня").key, "daily");
  assert.equal(resolveTokenUsagePeriod("за неделю").key, "weekly");
  assert.equal(resolveTokenUsagePeriod("неделя").key, "weekly");
  assert.equal(resolveTokenUsagePeriod("месяц").key, "monthly");
  assert.equal(resolveTokenUsagePeriod("за месяц").key, "monthly");
});

test("token usage rejects unknown users and missing token counts", () => {
  const state = createInitialState();
  assert.throws(
    () =>
      recordTokenUsageEvent(state, {
        userId: "missing",
        action: "chat",
        totalTokens: 10,
      }),
    /Unknown userId/,
  );
  assert.throws(
    () =>
      recordTokenUsageEvent(state, {
        userId: "u-nikolay",
        action: "chat",
      }),
    /token counts/,
  );
});
