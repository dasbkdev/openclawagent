import assert from "node:assert/strict";
import test from "node:test";
import { distillAssistantMemory, parseDistillation } from "../src/assistant/memory-distiller.js";
import { listAssistantFacts } from "../src/domain/assistant-facts.js";
import { listOpenAssistantLoops, openAssistantLoop } from "../src/domain/assistant-open-loops.js";

function createMemoryStore(initial = {}) {
  let state = {
    assistantFacts: [],
    assistantOpenLoops: [],
    tokenUsageEvents: [],
    users: [{ id: "u-a", displayName: "A" }],
    projects: [],
    ...initial,
  };
  return {
    filePath: null,
    async load() {
      return state;
    },
    async update(mutator) {
      const result = await mutator(state);
      return result;
    },
    snapshot() {
      return state;
    },
  };
}

test("parseDistillation extracts JSON embedded in noise", () => {
  const parsed = parseDistillation(
    'Вот результат: {"newFacts":[{"category":"preference","text":"любит кофе"}],"resolvedLoopIds":["loop-1"],"newLoops":[{"kind":"promise","text":"созвон завтра"}]} — готово',
  );
  assert.equal(parsed.newFacts.length, 1);
  assert.equal(parsed.newFacts[0].text, "любит кофе");
  assert.deepEqual(parsed.resolvedLoopIds, ["loop-1"]);
  assert.equal(parsed.newLoops[0].kind, "promise");
});

test("parseDistillation returns null for garbage", () => {
  assert.equal(parseDistillation("no json here"), null);
  assert.equal(parseDistillation("{not valid json}"), null);
});

test("distill applies valid JSON: upserts facts, resolves and opens loops", async () => {
  const store = createMemoryStore();
  const existingLoop = openAssistantLoop(store.snapshot(), {
    userId: "u-a",
    text: "старое дело",
  });

  const claudeClient = {
    configured: true,
    async complete() {
      return {
        text: JSON.stringify({
          newFacts: [{ category: "habit", text: "работает по вечерам" }],
          resolvedLoopIds: [existingLoop.id],
          newLoops: [{ kind: "question", text: "уточнить дедлайн" }],
        }),
        model: "claude-haiku-4-5-20251001",
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
        configured: true,
      };
    },
  };

  const result = await distillAssistantMemory({
    store,
    claudeClient,
    actor: { id: "u-a" },
    question: "что нового",
    answer: "ответ",
    now: new Date("2026-06-10T10:00:00Z"),
  });

  assert.equal(result.applied, true);
  assert.equal(result.factCount, 1);
  assert.equal(result.resolvedCount, 1);
  assert.equal(result.newLoopCount, 1);

  const facts = listAssistantFacts(store.snapshot(), { userIds: ["u-a"] });
  assert.ok(facts.some((fact) => fact.text === "работает по вечерам"));
  const openLoops = listOpenAssistantLoops(store.snapshot(), { userIds: ["u-a"] });
  assert.equal(openLoops.length, 1);
  assert.equal(openLoops[0].text, "уточнить дедлайн");
  assert.equal(store.snapshot().tokenUsageEvents.length, 1);
  assert.equal(store.snapshot().tokenUsageEvents[0].action, "assistant.memory.distill");
});

test("distill silently does nothing on garbage output", async () => {
  const store = createMemoryStore();
  const claudeClient = {
    configured: true,
    async complete() {
      return { text: "definitely not json", model: "m", usage: null, configured: true };
    },
  };
  const result = await distillAssistantMemory({
    store,
    claudeClient,
    actor: { id: "u-a" },
    question: "q",
    answer: "a",
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "unparsable");
  assert.equal(listAssistantFacts(store.snapshot()).length, 0);
});

test("distill swallows exceptions from the claude client", async () => {
  const store = createMemoryStore();
  const claudeClient = {
    configured: true,
    async complete() {
      throw new Error("network down");
    },
  };
  const result = await distillAssistantMemory({
    store,
    claudeClient,
    actor: { id: "u-a" },
    question: "q",
    answer: "a",
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "error");
});

test("distill is skipped when claude is not configured", async () => {
  const store = createMemoryStore();
  const result = await distillAssistantMemory({
    store,
    claudeClient: { configured: false, async complete() {} },
    actor: { id: "u-a" },
    question: "q",
    answer: "a",
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "claude-not-configured");
});
