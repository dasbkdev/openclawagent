import assert from "node:assert/strict";
import test from "node:test";
import {
  listAssistantFacts,
  supersedeAssistantFact,
  upsertAssistantFact,
} from "../src/domain/assistant-facts.js";

test("upsert creates a fact and dedupes by normalized text", () => {
  const state = {};
  const first = upsertAssistantFact(state, {
    userId: "u-a",
    category: "preference",
    text: "Любит  работать  утром",
    sourceEventIds: ["e1"],
    now: new Date("2026-06-10T08:00:00Z"),
  });
  const second = upsertAssistantFact(state, {
    userId: "u-a",
    category: "preference",
    text: "любит работать утром",
    sourceEventIds: ["e2"],
    now: new Date("2026-06-11T08:00:00Z"),
  });

  assert.equal(first.id, second.id);
  assert.equal(state.assistantFacts.length, 1);
  assert.deepEqual(second.sourceEventIds.sort(), ["e1", "e2"]);
  assert.equal(second.updatedAt, "2026-06-11T08:00:00.000Z");
});

test("empty text is ignored", () => {
  const state = {};
  assert.equal(upsertAssistantFact(state, { userId: "u-a", text: "" }), null);
  assert.equal(listAssistantFacts(state).length, 0);
});

test("listAssistantFacts returns active facts newest-first and filters superseded", () => {
  const state = {};
  upsertAssistantFact(state, { userId: "u-a", text: "fact one", now: new Date("2026-06-10T00:00:00Z") });
  const second = upsertAssistantFact(state, {
    userId: "u-a",
    text: "fact two",
    now: new Date("2026-06-11T00:00:00Z"),
  });
  supersedeAssistantFact(state, { id: second.id });

  const list = listAssistantFacts(state, { userIds: ["u-a"] });
  assert.equal(list.length, 1);
  assert.equal(list[0].text, "fact one");
});

test("listAssistantFacts filters by userId", () => {
  const state = {};
  upsertAssistantFact(state, { userId: "u-a", text: "a fact" });
  upsertAssistantFact(state, { userId: "u-b", text: "b fact" });
  assert.equal(listAssistantFacts(state, { userIds: ["u-b"] }).length, 1);
});

test("cap supersedes oldest active facts beyond 200 per user", () => {
  const state = {};
  for (let i = 0; i < 205; i += 1) {
    upsertAssistantFact(state, {
      userId: "u-a",
      text: `fact number ${i}`,
      now: new Date(2026, 5, 1, 0, 0, i),
    });
  }
  const active = listAssistantFacts(state, { userIds: ["u-a"], limit: 200 });
  assert.equal(active.length, 200);
  // Oldest five superseded; the very first fact must be gone.
  assert.ok(!active.some((fact) => fact.text === "fact number 0"));
  assert.ok(active.some((fact) => fact.text === "fact number 204"));
});
