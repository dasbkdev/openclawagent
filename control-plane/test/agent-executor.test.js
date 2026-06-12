import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import test from "node:test";
import {
  supportedActionsForPlatform,
  executeAction,
  escapePowerShellLiteral,
  escapeAppleScriptLiteral,
  buildWindowsCommand,
  buildDarwinCommand,
  buildLinuxCommand,
} from "../src/agent-tools/executor.js";

test("supportedActionsForPlatform returns a non-empty list for each platform", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const actions = supportedActionsForPlatform(platform);
    assert.ok(Array.isArray(actions));
    assert.ok(actions.length > 0, `${platform} should advertise capabilities`);
    // File ops + run_script are reliable everywhere.
    assert.ok(actions.includes("read_file"));
    assert.ok(actions.includes("run_script"));
    assert.ok(actions.includes("system_info"));
  }
});

test("supportedActionsForPlatform falls back for unknown platforms", () => {
  const actions = supportedActionsForPlatform("plan9");
  assert.ok(actions.includes("read_file"));
  assert.ok(actions.includes("run_script"));
});

test("escapePowerShellLiteral doubles single quotes", () => {
  assert.equal(escapePowerShellLiteral("it's a 'test'"), "it''s a ''test''");
});

test("escapeAppleScriptLiteral escapes quotes and backslashes", () => {
  assert.equal(escapeAppleScriptLiteral('a "b" \\c'), 'a \\"b\\" \\\\c');
});

test("buildWindowsCommand builds Start-Process for open_app", () => {
  const command = buildWindowsCommand("open_app", { name: "notepad" });
  assert.equal(command, "Start-Process -FilePath 'notepad'");
});

test("buildWindowsCommand escapes clipboard payload", () => {
  const command = buildWindowsCommand("clipboard_set", { text: "don't break" });
  assert.equal(command, "Set-Clipboard -Value 'don''t break'");
});

test("buildWindowsCommand returns null for actions without a PowerShell form", () => {
  assert.equal(buildWindowsCommand("read_file", { path: "x" }), null);
});

test("buildDarwinCommand maps open_app to open -a", () => {
  const spec = buildDarwinCommand("open_app", { name: "Safari" });
  assert.deepEqual(spec, { exec: "open", args: ["-a", "Safari"] });
});

test("buildDarwinCommand builds osascript notification", () => {
  const spec = buildDarwinCommand("notify", { title: "Hi", message: "There" });
  assert.equal(spec.exec, "osascript");
  assert.match(spec.args[1], /display notification "There" with title "Hi"/u);
});

test("buildLinuxCommand flags required tools and unsupported actions", () => {
  const clip = buildLinuxCommand("clipboard_get", {});
  assert.equal(clip.requires, "xclip");
  const unknown = buildLinuxCommand("openclaw_prompt", {});
  assert.ok(unknown.unsupported);
});

test("executeAction rejects sensitive actions without confirmation", async () => {
  const result = await executeAction({
    type: "run_script",
    args: { script: "echo hi" },
    platform: "linux",
    runner: async () => {
      throw new Error("runner should not be called");
    },
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.error, "confirmation required");
});

test("executeAction runs sensitive action when confirmCallback approves", async () => {
  let called = false;
  const result = await executeAction({
    type: "run_script",
    args: { script: "echo hi" },
    platform: "linux",
    confirmCallback: () => true,
    runner: async ({ exec, args }) => {
      called = true;
      assert.equal(exec, "/bin/sh");
      assert.deepEqual(args, ["-c", "echo hi"]);
      return { stdout: "hi\n", stderr: "" };
    },
  });
  assert.ok(called);
  assert.equal(result.status, "succeeded");
  assert.equal(result.result.output, "hi");
});

test("executeAction returns unsupported for an unknown type", async () => {
  const result = await executeAction({ type: "does_not_exist", platform: "linux" });
  assert.equal(result.status, "unsupported");
});

test("executeAction returns unsupported for missing type", async () => {
  const result = await executeAction({ platform: "linux" });
  assert.equal(result.status, "unsupported");
});

test("executeAction runs a non-sensitive command via the injected runner", async () => {
  const result = await executeAction({
    type: "clipboard_get",
    platform: "darwin",
    runner: async ({ exec }) => {
      assert.equal(exec, "pbpaste");
      return { stdout: "clip text\n", stderr: "" };
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.result.text, "clip text");
});

test("executeAction never throws even when the runner fails", async () => {
  const result = await executeAction({
    type: "list_running_apps",
    platform: "win32",
    runner: async () => {
      throw new Error("boom");
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error, "boom");
});

test("executeAction system_info returns host details without a runner", async () => {
  const result = await executeAction({ type: "system_info", platform: "linux" });
  assert.equal(result.status, "succeeded");
  assert.equal(result.result.platform, os.platform());
  assert.ok(result.result.cpuCount > 0);
});

test("write_file then read_file round-trips on the real fs", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "starlab-exec-"));
  const target = path.join(dir, "note.txt");
  try {
    const write = await executeAction({
      type: "write_file",
      args: { path: target, content: "hello world" },
      platform: "linux",
      confirmCallback: () => true,
    });
    assert.equal(write.status, "succeeded");

    const read = await executeAction({ type: "read_file", args: { path: target }, platform: "linux" });
    assert.equal(read.status, "succeeded");
    assert.equal(read.result.content, "hello world");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("write_file is sensitive and rejected without confirmation", async () => {
  const result = await executeAction({
    type: "write_file",
    args: { path: path.join(os.tmpdir(), "should-not-exist.txt"), content: "x" },
    platform: "linux",
  });
  assert.equal(result.status, "rejected");
});
