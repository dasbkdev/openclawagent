import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClaudeClientFromEnv } from "./assistant/claude-client.js";
import { createBitrixClientFromEnv } from "./connectors/bitrix-client.js";
import { createKickidlerClientFromEnv } from "./connectors/kickidler-client.js";
import { createPlatrumClientFromEnv } from "./connectors/platrum-client.js";
import { createGoogleOAuthService } from "./integrations/google-oauth.js";
import { loadEnvFile } from "./infra/env.js";
import { createInitialState } from "./infra/seed.js";
import { JsonStore, resolveDefaultDataFile } from "./infra/json-store.js";
import { createSetupService } from "./setup/setup-service.js";
import { TELEGRAM_BOT_COMMANDS } from "./telegram/bot-commands.js";
import { sendDueDailyAssistantMessages } from "./telegram/daily-assistant-reporter.js";
import { processTelegramUpdate } from "./telegram/handler.js";
import { TelegramBotApi } from "./telegram/telegram-api.js";
import { sendDueTokenUsageReports } from "./telegram/token-usage-reporter.js";
import { createVoiceServiceFromEnv } from "./integrations/voice-service.js";
import { runDueMemorySummaries } from "./domain/assistant-summaries.js";
import { expireStaleAssistantLoops } from "./domain/assistant-open-loops.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
loadEnvFile({ projectRoot });
const setupService = createSetupService({ projectRoot });
await setupService.applyToEnv();

const store = new JsonStore(resolveDefaultDataFile(projectRoot), () => createInitialState());
const googleOAuthService = createGoogleOAuthService({ setupService });
const createMetriconClient = async () => {
  await setupService.applyToEnv(process.env, { overwrite: true });
  return createKickidlerClientFromEnv(process.env, {
    onTokenRefresh: async ({ accessToken, refreshToken }) => {
      await setupService.saveMetriconTokens({ accessToken, refreshToken });
    },
  });
};

let offset = Number(process.env.TELEGRAM_UPDATE_OFFSET || 0) || undefined;
let nextMissingTokenLogAt = 0;
let commandsSyncedForToken = null;

console.log("telegram bot polling started");

while (true) {
  try {
    await setupService.applyToEnv();
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      const now = Date.now();
      if (now >= nextMissingTokenLogAt) {
        console.log("waiting for TELEGRAM_BOT_TOKEN in setup wizard");
        nextMissingTokenLogAt = now + 60000;
      }
      await sleep(10000);
      continue;
    }

    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegram = new TelegramBotApi({ token: telegramToken });
    if (commandsSyncedForToken !== telegramToken) {
      await telegram.setMyCommands({ commands: TELEGRAM_BOT_COMMANDS });
      commandsSyncedForToken = telegramToken;
      console.log(`telegram command menu synchronized (${TELEGRAM_BOT_COMMANDS.length} commands)`);
    }
    await sendDueTokenUsageReports({
      store,
      telegram,
      recipientTelegramId: process.env.TOKEN_USAGE_REPORT_TELEGRAM_ID || "984834133",
    });
    try {
      await runDueMemorySummaries({ store, claudeClient: createClaudeClientFromEnv() });
      await store.update((state) => {
        expireStaleAssistantLoops(state, { now: new Date() });
      });
    } catch (error) {
      console.error(
        "memory maintenance failed:",
        error instanceof Error ? error.message : error,
      );
    }
    await sendDueDailyAssistantMessages({
      store,
      telegram,
      kickidlerClient: await createMetriconClient(),
      bitrixClient: createBitrixClientFromEnv(),
      platrumClient: createPlatrumClientFromEnv(),
      googleOAuthService,
    });
    const updates = await telegram.getUpdates({ offset, timeout: 25 });
    for (const update of updates) {
      // Advance the offset before processing so a "poison" update can
      // never cause an infinite reprocessing loop.
      offset = update.update_id + 1;
      await processTelegramUpdate({
        update,
        store,
        telegram,
        googleOAuthService,
        buildMessageDeps: async () => ({
          kickidlerClient: await createMetriconClient(),
          bitrixClient: createBitrixClientFromEnv(),
          platrumClient: createPlatrumClientFromEnv(),
          claudeClient: createClaudeClientFromEnv(),
          voiceService: createVoiceServiceFromEnv(),
        }),
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    await sleep(3000);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
