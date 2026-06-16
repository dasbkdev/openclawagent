import fs from "node:fs/promises";
import path from "node:path";
import { validation } from "../domain/errors.js";
import { resolveDefaultDataFile } from "../infra/json-store.js";
import { applyClaudeModelPolicyToEnv, buildClaudeModelPolicy } from "./claude-model-policy.js";
import { SecretStore } from "./secret-store.js";

const SECRET_NAMES = [
  "telegramBotToken",
  "kickidlerAccessToken",
  "kickidlerRefreshToken",
  "kickidlerUsername",
  "kickidlerPassword",
  "platrumUsername",
  "platrumPassword",
  "bitrixWebhookUrl",
  "claudeApiKey",
  "googleOAuthClientJson",
  "tokenUsageIngestToken",
  "elevenLabsApiKey",
  "sttApiKey",
  "yougileApiKey",
  "voyageApiKey",
];

const SETTING_ENV_MAP = {
  bootstrapOwnerTelegramId: "BOOTSTRAP_OWNER_TELEGRAM_ID",
  kickidlerBaseUrl: ["METRICON_BASE_URL", "KICKIDLER_BASE_URL"],
  platrumBaseUrl: "PLATRUM_BASE_URL",
  tokenReportRecipientTelegramId: "TOKEN_USAGE_REPORT_TELEGRAM_ID",
  voiceAssistantEnabled: "VOICE_ASSISTANT_ENABLED",
  voiceReplyMode: "VOICE_REPLY_MODE",
  sttProvider: "STT_PROVIDER",
  sttModel: "STT_MODEL",
  sttLanguageCode: "STT_LANGUAGE_CODE",
  elevenLabsVoiceId: "ELEVENLABS_VOICE_ID",
  elevenLabsTtsModel: "ELEVENLABS_TTS_MODEL",
  elevenLabsOutputFormat: "ELEVENLABS_OUTPUT_FORMAT",
  yougileEnabled: "YOUGILE_ENABLED",
  yougileBaseUrl: "YOUGILE_BASE_URL",
};

const SECRET_ENV_MAP = {
  telegramBotToken: ["TELEGRAM_BOT_TOKEN"],
  kickidlerAccessToken: ["METRICON_ACCESS_TOKEN", "KICKIDLER_ACCESS_TOKEN"],
  kickidlerRefreshToken: ["METRICON_REFRESH_TOKEN", "KICKIDLER_REFRESH_TOKEN"],
  kickidlerUsername: ["METRICON_USERNAME", "KICKIDLER_USERNAME", "METRICON_EMAIL", "KICKIDLER_EMAIL"],
  kickidlerPassword: ["METRICON_PASSWORD", "KICKIDLER_PASSWORD"],
  platrumUsername: ["PLATRUM_USERNAME"],
  platrumPassword: ["PLATRUM_PASSWORD"],
  bitrixWebhookUrl: ["BITRIX_WEBHOOK_URL"],
  claudeApiKey: ["CLAUDE_API_KEY", "ANTHROPIC_API_KEY"],
  tokenUsageIngestToken: ["TOKEN_USAGE_INGEST_TOKEN"],
  elevenLabsApiKey: ["ELEVENLABS_API_KEY"],
  sttApiKey: ["STT_API_KEY"],
  yougileApiKey: ["YOUGILE_API_KEY"],
  voyageApiKey: ["VOYAGE_API_KEY"],
};

const DEFAULT_TOKEN_REPORT_RECIPIENT_TELEGRAM_ID = "984834133";

export class SetupService {
  constructor({ configPath, secretStore }) {
    this.configPath = configPath;
    this.secretStore = secretStore;
  }

  async status() {
    const config = await this.loadConfig();
    const secrets = await this.secretStore.describeSecrets(SECRET_NAMES);
    const settings = effectiveSettings(config.settings);
    return {
      configured: isConfigured({ settings, secrets }),
      settings,
      secrets,
      modelPolicy: buildClaudeModelPolicy(),
      paths: {
        configPath: this.configPath,
        secretsPath: this.secretStore.filePath,
        keyPath: this.secretStore.keyPath,
      },
    };
  }

