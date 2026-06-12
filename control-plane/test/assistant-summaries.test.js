import assert from "node:assert/strict";
import test from "node:test";
import {
  getLocalDateKey,
  hasDailySummary,
  listAssistantDailySummaries,
  runDueMemorySummaries,
} from "../src/domain/assistant-summaries.js";

function createStore(state) {
  return {
    async load() {
      return state;
    },
    async update(mutator) {
      return mutator(state);
    },
  };
}

test("getLocalDateKey formats in Asia/Bishkek (+06:00)", () => {
  // 2026-06-10T20:00:00Z is 2026-06-11 02:00 in Bishkek.
  assert.equal(getLocalDateKey(new Date("2026-06-10T20:00:00Z")), "2026-06-11");
});

test("runDueMemorySummaries generates one summary per user for yesterday", async () => {
  const now = new Date("2026-06-11T08:00:00Z");
  const yesterday = getLocalDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  // Build events that fall on yesterday in Bishkek.
  const eventTime = new Date(`${yesterday}T05:00:00+06:00`).toISOString();
  const state = {
    assistantMemory: [
      { id: "m1", userId: "u-a", role: "user", kind: "assistant_question", text: "вопрос", createdAt: eventTime },
      { id: "m2", userId: "u-a", role: "assistant", kind: "assistant_answer", text: "ответ", createdAt: eventTime },
    ],
    assistantDailySummaries: [],
  };

  let calls = 0;
  const claudeClient = {
    configured: true,
    async complete() {
      calls += 1;
      return { text: "Сводка дня: работал, обещал отчёт.", model: "m", usage: null, configured: true };
    },
  };

  const result = await runDueMemorySummaries({ store: createStore(state), claudeClient, now });
  assert.equal(result.generated, 1);
  assert.equal(calls, 1);
  assert.ok(hasDailySummary(state, { userId: "u-a", date: yesterday }));

  // Idempotent: a second run should not regenerate.
  const second = await runDueMemorySummaries({ store: createStore(state), claudeClient, now });
  assert.equal(second.generated, 0);
});

test("runDueMemorySummaries is skipped when claude is not configured", async () => {
  const result = await runDueMemorySummaries({
    store: createStore({ assistantMemory: [], assistantDailySummaries: [] }),
    claudeClient: { configured: false, async complete() {} },
    now: new Date("2026-06-11T08:00:00Z"),
  });
  assert.equal(result.generated, 0);
});

test("one failing user does not block the run", async () => {
  const now = new Date("2026-06-11T08:00:00Z");
  const yesterday = getLocalDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const eventTime = new Date(`${yesterday}T05:00:00+06:00`).toISOString();
  const state = {
    assistantMemory: [
      { id: "m1", userId: "u-a", role: "user", kind: "q", text: "a", createdAt: eventTime },
      { id: "m2", userId: "u-b", role: "user", kind: "q", text: "b", createdAt: eventTime },
    ],
    assistantDailySummaries: [],
  };
  const claudeClient = {
    configured: true,
    async complete({ user }) {
      // u-a's only event text is "a"; u-b's is "b". Fail just the first.
      if (/\] a$/mu.test(user)) {
        throw new Error("boom");
      }
      return { text: "ok summary", model: "m", usage: null, configured: true };
    },
  };
  const result = await runDueMemorySummaries({ store: createStore(state), claudeClient, now });
  assert.equal(result.generated, 1);
  const list = listAssistantDailySummaries(state, { userIds: ["u-b"] });
  assert.equal(list.length, 1);
});
