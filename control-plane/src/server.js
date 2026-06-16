import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter } from "./api/router.js";
import { createClaudeClientFromEnv } from "./assistant/claude-client.js";
import { createBitrixClientFromEnv } from "./connectors/bitrix-client.js";
import { createKickidlerClientFromEnv } from "./connectors/kickidler-client.js";
import { createPlatrumClientFromEnv } from "./connectors/platrum-client.js";
import { createGoogleOAuthService } from "./integrations/google-oauth.js";
import { createVoiceServiceFromEnv } from "./integrations/voice-service.js";
import { createVoyageClientFromEnv } from "./integrations/voyage-client.js";
import { createEmbeddingStore } from "./infra/embedding-store.js";
import { loadEnvFile } from "./infra/env.js";
import { createInitialState } from "./infra/seed.js";
import { createStore } from "./infra/store-factory.js";
import { createSetupService } from "./setup/setup-service.js";
import { TelegramBotApi } from "./telegram/telegram-api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
loadEnvFile({ projectRoot });
const setupService = createSetupService({ projectRoot });
await setupService.applyToEnv();

const port = Number(process.env.PORT || 3099);
const host = process.env.HOST || "127.0.0.1";

const store = await createStore({ projectRoot, seedFactory: () => createInitialState() });
const getKickidlerClient = async () => {
  await setupService.applyToEnv(process.env, { overwrite: true });
  return createKickidlerClientFromEnv(process.env, {
    onTokenRefresh: async ({ accessToken, refreshToken }) => {
      await setupService.saveMetriconTokens({ accessToken, refreshToken });
    },
  });
};
const getBitrixClient = () => createBitrixClientFromEnv();
const getPlatrumClient = () => createPlatrumClientFromEnv();
const getTelegramApi = () => new TelegramBotApi({ token: process.env.TELEGRAM_BOT_TOKEN });
const getVoiceService = () => createVoiceServiceFromEnv();
const getClaudeClient = () => createClaudeClientFromEnv();
const getVoyageClient = () => createVoyageClientFromEnv();
const googleOAuthService = createGoogleOAuthService({ setupService });
let embeddingStore = null;
try {
  embeddingStore = await createEmbeddingStore({ projectRoot });
} catch (error) {
  console.error("embedding store unavailable:", error instanceof Error ? error.message : error);
}
const router = createRouter({
  store,
  getKickidlerClient,
  getBitrixClient,
  getPlatrumClient,
  getTelegramApi,
  getVoiceService,
  getClaudeClient,
  getVoyageClient,
  embeddingStore,
  googleOAuthService,
  setupService,
});

const server = http.createServer(router);

server.listen(port, host, () => {
  const kickidlerClient = createKickidlerClientFromEnv(process.env);
  const bitrixClient = getBitrixClient();
  const platrumClient = getPlatrumClient();
  console.log(`company-control-plane listening on http://${host}:${port}`);
  console.log(`setup wizard: http://${host}:${port}/setup`);
  console.log(`data file: ${store.filePath}`);
  console.log(`metricon connector: ${kickidlerClient.source} configured=${kickidlerClient.configured}`);
  console.log(`platrum connector: ${platrumClient.source} configured=${platrumClient.configured} readOnly=${platrumClient.readOnly}`);
  console.log(`bitrix connector: ${bitrixClient.source} configured=${bitrixClient.configured}`);
});
