// Read-only production diagnostics: mappings + memory accumulation.
// Prints no secrets.
const fs = require("fs");
const s = JSON.parse(fs.readFileSync("/var/lib/company-control-plane/control-plane.json", "utf8"));

console.log("=== USERS ===");
for (const u of s.users || []) {
  console.log(
    u.id,
    "|",
    u.displayName,
    "| role:", u.role,
    "| platrumUserId:", u.platrumUserId ?? null,
    "| platrumUsername:", u.platrumUsername ?? null,
    "| metriconId:", u.kickidlerEmployeeId ?? null,
    "| bitrixId:", u.bitrixUserId ?? null,
    "| tg:", Boolean(u.telegram && u.telegram.telegramUserId),
  );
}

console.log("=== PROJECTS ===");
for (const p of s.projects || []) {
  console.log(p.id, "|", p.name, "| platrumProjectId:", p.platrumProjectId ?? null, "| members:", JSON.stringify(p.memberUserIds || []));
}

console.log("=== MEMORY ===");
const byUser = (arr, key = "userId") => {
  const out = {};
  for (const item of arr || []) out[item[key]] = (out[item[key]] || 0) + 1;
  return JSON.stringify(out);
};
console.log("assistantMemory:", (s.assistantMemory || []).length, byUser(s.assistantMemory));
console.log("assistantFacts:", (s.assistantFacts || []).length, byUser(s.assistantFacts));
console.log("assistantOpenLoops:", (s.assistantOpenLoops || []).length, byUser(s.assistantOpenLoops));
console.log("assistantDailySummaries:", (s.assistantDailySummaries || []).length, byUser(s.assistantDailySummaries));

console.log("=== GOOGLE ===");
const g = s.googleAccounts || s.google || null;
if (g) console.log(JSON.stringify(Object.keys(g)));
for (const u of s.users || []) {
  if (u.google) console.log(u.id, "google:", u.google.email || u.google.googleAccountEmail || "connected");
}
