import test from "node:test";
import assert from "node:assert/strict";
import { BrowserServiceClient } from "../src/integrations/browser-client.js";
import { runAgentTask } from "../src/assistant/agent-loop.js";
import { createInitialState } from "../src/infra/seed.js";
import { JsonStore } from "../src/infra/json-store.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

test("BrowserServiceClient is disabled when flag is false", () => {
  const c = new BrowserServiceClient({ baseUrl: "http://x", enabled: false });
  assert.equal(c.configured, false);
});

test("BrowserServiceClient.run returns structured error when disabled", async () => {
  const c = new BrowserServiceClient({ baseUrl: "", enabled: false });
  const r = await c.run({ url: "https://example.com" });
  assert.equal(r.ok, false);
  assert.match(r.error, /disabled/u);
});

test("agent loop exposes browse_web and routes it to the browser client", async () => {
  const state = createInitialState();
  const actor = state.users.find((u) => u.id === "u-nikolay");
  actor.telegram = { telegramUserId: "900" };
  const device = {
    deviceId: "d1", userId: "u-nikolay", displayName: "PC", platform: "win32",
    capabilities: ["heartbeat", "command-polling", "open_app"],
  };
  const file = path.join(os.tmpdir(), `browser-loop-${Date.now()}.json`);
  const store = new JsonStore(file, () => state);

  // Fake browser client that records the call.
  let browseArgs = null;
  const browserClient = {
    configured: true,
    async run(args) {
      browseArgs = args;
      return { ok: true, finalUrl: "https://news.example/", title: "News", text: "Заголовок дня", steps: [{ action: "extract_text", status: "succeeded" }] };
    },
  };

  let turn = 0;
  const claude = {
    configured: true,
    async sendMessages() {
      turn += 1;
      if (turn === 1) {
        return {
          content: [{ type: "tool_use", id: "t1", name: "browse_web", input: { url: "https://news.example", steps: [{ action: "extract_text" }] } }],
          stop_reason: "tool_use",
          usage: {},
        };
      }
      return {
        content: [{ type: "tool_use", id: "t2", name: "finish_task", input: { summary: "Прочитал новости.", success: true } }],
        stop_reason: "tool_use",
        usage: {},
      };
    },
  };

  try {
    const outcome = await runAgentTask({
      store,
      claudeClient: claude,
      actor,
      device,
      instruction: "зайди на news.example и прочитай заголовок",
      enqueueAndWait: async () => ({ status: "succeeded" }),
      browserClient,
    });
    assert.equal(outcome.ok, true);
    assert.ok(browseArgs, "browser client should have been called");
    assert.equal(browseArgs.url, "https://news.example");
    assert.equal(outcome.steps[0].type, "browse_web");
    assert.equal(outcome.steps[0].status, "succeeded");
  } finally {
    await fs.rm(file, { force: true });
  }
});

test("agent loop omits browse_web when browser client is not configured", async () => {
  const state = createInitialState();
  const actor = state.users.find((u) => u.id === "u-nikolay");
  actor.telegram = { telegramUserId: "900" };
  const device = { deviceId: "d1", userId: "u-nikolay", platform: "win32", capabilities: ["command-polling"] };
  const file = path.join(os.tmpdir(), `browser-loop2-${Date.now()}.json`);
  const store = new JsonStore(file, () => state);
  let sawTools = null;
  const claude = {
    configured: true,
    async sendMessages({ tools }) {
      sawTools = tools.map((t) => t.name);
      return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: {} };
    },
  };
  try {
    await runAgentTask({
      store, claudeClient: claude, actor, device,
      instruction: "сделай что-нибудь",
      enqueueAndWait: async () => ({ status: "succeeded" }),
      browserClient: { configured: false },
    });
    assert.equal(sawTools.includes("browse_web"), false);
  } finally {
    await fs.rm(file, { force: true });
  }
});
