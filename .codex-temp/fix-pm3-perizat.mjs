// One-off production fix: resolve u-pm-3 (Perizat) in Platrum/Bitrix/Metricon
// using the company-wide service accounts, and persist mappings into state.
// Run: set -a; . /etc/company-control-plane/control-plane.env; set +a; node fix-pm3-perizat.mjs
import { createSetupService } from "/opt/company-control-plane/src/setup/setup-service.js";
import { createPlatrumClientFromEnv } from "/opt/company-control-plane/src/connectors/platrum-client.js";
import { createBitrixClientFromEnv } from "/opt/company-control-plane/src/connectors/bitrix-client.js";
import { JsonStore } from "/opt/company-control-plane/src/infra/json-store.js";
import fs from "node:fs/promises";

const STATE = "/var/lib/company-control-plane/control-plane.json";
const setupService = createSetupService({ projectRoot: "/opt/company-control-plane" });
await setupService.applyToEnv(process.env, { overwrite: true });

const backup = `${STATE}.pm3-fix-backup-${Date.now()}`;
await fs.copyFile(STATE, backup);
console.log("backup:", backup);

const norm = (v) => String(v || "").toLowerCase().replace(/ё/gu, "е").trim();

// --- Platrum ---
const platrum = createPlatrumClientFromEnv();
let platrumMatch = null;
try {
  const users = await platrum.getUsers();
  const matches = users.filter((u) => {
    const hay = [u.username, u.email, u.full_name, u.first_name, u.last_name].map(norm).join(" ");
    return hay.includes("перизат") || hay.includes("perizat") || hay.includes("усенкулова");
  });
  console.log("platrum candidates:", matches.map((u) => `${u.id}:${u.username}:${u.full_name ?? ""}`));
  if (matches.length === 1) platrumMatch = matches[0];
} catch (e) {
  console.log("platrum error:", e.message);
}

// --- Bitrix ---
const bitrix = createBitrixClientFromEnv();
let bitrixMatch = null;
try {
  const found = await bitrix.callMethod("user.search", { FILTER: { FIND: "Перизат" } });
  const list = Array.isArray(found?.result) ? found.result : Array.isArray(found) ? found : [];
  console.log("bitrix candidates:", list.map((u) => `${u.ID}:${u.NAME} ${u.LAST_NAME}`));
  if (list.length === 1) bitrixMatch = list[0];
} catch (e) {
  console.log("bitrix error:", e.message);
}

// --- Persist ---
const store = new JsonStore(STATE, () => ({}));
await store.update((state) => {
  const user = state.users.find((u) => u.id === "u-pm-3");
  console.log("before:", JSON.stringify({
    displayName: user.displayName,
    platrumUserId: user.platrumUserId ?? null,
    bitrixUserId: user.bitrixUserId ?? null,
    kickidlerEmployeeId: user.kickidlerEmployeeId ?? null,
    telegram: user.telegram ? { username: user.telegram.username } : null,
  }));
  user.displayName = "Перизат Усенкулова";
  if (platrumMatch) {
    user.platrumUserId = Number(platrumMatch.id);
    user.platrumUsername = platrumMatch.username ?? null;
  }
  if (bitrixMatch) {
    user.bitrixUserId = Number(bitrixMatch.ID);
  }
  // Confirmed live from Metricon employees/available: 76 = Перизат Усенкулова
  user.kickidlerEmployeeId = 76;
  state.auditLog ??= [];
  state.auditLog.push({
    id: `audit-${Date.now()}`,
    actorUserId: "u-nikolay",
    action: "user.mapping.manual_fix",
    target: { userId: "u-pm-3" },
    metadata: {
      platrumUserId: user.platrumUserId ?? null,
      bitrixUserId: user.bitrixUserId ?? null,
      kickidlerEmployeeId: user.kickidlerEmployeeId,
    },
    createdAt: new Date().toISOString(),
  });
  console.log("after:", JSON.stringify({
    displayName: user.displayName,
    platrumUserId: user.platrumUserId ?? null,
    platrumUsername: user.platrumUsername ?? null,
    bitrixUserId: user.bitrixUserId ?? null,
    kickidlerEmployeeId: user.kickidlerEmployeeId,
  }));
});
console.log("DONE");
