import { createSetupService } from "/opt/company-control-plane/src/setup/setup-service.js";
import { createPlatrumClientFromEnv } from "/opt/company-control-plane/src/connectors/platrum-client.js";
import { createBitrixClientFromEnv } from "/opt/company-control-plane/src/connectors/bitrix-client.js";
import { JsonStore } from "/opt/company-control-plane/src/infra/json-store.js";

const STATE = "/var/lib/company-control-plane/control-plane.json";
const setupService = createSetupService({ projectRoot: "/opt/company-control-plane" });
await setupService.applyToEnv(process.env, { overwrite: true });

const store = new JsonStore(STATE, () => ({}));
await store.update((state) => {
  const user = state.users.find((u) => u.id === "u-pm-2");
  user.displayName = user.displayName.replace(/\s+/gu, " ").trim();
  console.log("displayName:", JSON.stringify(user.displayName));
});

const state = await store.load();
const user = state.users.find((u) => u.id === "u-pm-2");

const platrum = createPlatrumClientFromEnv();
const pt = await platrum.getUserTasks({ user, limit: 50 });
console.log("PLATRUM:", pt.platrumUserId, "tasks:", pt.tasks.length, pt.note ?? "");

const bitrix = createBitrixClientFromEnv();
const bt = await bitrix.getUserTasks({ user, limit: 50 });
console.log("BITRIX:", bt.bitrixUserId, "tasks:", bt.tasks.length, bt.note ?? "");
for (const t of bt.tasks.slice(0, 3)) console.log("  -", t.statusLabel ?? t.status, "|", String(t.title).slice(0, 55));
