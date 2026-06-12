import assert from "node:assert/strict";
import test from "node:test";
import {
  createVoiceServiceFromEnv,
  ElevenLabsSttClient,
  ElevenLabsTtsClient,
} from "../src/integrations/voice-service.js";

test("voice service detects voice reply requests and setup readiness", () => {
  const service = createVoiceServiceFromEnv({
    ELEVENLABS_API_KEY: "xi-test",
    ELEVENLABS_VOICE_ID: "voice-123",
    STT_PROVIDER: "elevenlabs",
    VOICE_REPLY_MODE: "on_request",
  });

  assert.equal(service.canTranscribe, true);
  assert.equal(service.canSynthesize, true);
  assert.equal(service.wantsVoiceReply("Ответь голосом, пожалуйста"), true);
  assert.equal(service.wantsVoiceReply("Покажи задачи Максата"), false);
});

test("ElevenLabs STT sends multipart transcript request", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    assert.equal(options.body instanceof FormData, true);
    assert.equal(options.headers["xi-api-key"], "xi-test");
    return new Response(JSON.stringify({ text: "Привет, ответь голосом" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new ElevenLabsSttClient({ apiKey: "xi-test", model: "scribe_v2" });
  const result = await client.transcribe({
    bytes: Buffer.from([1, 2, 3]),
    filename: "voice.ogg",
    mimeType: "audio/ogg",
  });

  assert.equal(result.text, "Привет, ответь голосом");
  assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/speech-to-text");
});

test("ElevenLabs TTS returns audio bytes for Telegram voice response", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    assert.equal(options.headers["xi-api-key"], "xi-test");
    assert.equal(JSON.parse(options.body).model_id, "eleven_multilingual_v2");
    return new Response(new Uint8Array([4, 5, 6]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new ElevenLabsTtsClient({
    apiKey: "xi-test",
    voiceId: "voice-123",
    model: "eleven_multilingual_v2",
  });
  const result = await client.synthesize({ text: "Тестовый ответ" });

  assert.equal(Buffer.compare(result.bytes, Buffer.from([4, 5, 6])), 0);
  assert.equal(result.mimeType, "audio/mpeg");
  assert.equal(result.filename, "assistant-reply.mp3");
  assert.match(calls[0].url, /\/v1\/text-to-speech\/voice-123/u);
});
