import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBitrixClientFromEnv } from "./connectors/bitrix-client.js";
import { createKickidlerClientFromEnv } from "./connectors/kickidler-client.js";
import { loadEnvFile } from "./infra/env.js";
import { createInitialState } from "./infra/seed.js";
import { JsonStore, resolveDefaultDataFile } from "./infra/json-store.js";
import { createSetupService } from "./setup/setup-service.js";
import { handleTelegramMessage } from "./telegram/handler.js";
import { TelegramBotApi } from "./telegram/telegram-api.js";
import { sendDueTokenUsageReports } from "./telegram/token-usage-reporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
loadEnvFile({ projectRoot });
const setupService = createSetupService({ projectRoot });
await setupService.applyToEnv();

const store = new JsonStore(resolveDefaultDataFile(projectRoot), () => createInitialState());

let offset = Number(process.env.TELEGRAM_UPDATE_OFFSET || 0) || undefined;
let nextMissingTokenLogAt = 0;

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

    const telegram = new TelegramBotApi({ token: process.env.TELEGRAM_BOT_TOKEN });
    await sendDueTokenUsageReports({
      store,
      telegram,
      recipientTelegramId: process.env.TOKEN_USAGE_REPORT_TELEGRAM_ID || "984834133",
    });
    const updates = await telegram.getUpdates({ offset, timeout: 25 });
    for (const update of updates) {
      offset = update.update_id + 1;
      if (update.message) {
        await handleTelegramMessage({
          store,
          telegram,
          kickidlerClient: createKickidlerClientFromEnv(),
          bitrixClient: createBitrixClientFromEnv(),
          message: update.message,
        });
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    await sleep(3000);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
