import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SecretStore, maskSecret } from "../src/setup/secret-store.js";

test("SecretStore encrypts secrets at rest and returns masked status", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccp-secrets-"));
  try {
    const store = new SecretStore({
      keyPath: path.join(dir, "secrets.key"),
      filePath: path.join(dir, "secrets.json"),
    });

    await store.writeSecret("claudeApiKey", "sk-ant-test-secret-value");

    assert.equal(await store.readSecret("claudeApiKey"), "sk-ant-test-secret-value");

    const rawFile = await fs.readFile(path.join(dir, "secrets.json"), "utf8");
    assert.equal(rawFile.includes("sk-ant-test-secret-value"), false);

    const status = await store.describeSecrets(["claudeApiKey", "telegramBotToken"]);
    assert.equal(status.claudeApiKey.configured, true);
    assert.equal(status.claudeApiKey.masked.includes("sk-ant-test-secret-value"), false);
    assert.equal(status.telegramBotToken.configured, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("maskSecret keeps only a small visible prefix and suffix", () => {
  assert.equal(maskSecret("12345678"), "********");
  assert.equal(maskSecret("sk-ant-abcdef123456"), "sk-a***********3456");
});
