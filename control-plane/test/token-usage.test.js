import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTokenUsageSummary,
  formatTokenUsageSummary,
  recordTokenUsageEvent,
  resolveTokenUsagePeriod,
} from "../src/domain/token-usage.js";
import { createInitialState } from "../src/infra/seed.js";

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
  assert.match(text, /Top users/);
  assert.match(text, /Project_summary|project_summary/);
});

test("token usage period resolver supports day week and month", () => {
  const now = new Date("2026-06-02T12:00:00Z");
  assert.equal(resolveTokenUsagePeriod("day", now).from, "2026-06-01T12:00:00.000Z");
  assert.equal(resolveTokenUsagePeriod("week", now).from, "2026-05-26T12:00:00.000Z");
  assert.equal(resolveTokenUsagePeriod("month", now).from, "2026-05-03T12:00:00.000Z");
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
