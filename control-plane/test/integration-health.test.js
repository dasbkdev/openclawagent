import assert from "node:assert/strict";
import test from "node:test";
import { buildIntegrationsHealth } from "../src/domain/integration-health.js";

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

test("buildIntegrationsHealth reports ok for healthy mock clients", async () => {
  const claudeClient = {
    configured: true,
    healthCheck: async () => ({ ok: true, configured: true, model: "claude-sonnet-4-6", message: "Claude API is available." }),
  };
  const telegramApi = {
    getMe: async () => ({ id: 123, username: "starlab_bot" }),
  };
  const kickidlerClient = { configured: true, source: "metricon" };
  const platrumClient = { configured: true, source: "platrum", getMe: async () => ({ id: 1, email: "owner@example.com" }) };
  const bitrixClient = { configured: true, source: "bitrix", callMethod: async () => ({ result: { ok: true } }) };
  const voiceService = { enabled: true, canSynthesize: true, canTranscribe: true };
  const googleOAuthService = { readClientConfig: async () => ({ clientId: "abc", clientSecret: "shh" }) };

  const result = await buildIntegrationsHealth({
    claudeClient,
    telegramApi,
    kickidlerClient,
    platrumClient,
    bitrixClient,
    voiceService,
    googleOAuthService,
  });

  assert.ok(result.checkedAt);
  assert.equal(result.integrations.claude.ok, true);
  assert.equal(result.integrations.telegram.ok, true);
  assert.equal(result.integrations.metricon.ok, true);
  assert.equal(result.integrations.platrum.ok, true);
  assert.equal(result.integrations.bitrix.ok, true);
  assert.equal(result.integrations.voice.ok, true);
  assert.equal(result.integrations.google.ok, true);

  // No secrets leaked.
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("shh"), false);
});

test("buildIntegrationsHealth reports configured:false for unconfigured/mock clients", async () => {
  const result = await buildIntegrationsHealth({
    claudeClient: { configured: false, healthCheck: async () => ({ ok: false, configured: false, message: "Claude API key is not configured." }) },
    telegramApi: null,
    kickidlerClient: { configured: false, source: "mock" },
    platrumClient: { configured: false, source: "mock" },
    bitrixClient: { configured: false, source: "mock" },
    voiceService: { enabled: true, canSynthesize: false, canTranscribe: false },
    googleOAuthService: { readClientConfig: async () => { throw new Error("Google OAuth client JSON is not configured in setup wizard"); } },
  });

  assert.equal(result.integrations.claude.ok, false);
  assert.equal(result.integrations.claude.configured, false);
  assert.equal(result.integrations.telegram.ok, false);
  assert.equal(result.integrations.telegram.configured, false);
  assert.equal(result.integrations.metricon.ok, false);
  assert.equal(result.integrations.metricon.configured, false);
  assert.equal(result.integrations.platrum.ok, false);
  assert.equal(result.integrations.bitrix.ok, false);
  assert.equal(result.integrations.voice.ok, false);
  assert.equal(result.integrations.google.ok, false);
});

test("buildIntegrationsHealth captures thrown errors as ok:false without throwing", async () => {
  const result = await buildIntegrationsHealth({
    claudeClient: {
      configured: true,
      healthCheck: async () => { throw new Error("Claude API request failed: HTTP 500"); },
    },
    telegramApi: {
      getMe: async () => { throw new Error("Telegram API getMe failed: Unauthorized"); },
    },
    kickidlerClient: { configured: true, source: "metricon" },
    platrumClient: { configured: true, source: "platrum", getMe: async () => { throw new Error("Platrum API request failed"); } },
    bitrixClient: { configured: true, source: "bitrix", callMethod: async () => { throw new Error("Bitrix REST call failed"); } },
    voiceService: { enabled: true, canSynthesize: true, canTranscribe: false },
    googleOAuthService: { readClientConfig: async () => { throw new Error("boom"); } },
  });

  assert.equal(result.integrations.claude.ok, false);
  assert.match(result.integrations.claude.message, /HTTP 500/);
  assert.equal(result.integrations.telegram.ok, false);
  assert.match(result.integrations.telegram.message, /Unauthorized/);
  assert.equal(result.integrations.platrum.ok, false);
  assert.equal(result.integrations.bitrix.ok, false);
  assert.equal(result.integrations.google.ok, false);
  // metricon has no cheap check, so it stays ok when configured.
  assert.equal(result.integrations.metricon.ok, true);
});

test("buildIntegrationsHealth treats slow checks as timeouts", async () => {
  const claudeClient = {
    configured: true,
    healthCheck: () => delay(50, { ok: true, configured: true, model: "claude-sonnet-4-6" }),
  };
  const telegramApi = {
    getMe: () => delay(50, { id: 1, username: "bot" }),
  };

  const result = await buildIntegrationsHealth({
    claudeClient,
    telegramApi,
    kickidlerClient: { configured: false, source: "mock" },
    platrumClient: { configured: false, source: "mock" },
    bitrixClient: { configured: false, source: "mock" },
    voiceService: { enabled: false },
    googleOAuthService: { readClientConfig: async () => { throw new Error("not configured"); } },
    timeoutMs: 5,
  });

  assert.equal(result.integrations.claude.ok, false);
  assert.match(result.integrations.claude.message, /timed out/);
  assert.equal(result.integrations.telegram.ok, false);
  assert.match(result.integrations.telegram.message, /timed out/);
});

test("buildIntegrationsHealth handles entirely missing clients gracefully", async () => {
  const result = await buildIntegrationsHealth({});
  for (const key of ["claude", "telegram", "metricon", "platrum", "bitrix", "voice", "google"]) {
    assert.equal(result.integrations[key].ok, false);
    assert.equal(typeof result.integrations[key].message, "string");
  }
});