  async saveSetup(payload) {
    const normalized = normalizeSetupPayload(payload);
    const config = await this.loadConfig();
    config.updatedAt = new Date().toISOString();
    config.settings = {
      ...effectiveSettings(config.settings),
      ...normalized.settings,
    };
    await this.saveConfig(config);

    for (const [name, value] of Object.entries(normalized.secrets)) {
      await this.secretStore.writeSecret(name, value);
    }
    for (const name of normalized.clearSecrets) {
      await this.secretStore.deleteSecret(name);
    }

    await this.applyToEnv(process.env, { overwrite: true });
    return await this.status();
  }

  async saveMetriconTokens({ accessToken, refreshToken }) {
    if (accessToken) {
      await this.secretStore.writeSecret("kickidlerAccessToken", accessToken);
    }
    if (refreshToken) {
      await this.secretStore.writeSecret("kickidlerRefreshToken", refreshToken);
    }
    await this.applyToEnv(process.env, { overwrite: true });
    return await this.status();
  }

  async applyToEnv(env = process.env, { overwrite = false } = {}) {
    const config = await this.loadConfig();
    applyClaudeModelPolicyToEnv(env);
    const settings = effectiveSettings(config.settings);

    for (const [settingName, envNames] of Object.entries(SETTING_ENV_MAP)) {
      const value = settings?.[settingName];
      for (const envName of Array.isArray(envNames) ? envNames : [envNames]) {
        if (value && (overwrite || !env[envName])) {
          env[envName] = value;
        }
      }
    }

    for (const [secretName, envNames] of Object.entries(SECRET_ENV_MAP)) {
      const value = await this.secretStore.readSecret(secretName);
      if (!value) {
        continue;
      }
      for (const envName of envNames) {
        if (overwrite || !env[envName]) {
          env[envName] = value;
        }
      }
    }
  }

  async loadConfig() {
    try {
      const raw = await fs.readFile(this.configPath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        version: parsed.version || 1,
        updatedAt: parsed.updatedAt || null,
        settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
      };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      return { version: 1, updatedAt: null, settings: {} };
    }
  }

