import assert from "node:assert/strict";
import test from "node:test";
import {
  expireStaleAssistantLoops,
  findOpenLoopBySource,
  listOpenAssistantLoops,
  openAssistantLoop,
  resolveAssistantLoop,
} from "../src/domain/assistant-open-loops.js";

test("open loop is created, listed, and resolved", () => {
  const state = {};
  const loop = openAssistantLoop(state, {
    userId: "u-maksat",
    kind: "promise",
    text: "Прислать отчёт до конца дня",
    now: new Date("2026-06-10T10:00:00Z"),
  });
  assert.equal(loop.status, "open");
  assert.equal(loop.kind, "promise");

  const open = listOpenAssistantLoops(state, { userIds: ["u-maksat"] });
  assert.equal(open.length, 1);
  assert.equal(open[0].text, "Прислать отчёт до конца дня");

  const resolved = resolveAssistantLoop(state, {
    id: loop.id,
    userId: "u-maksat",
    resolution: "Отчёт прислан",
    now: new Date("2026-06-10T18:00:00Z"),
  });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolution, "Отчёт прислан");
  assert.equal(listOpenAssistantLoops(state, { userIds: ["u-maksat"] }).length, 0);
});

test("empty text does not create a loop", () => {
  const state = {};
  assert.equal(openAssistantLoop(state, { userId: "u-maksat", text: "  " }), null);
  assert.equal(listOpenAssistantLoops(state).length, 0);
});

test("listOpenAssistantLoops filters by user", () => {
  const state = {};
  openAssistantLoop(state, { userId: "u-a", text: "a" });
  openAssistantLoop(state, { userId: "u-b", text: "b" });
  assert.equal(listOpenAssistantLoops(state, { userIds: ["u-a"] }).length, 1);
  assert.equal(listOpenAssistantLoops(state, {}).length, 2);
});

test("findOpenLoopBySource matches type and id", () => {
  const state = {};
  openAssistantLoop(state, {
    userId: "u-a",
    text: "cmd",
    source: { type: "device_command", id: "open_app:{}" },
  });
  const found = findOpenLoopBySource(state, {
    userId: "u-a",
    type: "device_command",
    id: "open_app:{}",
  });
  assert.ok(found);
  assert.equal(
    findOpenLoopBySource(state, { userId: "u-a", type: "device_command", id: "other" }),
    null,
  );
});

test("expireStaleAssistantLoops marks old open loops expired", () => {
  const state = {};
  openAssistantLoop(state, {
    userId: "u-a",
    text: "old",
    now: new Date("2026-05-01T00:00:00Z"),
  });
  openAssistantLoop(state, {
    userId: "u-a",
    text: "fresh",
    now: new Date("2026-06-10T00:00:00Z"),
  });
  const expired = expireStaleAssistantLoops(state, {
    now: new Date("2026-06-11T00:00:00Z"),
    maxAgeDays: 14,
  });
  assert.equal(expired, 1);
  const open = listOpenAssistantLoops(state, { userIds: ["u-a"] });
  assert.equal(open.length, 1);
  assert.equal(open[0].text, "fresh");
});
