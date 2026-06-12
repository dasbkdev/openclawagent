import { createSetupService } from "/opt/company-control-plane/src/setup/setup-service.js";
import { createPlatrumClientFromEnv } from "/opt/company-control-plane/src/connectors/platrum-client.js";
import { createBitrixClientFromEnv } from "/opt/company-control-plane/src/connectors/bitrix-client.js";
import fs from "node:fs";

const setupService = createSetupService({ projectRoot: "/opt/company-control-plane" });
await setupService.applyToEnv(process.env, { overwrite: true });
const state = JSON.parse(fs.readFileSync("/var/lib/company-control-plane/control-plane.json", "utf8"));
const user = state.users.find((u) => u.id === "u-pm-3");

const platrum = createPlatrumClientFromEnv();
const pt = await platrum.getUserTasks({ user, limit: 50 });
console.log("PLATRUM:", pt.platrumUserId, "tasks:", pt.tasks.length, pt.note ?? "");
for (const t of pt.tasks.slice(0, 5)) console.log("  -", t.statusLabel, "|", String(t.title).slice(0, 60));

const bitrix = createBitrixClientFromEnv();
const bt = await bitrix.getUserTasks({ user, limit: 50 });
console.log("BITRIX:", bt.bitrixUserId, "tasks:", bt.tasks.length, bt.note ?? "");
for (const t of bt.tasks.slice(0, 5)) console.log("  -", t.statusLabel ?? t.status, "|", String(t.title).slice(0, 60));
