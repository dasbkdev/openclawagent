import fs from "node:fs";
const s = JSON.parse(fs.readFileSync("/var/lib/company-control-plane/control-plane.json", "utf8"));

console.log("=== DEVICE AGENTS ===");
for (const a of s.deviceAgents || []) {
  console.log(a.deviceId, "| user:", a.userId, "| ver:", a.agentVersion, "| status:", a.status,
    "| lastSeen:", a.lastSeenAt, "| caps:", JSON.stringify(a.capabilities || []));
}

console.log("\n=== RECENT DEVICE COMMANDS (last 12) ===");
const cmds = (s.deviceCommands || []).slice(-12);
for (const c of cmds) {
  console.log(c.id?.slice(0,16), "|", c.type, "| status:", c.status,
    "| created:", c.createdAt, "| claimed:", c.claimedAt || "-", "| completed:", c.completedAt || "-",
    "| attempts:", c.attempts, "| err:", c.error || "-");
}
const now = Date.now();
console.log("\nserver time:", new Date(now).toISOString());