  async saveConfig(config) {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    const tempPath = `${this.configPath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tempPath, this.configPath);
  }
}

export function createSetupService({ projectRoot, env = process.env } = {}) {
  const paths = resolveSetupPaths({ projectRoot, env });
  return new SetupService({
    configPath: paths.configPath,
    secretStore: new SecretStore({
      keyPath: paths.keyPath,
      filePath: paths.secretsPath,
    }),
  });
}

export function resolveSetupPaths({ projectRoot, env = process.env } = {}) {
  const dataDir =
    env.CONTROL_PLANE_CONFIG_DIR ||
    path.dirname(resolveDefaultDataFile(projectRoot || process.cwd(), env));
  return {
    dataDir,
    configPath: path.join(dataDir, "runtime-config.json"),
    keyPath: path.join(dataDir, "secrets.key"),
    secretsPath: path.join(dataDir, "secrets.json"),
  };
}

function normalizeSetupPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw validation("Setup payload must be a JSON object");
  }

  const settings = {};
  copyOptionalString(payload, settings, "bootstrapOwnerTelegramId");
  copyOptionalString(payload, settings, "kickidlerBaseUrl");
  copyOptionalString(payload, settings, "platrumBaseUrl");
  copyOptionalString(payload, settings, "tokenReportRecipientTelegramId");
  copyOptionalString(payload, settings, "voiceAssistantEnabled");
  copyOptionalString(payload, settings, "voiceReplyMode");
  copyOptionalString(payload, settings, "sttProvider");
  copyOptionalString(payload, settings, "sttModel");
  copyOptionalString(payload, settings, "sttLanguageCode");
  copyOptionalString(payload, settings, "elevenLabsVoiceId");
  copyOptionalString(payload, settings, "elevenLabsTtsModel");
  copyOptionalString(payload, settings, "elevenLabsOutputFormat");
  copyOptionalString(payload, settings, "yougileEnabled");
  copyOptionalString(payload, settings, "yougileBaseUrl");

  if (settings.kickidlerBaseUrl && !isHttpUrl(settings.kickidlerBaseUrl)) {
    throw validation("kickidlerBaseUrl must be a valid http(s) URL");
  }
  if (settings.platrumBaseUrl && !isHttpUrl(settings.platrumBaseUrl)) {
    throw validation("platrumBaseUrl must be a valid http(s) URL");
  }
  if (settings.yougileBaseUrl && !isHttpUrl(settings.yougileBaseUrl)) {
    throw validation("yougileBaseUrl must be a valid http(s) URL");
  }
  if (
    settings.tokenReportRecipientTelegramId &&
    !/^\d{4,20}$/u.test(settings.tokenReportRecipientTelegramId)
  ) {
    throw validation("tokenReportRecipientTelegramId must be a numeric Telegram id");
  }
  if (settings.voiceAssistantEnabled && !["true", "false"].includes(settings.voiceAssistantEnabled)) {
    throw validation("voiceAssistantEnabled must be true or false");
  }
  if (settings.voiceReplyMode && !["on_request", "always_text", "always_voice"].includes(settings.voiceReplyMode)) {
    throw validation("voiceReplyMode must be on_request, always_text, or always_voice");
  }
  if (settings.sttProvider && !["elevenlabs", "openai"].includes(settings.sttProvider)) {
    throw validation("sttProvider must be elevenlabs or openai");
  }
  if (settings.yougileEnabled && !["true", "false"].includes(settings.yougileEnabled)) {
    throw validation("yougileEnabled must be true or false");
  }

  const secrets = {};
  for (const name of [
    "telegramBotToken",
    "kickidlerAccessToken",
    "kickidlerRefreshToken",
    "kickidlerUsername",
    "kickidlerPassword",
    "platrumUsername",
    "platrumPassword",
    "bitrixWebhookUrl",
    "claudeApiKey",
    "tokenUsageIngestToken",
    "elevenLabsApiKey",
    "sttApiKey",
    "yougileApiKey",
  ]) {
    copyOptionalString(payload, secrets, name);
  }

  if (secrets.bitrixWebhookUrl && !isHttpUrl(secrets.bitrixWebhookUrl)) {
    throw validation("bitrixWebhookUrl must be a valid http(s) URL");
  }

  if (payload.googleOAuthClientJson !== undefined && String(payload.googleOAuthClientJson).trim()) {
    secrets.googleOAuthClientJson = normalizeGoogleOAuthJson(payload.googleOAuthClientJson);
  }

  const clearSecrets = Array.isArray(payload.clearSecrets)
    ? payload.clearSecrets.filter((name) => SECRET_NAMES.includes(name))
    : [];

  return { settings, secrets, clearSecrets };
}

function copyOptionalString(from, to, key) {
  if (from[key] === undefined || from[key] === null) {
    return;
  }
  const value = String(from[key]).trim();
  if (value) {
    to[key] = value;
  }
}

function effectiveSettings(settings = {}) {
  return {
    tokenReportRecipientTelegramId: DEFAULT_TOKEN_REPORT_RECIPIENT_TELEGRAM_ID,
    voiceAssistantEnabled: "true",
    voiceReplyMode: "on_request",
    sttProvider: "elevenlabs",
    sttModel: "scribe_v2",
    sttLanguageCode: "",
    elevenLabsVoiceId: "",
    elevenLabsTtsModel: "eleven_multilingual_v2",
    elevenLabsOutputFormat: "mp3_44100_128",
    yougileEnabled: "false",
    yougileBaseUrl: "https://yougile.com/api-v2",
    ...settings,
  };
}

function normalizeGoogleOAuthJson(value) {
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw validation("googleOAuthClientJson must contain valid JSON");
  }

  const client = parsed.installed || parsed.web || parsed;
  if (!client.client_id) {
    throw validation("Google OAuth JSON must include client_id");
  }
  return JSON.stringify(parsed, null, 2);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isConfigured({ settings, secrets }) {
  return Boolean(
    settings?.bootstrapOwnerTelegramId &&
      settings?.kickidlerBaseUrl &&
      settings?.platrumBaseUrl &&
      secrets.telegramBotToken?.configured &&
      secrets.claudeApiKey?.configured &&
      secrets.googleOAuthClientJson?.configured &&
      (secrets.kickidlerAccessToken?.configured ||
        secrets.kickidlerRefreshToken?.configured ||
        (secrets.kickidlerUsername?.configured && secrets.kickidlerPassword?.configured)) &&
      secrets.platrumUsername?.configured &&
      secrets.platrumPassword?.configured,
  );
}
