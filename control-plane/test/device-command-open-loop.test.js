import assert from "node:assert/strict";
import test from "node:test";
import { syncDeviceCommandOpenLoop } from "../src/api/router.js";
import { listOpenAssistantLoops } from "../src/domain/assistant-open-loops.js";

test("a failed device command opens a command_follow_up loop", () => {
  const state = {};
  syncDeviceCommandOpenLoop(state, {
    id: "cmd-1",
    userId: "u-a",
    type: "open_app",
    args: { app: "Chrome" },
    status: "failed",
    error: "App not found",
  });
  const loops = listOpenAssistantLoops(state, { userIds: ["u-a"] });
  assert.equal(loops.length, 1);
  assert.equal(loops[0].kind, "command_follow_up");
  assert.match(loops[0].text, /open_app не выполнилась: App not found/u);
});

test("a successful retry of the same command resolves the loop", () => {
  const state = {};
  syncDeviceCommandOpenLoop(state, {
    id: "cmd-1",
    userId: "u-a",
    type: "open_app",
    args: { app: "Chrome" },
    status: "failed",
    error: "boom",
  });
  assert.equal(listOpenAssistantLoops(state, { userIds: ["u-a"] }).length, 1);

  syncDeviceCommandOpenLoop(state, {
    id: "cmd-2",
    userId: "u-a",
    type: "open_app",
    args: { app: "Chrome" },
    status: "succeeded",
    error: null,
  });
  assert.equal(listOpenAssistantLoops(state, { userIds: ["u-a"] }).length, 0);
});

test("repeated failures of the same command do not duplicate the loop", () => {
  const state = {};
  const fail = {
    id: "cmd-1",
    userId: "u-a",
    type: "open_url",
    args: { url: "https://x" },
    status: "failed",
    error: "net",
  };
  syncDeviceCommandOpenLoop(state, fail);
  syncDeviceCommandOpenLoop(state, { ...fail, id: "cmd-2" });
  assert.equal(listOpenAssistantLoops(state, { userIds: ["u-a"] }).length, 1);
});

test("a different command's success does not resolve an unrelated loop", () => {
  const state = {};
  syncDeviceCommandOpenLoop(state, {
    id: "cmd-1",
    userId: "u-a",
    type: "open_app",
    args: { app: "Chrome" },
    status: "failed",
    error: "boom",
  });
  syncDeviceCommandOpenLoop(state, {
    id: "cmd-2",
    userId: "u-a",
    type: "open_app",
    args: { app: "Safari" },
    status: "succeeded",
  });
  assert.equal(listOpenAssistantLoops(state, { userIds: ["u-a"] }).length, 1);
});
