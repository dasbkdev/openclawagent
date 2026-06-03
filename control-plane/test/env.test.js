import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvFile } from "../src/infra/env.js";

test("parseEnvFile reads simple key values and ignores comments", () => {
  const values = parseEnvFile(`
# comment
PORT=3099
HOST=127.0.0.1
TELEGRAM_BOT_TOKEN="token:123"
invalid-key=ignored
BITRIX_WEBHOOK_URL=
`);

  assert.deepEqual(values, {
    PORT: "3099",
    HOST: "127.0.0.1",
    TELEGRAM_BOT_TOKEN: "token:123",
    BITRIX_WEBHOOK_URL: "",
  });
});
