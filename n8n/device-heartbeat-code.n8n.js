const fs = require("fs");
const path = require("path");

const DATA_DIR = env("STARLAB_N8N_DATA_DIR", "/data");
const DATA_FILE = path.join(DATA_DIR, "device-heartbeats.json");

const input = $input.first()?.json || {};
const body = input.body || input;
const headers = input.headers || {};
const now = new Date().toISOString();

const deviceId = String(body.deviceId || body.device_id || "unknown-device").trim();
const userId = String(body.userId || body.user_id || "unknown-user").trim();

fs.mkdirSync(DATA_DIR, { recursive: true });
const state = readJson(DATA_FILE, {
  version: 1,
  updatedAt: null,
  totalReceived: 0,
  devices: {},
});

const previous = state.devices[deviceId] || {};
state.totalReceived = Number(state.totalReceived || 0) + 1;
state.updatedAt = now;
state.devices[deviceId] = {
  deviceId,
  userId,
  displayName: body.displayName || body.display_name || null,
  hostname: body.hostname || null,
  platform: body.platform || null,
  arch: body.arch || null,
  osRelease: body.osRelease || body.os_release || null,
  agentVersion: body.agentVersion || body.agent_version || null,
  capabilities: Array.isArray(body.capabilities) ? body.capabilities : [],
  labels: body.labels && typeof body.labels === "object" ? body.labels : {},
  firstSeenAt: previous.firstSeenAt || now,
  lastSeenAt: now,
  heartbeatCount: Number(previous.heartbeatCount || 0) + 1,
  source: "nginx-mirror",
  remoteAddress:
    headers["x-forwarded-for"] ||
    headers["x-real-ip"] ||
    headers["X-Forwarded-For"] ||
    headers["X-Real-IP"] ||
    null,
};

writeJson(DATA_FILE, state);

return [{
  json: {
    ok: true,
    receivedAt: now,
    deviceId,
    userId,
    heartbeatCount: state.devices[deviceId].heartbeatCount,
  },
}];

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function env(name, fallback = "") {
  try {
    if (typeof $env !== "undefined" && $env && $env[name] !== undefined && $env[name] !== null) {
      return String($env[name]);
    }
  } catch {
    // n8n Code node exposes env through $env; keep a safe fallback for tests.
  }
  return fallback;
}
