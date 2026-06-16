import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClaudeClientFromEnv } from "./assistant/claude-client.js";
import { createBitrixClientFromEnv } from "./connectors/bitrix-client.js";
import { createKickidlerClientFromEnv } from "./connectors/kickidler-client.js";
import { createPlatrumClientFromEnv } from "./connectors/platrum-client.js";
import { createGoogleOAuthService } from "./integrations/google-oauth.js";
import { loadEnvFile } from "./infra/env.js";
import { createInitialState } from "./infra/seed.js";
import { createStore } from "./infra/store-factory.js";
import { createSetupService } from "./setup/setup-service.js";
import { TELEGRAM_BOT_COMMANDS } from "./telegram/bot-commands.js";
import { sendDueDailyAssistantMessages } from "./telegram/daily-assistant-reporter.js";
import { processTelegramUpdate } from "./telegram/handler.js";
import { TelegramBotApi } from "./telegram/telegram-api.js";
import { sendDueTokenUsageReports } from "./telegram/token-usage-reporter.js";
import { exportObsidianVault } from "./domain/obsidian-export.js";
import { exportMemoryGraphSite } from "./domain/memory-graph-site.js";
import { createVoiceServiceFromEnv } from "./integrations/voice-service.js";
import { createVoyageClientFromEnv } from "./integrations/voyage-client.js";
import { createEmbeddingStore } from "./infra/embedding-store.js";
import { runDueMemorySummaries } from "./domain/assistant-summaries.js";
import { expireStaleAssistantLoops } from "./domain/assistant-open-loops.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
loadEnvFile({ projectRoot });
const setupService = createSetupService({ projectRoot });
await setupService.applyToEnv();

const store = await createStore({ projectRoot, seedFactory: () => createInitialState() });
const googleOAuthService = createGoogleOAuthService({ setupService });
// Embedding store for semantic memory — created once (holds its own DB pool).
// Never let it break boot if Postgres/voyage aren't ready.
let embeddingStore = null;
try {
  embeddingStore = await createEmbeddingStore({ projectRoot });
  console.log(`embedding store ready (${embeddingStore.backend})`);
} catch (error) {
  console.error("embedding store unavailable:", error instanceof Error ? error.message : error);
}
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
// Reporters take the state lock and may do network work; running them on
// every poll iteration starves user-triggered writes. Once a minute is
// plenty for daily schedules / token reports / memory summaries.
const REPORTERS_INTERVAL_MS = Number(process.env.BOT_REPORTERS_INTERVAL_MS || 60000);
let nextReportersRunAt = 0;
// Obsidian vault export feeds the web graph showcase; hourly is plenty.
const VAULT_EXPORT_INTERVAL_MS = Number(process.env.VAULT_EXPORT_INTERVAL_MS || 3600000);
let nextVaultExportAt = 0;
// Bounded concurrency for message processing — slow messages no longer block
// polling or other users.
const MAX_CONCURRENT_UPDATES = Number(process.env.BOT_MAX_CONCURRENT_UPDATES || 6);
const inFlight = new Set();

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
    if (Date.now() >= nextReportersRunAt) {
      nextReportersRunAt = Date.now() + REPORTERS_INTERVAL_MS;
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
      if (process.env.STARLAB_VAULT_DIR && Date.now() >= nextVaultExportAt) {
        nextVaultExportAt = Date.now() + VAULT_EXPORT_INTERVAL_MS;
        try {
          const state = await store.load();
          const { filesWritten } = await exportObsidianVault({
            state,
            dataFilePath: store.filePath,
            vaultDir: process.env.STARLAB_VAULT_DIR,
          });
          console.log(`obsidian vault exported (${filesWritten} files) -> ${process.env.STARLAB_VAULT_DIR}`);
          if (process.env.STARLAB_GRAPH_SITE_DIR) {
            const site = await exportMemoryGraphSite({
              state,
              dataFilePath: store.filePath,
              outDir: process.env.STARLAB_GRAPH_SITE_DIR,
            });
            console.log(`memory graph site exported (${site.nodes} nodes, ${site.links} links)`);
          }
        } catch (error) {
          console.error("vault export failed:", error instanceof Error ? error.message : error);
        }
      }
      await sendDueDailyAssistantMessages({
        store,
        telegram,
        kickidlerClient: await createMetriconClient(),
        bitrixClient: createBitrixClientFromEnv(),
        platrumClient: createPlatrumClientFromEnv(),
        googleOAuthService,
      });
    }
    const updates = await telegram.getUpdates({ offset, timeout: 25 });
    for (const update of updates) {
      // Advance the offset before processing so a "poison" update can
      // never cause an infinite reprocessing loop.
      offset = update.update_id + 1;
      // Process updates CONCURRENTLY (bounded) so one slow message — web
      // search (~1 min), a /task run (minutes), a heavy report — does not
      // block polling or other users. The loop keeps fetching updates while
      // long operations run in the background.
      const job = processTelegramUpdate({
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
          voyageClient: createVoyageClientFromEnv(),
          embeddingStore,
        }),
      })
        .catch((error) => console.error(`update ${update.update_id} failed:`, error instanceof Error ? error.message : error))
        .finally(() => inFlight.delete(job));
      inFlight.add(job);
      if (inFlight.size >= MAX_CONCURRENT_UPDATES) {
        // Backpressure: wait for the fastest in-flight job before claiming more.
        await Promise.race(inFlight);
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
