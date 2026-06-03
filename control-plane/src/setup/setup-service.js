import fs from "node:fs/promises";
import path from "node:path";
import { validation } from "../domain/errors.js";
import { resolveDefaultDataFile } from "../infra/json-store.js";
import { applyClaudeModelPolicyToEnv, buildClaudeModelPolicy } from "./claude-model-policy.js";
import { SecretStore } from "./secret-store.js";

const SECRET_NAMES = [
  "telegramBotToken",
  "kickidlerAccessToken",
  "bitrixWebhookUrl",
  "claudeApiKey",
  "googleOAuthClientJson",
  "tokenUsageIngestToken",
];

const SETTING_ENV_MAP = {
  bootstrapOwnerTelegramId: "BOOTSTRAP_OWNER_TELEGRAM_ID",
  kickidlerBaseUrl: ["METRICON_BASE_URL", "KICKIDLER_BASE_URL"],
  tokenReportRecipientTelegramId: "TOKEN_USAGE_REPORT_TELEGRAM_ID",
};

const SECRET_ENV_MAP = {
  telegramBotToken: ["TELEGRAM_BOT_TOKEN"],
  kickidlerAccessToken: ["METRICON_ACCESS_TOKEN", "KICKIDLER_ACCESS_TOKEN"],
  bitrixWebhookUrl: ["BITRIX_WEBHOOK_URL"],
  claudeApiKey: ["CLAUDE_API_KEY", "ANTHROPIC_API_KEY"],
  tokenUsageIngestToken: ["TOKEN_USAGE_INGEST_TOKEN"],
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
  copyOptionalString(payload, settings, "tokenReportRecipientTelegramId");

  if (settings.kickidlerBaseUrl && !isHttpUrl(settings.kickidlerBaseUrl)) {
    throw validation("kickidlerBaseUrl must be a valid http(s) URL");
  }
  if (
    settings.tokenReportRecipientTelegramId &&
    !/^\d{4,20}$/u.test(settings.tokenReportRecipientTelegramId)
  ) {
    throw validation("tokenReportRecipientTelegramId must be a numeric Telegram id");
  }

  const secrets = {};
  for (const name of [
    "telegramBotToken",
    "kickidlerAccessToken",
    "bitrixWebhookUrl",
    "claudeApiKey",
    "tokenUsageIngestToken",
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
      secrets.telegramBotToken?.configured &&
      secrets.claudeApiKey?.configured &&
      secrets.googleOAuthClientJson?.configured &&
      secrets.kickidlerAccessToken?.configured &&
      secrets.bitrixWebhookUrl?.configured,
  );
}
