import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { runAgentTask, resolveAgentTaskDevice, makeDeviceCommandRunner, DEVICE_TOOL_SCHEMAS } from "../src/assistant/agent-loop.js";
import { createInitialState } from "../src/infra/seed.js";
import { JsonStore } from "../src/infra/json-store.js";

function tempStore(state) {
  const file = path.join(os.tmpdir(), `agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  return { store: new JsonStore(file, () => state), cleanup: () => fs.rm(file, { force: true }) };
}

function deviceFor(actorId) {
  return {
    deviceId: `${actorId}-dev`,
    userId: actorId,
    displayName: "Test PC",
    platform: "win32",
    capabilities: ["heartbeat", "command-polling", "open_app", "screenshot", "run_script"],
    lastSeenAt: new Date().toISOString(),
  };
}

// Claude stub: first turn calls open_app, second turn finishes.
function scriptedClaude(turns) {
  let i = 0;
  return {
    configured: true,
    async sendMessages() {
      const turn = turns[Math.min(i, turns.length - 1)];
      i += 1;
      return turn;
    },
  };
}

test("DEVICE_TOOL_SCHEMAS expose valid tool definitions", () => {
  for (const t of DEVICE_TOOL_SCHEMAS) {
    assert.equal(typeof t.name, "string");
    assert.equal(t.input_schema.type, "object");
  }
  assert.ok(DEVICE_TOOL_SCHEMAS.some((t) => t.name === "run_script"));
});

test("device command runner fast-fails when the device app is offline", async () => {
  const state = createInitialState();
  const { store, cleanup } = tempStore(state);
  try {
    const device = { ...deviceFor("u-nikolay"), lastSeenAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() };
    const run = makeDeviceCommandRunner({ store, actor: { id: "u-nikolay" }, device });
    const outcome = await run({ type: "open_app", args: { app: "Chrome" } });
    assert.equal(outcome.status, "failed");
    assert.match(outcome.error, /не запущено|OpenClaw/u);
    const s = await store.load();
    assert.equal((s.deviceCommands || []).length, 0); // nothing queued
  } finally {
    await cleanup();
  }
});

test("runAgentTask executes a tool then finishes", async () => {
  const state = createInitialState();
  const actor = state.users.find((u) => u.id === "u-nikolay");
  actor.telegram = { telegramUserId: "900" };
  const device = deviceFor(actor.id);
  const { store, cleanup } = tempStore(state);
  try {
    const claude = scriptedClaude([
      {
        content: [
          { type: "text", text: "Открою приложение." },
          { type: "tool_use", id: "t1", name: "open_app", input: { app: "Google Chrome" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        content: [
          { type: "tool_use", id: "t2", name: "finish_task", input: { summary: "Chrome запущен.", success: true } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 8, output_tokens: 3 },
      },
    ]);

    const executed = [];
    const enqueueAndWait = async ({ type, args }) => {
      executed.push({ type, args });
      return { status: "succeeded", result: "ok" };
    };

    const outcome = await runAgentTask({
      store,
      claudeClient: claude,
      actor,
      device,
      instruction: "открой хром",
      enqueueAndWait,
    });

    assert.equal(outcome.ok, true);
    assert.match(outcome.summary, /Chrome/u);
    assert.equal(executed.length, 1);
    assert.equal(executed[0].type, "open_app");
    assert.equal(outcome.steps[0].status, "succeeded");
    const saved = await store.load();
    assert.equal(saved.auditLog.at(-1).action, "agent.task.run");
  } finally {
    await cleanup();
  }
});

test("runAgentTask reports rejected sensitive steps and keeps going", async () => {
  const state = createInitialState();
  const actor = state.users.find((u) => u.id === "u-nikolay");
  actor.telegram = { telegramUserId: "900" };
  const device = deviceFor(actor.id);
  const { store, cleanup } = tempStore(state);
  try {
    const claude = scriptedClaude([
      {
        content: [{ type: "tool_use", id: "t1", name: "run_script", input: { script: "rm -rf /" } }],
        stop_reason: "tool_use",
        usage: {},
      },
      {
        content: [{ type: "tool_use", id: "t2", name: "finish_task", input: { summary: "Сотрудник отклонил.", success: false } }],
        stop_reason: "tool_use",
        usage: {},
      },
    ]);
    const enqueueAndWait = async () => ({ status: "rejected", error: "confirmation required" });

    const outcome = await runAgentTask({
      store,
      claudeClient: claude,
      actor,
      device,
      instruction: "удали все",
      enqueueAndWait,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.steps[0].status, "rejected");
    assert.equal(outcome.steps[0].sensitive, true);
  } finally {
    await cleanup();
  }
});

test("runAgentTask stops at maxSteps without finish", async () => {
  const state = createInitialState();
  const actor = state.users.find((u) => u.id === "u-nikolay");
  actor.telegram = { telegramUserId: "900" };
  const device = deviceFor(actor.id);
  const { store, cleanup } = tempStore(state);
  try {
    const loopingTurn = {
      content: [{ type: "tool_use", id: "tx", name: "screenshot", input: {} }],
      stop_reason: "tool_use",
      usage: {},
    };
    const claude = scriptedClaude([loopingTurn]);
    const enqueueAndWait = async () => ({ status: "succeeded", result: "shot" });

    const outcome = await runAgentTask({
      store,
      claudeClient: claude,
      actor,
      device,
      instruction: "делай скриншоты вечно",
      enqueueAndWait,
      maxSteps: 3,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.steps.length, 3);
    assert.match(outcome.summary, /лимит/iu);
  } finally {
    await cleanup();
  }
});

test("resolveAgentTaskDevice prefers actor's own device and validates", () => {
  const state = createInitialState();
  const actor = state.users.find((u) => u.id === "u-nikolay");
  actor.telegram = { telegramUserId: "900" };
  state.deviceAgents = [
    { ...deviceFor("u-nikolay"), id: "d1" },
  ];
  const device = resolveAgentTaskDevice(state, actor, {});
  assert.equal(device.userId, "u-nikolay");
  assert.throws(() => resolveAgentTaskDevice(state, actor, { deviceId: "nope" }));
});

test("runAgentTask refuses when Claude is not configured", async () => {
  const state = createInitialState();
  const actor = state.users.find((u) => u.id === "u-nikolay");
  const { store, cleanup } = tempStore(state);
  try {
    const outcome = await runAgentTask({
      store,
      claudeClient: { configured: false },
      actor,
      device: deviceFor(actor.id),
      instruction: "сделай что-нибудь",
      enqueueAndWait: async () => ({ status: "succeeded" }),
    });
    assert.equal(outcome.ok, false);
    assert.match(outcome.summary, /Claude/u);
  } finally {
    await cleanup();
  }
});
