import assert from "node:assert/strict";
import test from "node:test";
import { TELEGRAM_BOT_COMMANDS } from "../src/telegram/bot-commands.js";
import { TelegramBotApi } from "../src/telegram/telegram-api.js";

test("TelegramBotApi synchronizes cleaned slash command menu", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url: String(url),
      body: JSON.parse(options.body),
    });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const telegram = new TelegramBotApi({ token: "TEST_TOKEN" });
  await telegram.setMyCommands({ commands: TELEGRAM_BOT_COMMANDS });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.telegram.org/botTEST_TOKEN/setMyCommands");
  assert.deepEqual(calls[0].body.commands, TELEGRAM_BOT_COMMANDS);
  assert.equal(calls[0].body.commands.some(({ command }) => ["tools", "between", "side"].includes(command)), false);
});

test("TelegramBotApi downloads and sends voice files", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/getFile")) {
      return new Response(JSON.stringify({ ok: true, result: { file_path: "voice/file_1.ogg" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).includes("/file/botTEST_TOKEN/voice/file_1.ogg")) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }
    if (String(url).endsWith("/sendVoice")) {
      assert.equal(options.body instanceof FormData, true);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const telegram = new TelegramBotApi({ token: "TEST_TOKEN" });
  const file = await telegram.getFile({ fileId: "VOICE_FILE_ID" });
  const bytes = await telegram.downloadFile({ filePath: file.file_path });
  const sent = await telegram.sendVoice({
    chatId: 10,
    audioBytes: bytes,
    filename: "reply.ogg",
    mimeType: "audio/ogg",
    caption: "<b>Ответ голосом</b>",
  });

  assert.equal(Buffer.compare(bytes, Buffer.from([1, 2, 3])), 0);
  assert.equal(sent.message_id, 42);
  assert.equal(calls.some((call) => call.url.endsWith("/sendVoice")), true);
});
