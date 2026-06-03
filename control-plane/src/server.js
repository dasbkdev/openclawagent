import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter } from "./api/router.js";
import { createBitrixClientFromEnv } from "./connectors/bitrix-client.js";
import { createKickidlerClientFromEnv } from "./connectors/kickidler-client.js";
import { loadEnvFile } from "./infra/env.js";
import { createInitialState } from "./infra/seed.js";
import { JsonStore, resolveDefaultDataFile } from "./infra/json-store.js";
import { createSetupService } from "./setup/setup-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
loadEnvFile({ projectRoot });
const setupService = createSetupService({ projectRoot });
await setupService.applyToEnv();

const port = Number(process.env.PORT || 3099);
const host = process.env.HOST || "127.0.0.1";

const store = new JsonStore(resolveDefaultDataFile(projectRoot), () => createInitialState());
const getKickidlerClient = () => createKickidlerClientFromEnv();
const getBitrixClient = () => createBitrixClientFromEnv();
const router = createRouter({ store, getKickidlerClient, getBitrixClient, setupService });

const server = http.createServer(router);

server.listen(port, host, () => {
  const kickidlerClient = getKickidlerClient();
  const bitrixClient = getBitrixClient();
  console.log(`company-control-plane listening on http://${host}:${port}`);
  console.log(`setup wizard: http://${host}:${port}/setup`);
  console.log(`data file: ${store.filePath}`);
  console.log(`metricon connector: ${kickidlerClient.source} configured=${kickidlerClient.configured}`);
  console.log(`bitrix connector: ${bitrixClient.source} configured=${bitrixClient.configured}`);
});
