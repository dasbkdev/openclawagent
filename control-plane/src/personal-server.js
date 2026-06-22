/**
 * PERSONAL assistant process — a SEPARATE service (isolation level B) from the
 * work control-plane. Own port, own Postgres tables, own brain. Serves an
 * OpenAI-compatible endpoint that a rebranded OpenClaw desktop points at, plus a
 * personal activation endpoint. Nothing here imports the work assistant or
 * work integrations.
 */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClaudeClientFromEnv } from "./assistant/claude-client.js";
import { createVoyageClientFromEnv } from "./integrations/voyage-client.js";
import { loadEnvFile } from "./infra/env.js";
import { createSetupService } from "./setup/setup-service.js";
import { PersonalPgStore, PersonalMemStore } from "./personal/personal-store.js";
import { PersonalIdentityPgStore, PersonalIdentityMemStore } from "./personal/personal-identity.js";
import { answerPersonalAssistant } from "./personal/personal-assistant.js";
import { createPersonalRouter } from "./personal/personal-router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
loadEnvFile({ projectRoot });
const setupService = createSetupService({ projectRoot });
await setupService.applyToEnv();

const port = Number(process.env.PERSONAL_PORT || 3100);
const host = process.env.PERSONAL_HOST || "127.0.0.1";

const { store, identity } = await createPersonalBackends(process.env);
await store.ensureSchema();
await identity.ensureSchema();

const router = createPersonalRouter({
  store,
  identity,
  getClaudeClient: () => createClaudeClientFromEnv(),
  getVoyageClient: () => createVoyageClientFromEnv(),
  answerPersonalAssistant,
  adminTelegramIds: String(process.env.PERSONAL_ADMIN_TELEGRAM_IDS || process.env.DEVELOPER_TELEGRAM_IDS || "984834133"),
});

http.createServer(router).listen(port, host, () => {
  console.log(`company-personal-assistant listening on http://${host}:${port}`);
});

async function createPersonalBackends(env) {
  const connectionString = env.CONTROL_PLANE_DATABASE_URL || env.DATABASE_URL;
  if (String(env.CONTROL_PLANE_STORE || "").toLowerCase() === "postgres" && connectionString) {
    const pg = await import("pg");
    const Pool = pg.default?.Pool || pg.Pool;
    const pool = new Pool({ connectionString, max: Number(env.PERSONAL_PG_POOL_MAX || 4), idleTimeoutMillis: 30000 });
    return { store: new PersonalPgStore({ pool }), identity: new PersonalIdentityPgStore({ pool }) };
  }
  return { store: new PersonalMemStore(), identity: new PersonalIdentityMemStore() };
}
