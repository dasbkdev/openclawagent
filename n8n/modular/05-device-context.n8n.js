const fs = require("fs");

const input = $input.first().json;
if (input.skip || input.responseText && input.command?.name !== "/agents") return [{ json: { ...input, devices: { requested: false } } }];

const snapshot = readJson("/data/device-heartbeats.json", { devices: {}, totalReceived: 0 });
const targetIds = new Set((input.targetUsers || []).map((user) => user.id));
const visibleIds = new Set((input.accessibleUsers || []).map((user) => user.id));
const devices = Object.values(snapshot.devices || {}).filter((device) => visibleIds.has(device.userId) && (!targetIds.size || targetIds.has(device.userId)));
const deviceContext = { requested: true, totalReceived: snapshot.totalReceived || 0, updatedAt: snapshot.updatedAt || null, devices };

let responseText = input.responseText;
if (input.command?.name === "/agents") responseText = formatDevices(devices);
return [{ json: { ...input, devices: deviceContext, responseText } }];

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function formatDevices(devices) {
  if (!devices.length) return "Агенты устройств пока не выходили на связь в n8n.";
  const lines = ["Агенты устройств", ""];
  for (const [index, device] of devices.entries()) {
    lines.push(`${index + 1}. ${device.displayName || device.deviceId}`);
    lines.push(`User: ${device.userId}`);
    lines.push(`Host: ${device.hostname || "n/a"}`);
    lines.push(`Platform: ${device.platform || "n/a"}`);
    lines.push(`Last seen: ${device.lastSeenAt || "n/a"}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
