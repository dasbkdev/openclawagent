import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SecretStore } from "../src/setup/secret-store.js";
import { SetupService } from "../src/setup/setup-service.js";

test("SetupService saves service config with encrypted secrets and masked status", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccp-setup-"));
  try {
    const service = new SetupService({
      configPath: path.join(dir, "runtime-config.json"),
      secretStore: new SecretStore({
        keyPath: path.join(dir, "secrets.key"),
        filePath: path.join(dir, "secrets.json"),
      }),
    });

    const status = await service.saveSetup({
      bootstrapOwnerTelegramId: "123456789",
      telegramBotToken: "123456:telegram-secret",
      claudeApiKey: "sk-ant-test-secret",
      kickidlerBaseUrl: "https://kickidler.example.test",
      kickidlerAccessToken: "kickidler-secret-token",
      kickidlerRefreshToken: "kickidler-refresh-token",
      kickidlerUsername: "metricon@example.test",
      kickidlerPassword: "metricon-secret-password",
      platrumBaseUrl: "https://platrum.starlabit.com",
      platrumUsername: "maslov",
      platrumPassword: "platrum-secret-password",
      bitrixWebhookUrl: "https://example.bitrix24.ru/rest/1/webhook",
      tokenReportRecipientTelegramId: "984834133",
      tokenUsageIngestToken: "usage-ingest-secret",
      voiceAssistantEnabled: "true",
      voiceReplyMode: "on_request",
      sttProvider: "elevenlabs",
      sttApiKey: "stt-secret",
      sttModel: "scribe_v2",
      sttLanguageCode: "ru",
      elevenLabsApiKey: "elevenlabs-secret",
      elevenLabsVoiceId: "voice-123",
      elevenLabsTtsModel: "eleven_multilingual_v2",
      elevenLabsOutputFormat: "mp3_44100_128",
      yougileEnabled: "false",
      yougileBaseUrl: "https://yougile.com/api-v2",
      yougileApiKey: "yougile-secret",
      googleOAuthClientJson: JSON.stringify({
        installed: {
          client_id: "google-client-id",
          client_secret: "google-client-secret",
          redirect_uris: ["http://localhost"],
        },
      }),
    });

    assert.equal(status.configured, true);
    assert.equal(status.settings.bootstrapOwnerTelegramId, "123456789");
    assert.equal(status.settings.kickidlerBaseUrl, "https://kickidler.example.test");
    assert.equal(status.settings.platrumBaseUrl, "https://platrum.starlabit.com");
    assert.equal(status.settings.tokenReportRecipientTelegramId, "984834133");
    assert.equal(status.secrets.claudeApiKey.configured, true);
    assert.equal(status.secrets.kickidlerRefreshToken.configured, true);
    assert.equal(status.secrets.kickidlerUsername.configured, true);
    assert.equal(status.secrets.kickidlerPassword.configured, true);
    assert.equal(status.secrets.platrumUsername.configured, true);
    assert.equal(status.secrets.platrumPassword.configured, true);
    assert.equal(status.secrets.tokenUsageIngestToken.configured, true);
    assert.equal(status.secrets.elevenLabsApiKey.configured, true);
    assert.equal(status.secrets.sttApiKey.configured, true);
    assert.equal(status.secrets.yougileApiKey.configured, true);
    assert.equal(status.secrets.claudeApiKey.masked.includes("sk-ant-test-secret"), false);

    const rawSecrets = await fs.readFile(path.join(dir, "secrets.json"), "utf8");
    assert.equal(rawSecrets.includes("sk-ant-test-secret"), false);
    assert.equal(rawSecrets.includes("platrum-secret-password"), false);
    assert.equal(rawSecrets.includes("metricon-secret-password"), false);
    assert.equal(rawSecrets.includes("google-client-secret"), false);
    assert.equal(rawSecrets.includes("yougile-secret"), false);

    const env = {};
    await service.applyToEnv(env, { overwrite: true });
    assert.equal(env.BOOTSTRAP_OWNER_TELEGRAM_ID, "123456789");
    assert.equal(env.METRICON_BASE_URL, "https://kickidler.example.test");
    assert.equal(env.KICKIDLER_BASE_URL, "https://kickidler.example.test");
    assert.equal(env.PLATRUM_BASE_URL, "https://platrum.starlabit.com");
    assert.equal(env.PLATRUM_USERNAME, "maslov");
    assert.equal(env.PLATRUM_PASSWORD, "platrum-secret-password");
    assert.equal(env.TELEGRAM_BOT_TOKEN, "123456:telegram-secret");
    assert.equal(env.METRICON_ACCESS_TOKEN, "kickidler-secret-token");
    assert.equal(env.KICKIDLER_ACCESS_TOKEN, "kickidler-secret-token");
    assert.equal(env.METRICON_REFRESH_TOKEN, "kickidler-refresh-token");
    assert.equal(env.KICKIDLER_REFRESH_TOKEN, "kickidler-refresh-token");
    assert.equal(env.METRICON_USERNAME, "metricon@example.test");
    assert.equal(env.KICKIDLER_USERNAME, "metricon@example.test");
    assert.equal(env.METRICON_EMAIL, "metricon@example.test");
    assert.equal(env.KICKIDLER_EMAIL, "metricon@example.test");
    assert.equal(env.METRICON_PASSWORD, "metricon-secret-password");
    assert.equal(env.KICKIDLER_PASSWORD, "metricon-secret-password");
    assert.equal(env.BITRIX_WEBHOOK_URL, "https://example.bitrix24.ru/rest/1/webhook");
    assert.equal(env.CLAUDE_API_KEY, "sk-ant-test-secret");
    assert.equal(env.ANTHROPIC_API_KEY, "sk-ant-test-secret");
    assert.equal(env.TOKEN_USAGE_REPORT_TELEGRAM_ID, "984834133");
    assert.equal(env.TOKEN_USAGE_INGEST_TOKEN, "usage-ingest-secret");
    assert.equal(env.VOICE_ASSISTANT_ENABLED, "true");
    assert.equal(env.VOICE_REPLY_MODE, "on_request");
    assert.equal(env.STT_PROVIDER, "elevenlabs");
    assert.equal(env.STT_API_KEY, "stt-secret");
    assert.equal(env.STT_MODEL, "scribe_v2");
    assert.equal(env.STT_LANGUAGE_CODE, "ru");
    assert.equal(env.ELEVENLABS_API_KEY, "elevenlabs-secret");
    assert.equal(env.ELEVENLABS_VOICE_ID, "voice-123");
    assert.equal(env.ELEVENLABS_TTS_MODEL, "eleven_multilingual_v2");
    assert.equal(env.ELEVENLABS_OUTPUT_FORMAT, "mp3_44100_128");
    assert.equal(env.YOUGILE_ENABLED, "false");
    assert.equal(env.YOUGILE_BASE_URL, "https://yougile.com/api-v2");
    assert.equal(env.YOUGILE_API_KEY, "yougile-secret");
    assert.equal(env.ANTHROPIC_MODEL, "claude-sonnet-4-6");
    assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, "claude-sonnet-4-6");
    assert.equal(env.CLAUDE_MODEL, "claude-sonnet-4-6");
    assert.equal(env.OPENCLAW_DEFAULT_MODEL, "anthropic/claude-sonnet-4-6");
    assert.equal(status.modelPolicy.enforced, true);
    assert.equal(status.modelPolicy.openClawModel, "anthropic/claude-sonnet-4-6");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("SetupService enforces latest Sonnet env even when an older model is present", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccp-setup-model-"));
  try {
    const service = new SetupService({
      configPath: path.join(dir, "runtime-config.json"),
      secretStore: new SecretStore({
        keyPath: path.join(dir, "secrets.key"),
        filePath: path.join(dir, "secrets.json"),
      }),
    });

    const env = {
      ANTHROPIC_MODEL: "claude-3-5-sonnet-20241022",
      OPENCLAW_DEFAULT_MODEL: "anthropic/claude-3-5-sonnet-20241022",
    };
    await service.applyToEnv(env);

    assert.equal(env.ANTHROPIC_MODEL, "claude-sonnet-4-6");
    assert.equal(env.OPENCLAW_DEFAULT_MODEL, "anthropic/claude-sonnet-4-6");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("SetupService rejects invalid Google OAuth JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccp-setup-invalid-"));
  try {
    const service = new SetupService({
      configPath: path.join(dir, "runtime-config.json"),
      secretStore: new SecretStore({
        keyPath: path.join(dir, "secrets.key"),
        filePath: path.join(dir, "secrets.json"),
      }),
    });

    await assert.rejects(
      () =>
        service.saveSetup({
          googleOAuthClientJson: JSON.stringify({ installed: { client_secret: "missing-id" } }),
        }),
      /client_id/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
