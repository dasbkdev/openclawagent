// One-off production fix: map u-pm-2 (Aizirek) in Platrum/Bitrix/Metricon.
// Metricon has two candidate records (29 "Айзирек пм", 75 "aizirek1@gmail.com");
// pick the one that actually reports activity.
import { createSetupService } from "/opt/company-control-plane/src/setup/setup-service.js";
import { createPlatrumClientFromEnv } from "/opt/company-control-plane/src/connectors/platrum-client.js";
import { createBitrixClientFromEnv } from "/opt/company-control-plane/src/connectors/bitrix-client.js";
import { createKickidlerClientFromEnv } from "/opt/company-control-plane/src/connectors/kickidler-client.js";
import { JsonStore } from "/opt/company-control-plane/src/infra/json-store.js";
import fs from "node:fs/promises";

const STATE = "/var/lib/company-control-plane/control-plane.json";
const setupService = createSetupService({ projectRoot: "/opt/company-control-plane" });
await setupService.applyToEnv(process.env, { overwrite: true });

const backup = `${STATE}.pm2-fix-backup-${Date.now()}`;
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
    return hay.includes("айзирек") || hay.includes("aizirek") || hay.includes("aisy");
  });
  console.log("platrum candidates:", matches.map((u) => `${u.id}:${u.username}:${u.full_name ?? ""}:${u.email ?? ""}`));
  if (matches.length === 1) platrumMatch = matches[0];
} catch (e) {
  console.log("platrum error:", e.message);
}

// --- Bitrix ---
const bitrix = createBitrixClientFromEnv();
let bitrixMatch = null;
try {
  const found = await bitrix.callMethod("user.search", { FILTER: { FIND: "Айзирек" } });
  const list = Array.isArray(found?.result) ? found.result : [];
  console.log("bitrix candidates:", list.map((u) => `${u.ID}:${u.NAME} ${u.LAST_NAME}:${u.EMAIL ?? ""}`));
  if (list.length === 1) bitrixMatch = list[0];
} catch (e) {
  console.log("bitrix error:", e.message);
}

// --- Metricon: which candidate record reports activity? ---
const metricon = createKickidlerClientFromEnv(process.env);
const to = new Date();
const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
let metriconId = null;
try {
  const report = await metricon.getActivitySummary({
    employeeIds: [29, 75],
    from: from.toISOString(),
    to: to.toISOString(),
  });
  for (const emp of report.employees) {
    console.log(
      "metricon", emp.kickidlerEmployeeId,
      "active:", emp.activeSeconds,
      "idle:", emp.idleSeconds,
      emp.error ? `error: ${JSON.stringify(emp.error).slice(0, 80)}` : "",
    );
  }
  const withData = report.employees.filter((emp) => Number(emp.activeSeconds) > 0 || Number(emp.idleSeconds) > 0);
  if (withData.length === 1) {
    metriconId = Number(withData[0].kickidlerEmployeeId);
  } else if (withData.length === 2) {
    metriconId = 29; // both report: prefer the named record "Айзирек пм"
  }
  console.log("chosen metricon id:", metriconId);
} catch (e) {
  console.log("metricon error:", e.message);
}

// --- Persist ---
const store = new JsonStore(STATE, () => ({}));
await store.update((state) => {
  const user = state.users.find((u) => u.id === "u-pm-2");
  console.log("before:", JSON.stringify({
    displayName: user.displayName,
    platrumUserId: user.platrumUserId ?? null,
    bitrixUserId: user.bitrixUserId ?? null,
    kickidlerEmployeeId: user.kickidlerEmployeeId ?? null,
  }));
  const bitrixFullName = bitrixMatch
    ? [bitrixMatch.NAME, bitrixMatch.LAST_NAME].filter(Boolean).join(" ")
    : null;
  user.displayName = bitrixFullName || "Айзирек";
  if (platrumMatch) {
    user.platrumUserId = Number(platrumMatch.id);
    user.platrumUsername = platrumMatch.username ?? null;
  }
  if (bitrixMatch) {
    user.bitrixUserId = Number(bitrixMatch.ID);
  }
  if (metriconId) {
    user.kickidlerEmployeeId = metriconId;
  }
  state.auditLog ??= [];
  state.auditLog.push({
    id: `audit-${Date.now()}`,
    actorUserId: "u-nikolay",
    action: "user.mapping.manual_fix",
    target: { userId: "u-pm-2" },
    metadata: {
      platrumUserId: user.platrumUserId ?? null,
      bitrixUserId: user.bitrixUserId ?? null,
      kickidlerEmployeeId: user.kickidlerEmployeeId ?? null,
    },
    createdAt: new Date().toISOString(),
  });
  console.log("after:", JSON.stringify({
    displayName: user.displayName,
    platrumUserId: user.platrumUserId ?? null,
    platrumUsername: user.platrumUsername ?? null,
    bitrixUserId: user.bitrixUserId ?? null,
    kickidlerEmployeeId: user.kickidlerEmployeeId ?? null,
  }));
});
console.log("DONE");
