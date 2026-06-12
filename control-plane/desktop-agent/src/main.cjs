const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");

const APP_VERSION = "0.1.0";
const DEFAULT_CONTROL_PLANE_URL = "https://starlabagent.pp.ua";
const HEARTBEAT_INTERVAL_MS = 60_000;

let mainWindow = null;
let heartbeatTimer = null;

function configPath() {
  return path.join(app.getPath("userData"), "agent-config.json");
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {
      controlPlaneUrl: DEFAULT_CONTROL_PLANE_URL,
      activated: false,
    };
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_CONTROL_PLANE_URL).trim().replace(/\/+$/u, "");
}

function defaultDeviceId() {
  return `${os.userInfo().username}-${os.hostname()}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/giu, "-");
}

function defaultDisplayName() {
  return `${os.userInfo().username} on ${os.hostname()}`;
}

async function requestJson(url, { method = "GET", headers = {}, body, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...headers,
      },
      body,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message || `HTTP ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function activateDevice({ registrationCode, controlPlaneUrl }) {
  const baseUrl = normalizeBaseUrl(controlPlaneUrl);
  const payload = await requestJson(`${baseUrl}/api/v1/device-agents/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationCode,
      deviceId: defaultDeviceId(),
      displayName: defaultDisplayName(),
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      agentVersion: APP_VERSION,
      capabilities: ["heartbeat", "desktop-app", "chat"],
    }),
  });

  const config = {
    activated: true,
    controlPlaneUrl: baseUrl,
    user: payload.data.user,
    agent: payload.data.agent,
    deviceToken: payload.data.deviceToken,
    activatedAt: new Date().toISOString(),
  };
  writeConfig(config);
  startHeartbeat();
  return safePublicConfig(config);
}

async function sendHeartbeat() {
  const config = readConfig();
  if (!config.activated || !config.deviceToken || !config.agent?.deviceId || !config.user?.id) {
    return null;
  }
  const payload = await requestJson(`${normalizeBaseUrl(config.controlPlaneUrl)}/api/v1/device-agents/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Agent-Token": config.deviceToken,
    },
    body: JSON.stringify({
      userId: config.user.id,
      deviceId: config.agent.deviceId,
      displayName: config.agent.displayName || defaultDisplayName(),
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      agentVersion: APP_VERSION,
      capabilities: ["heartbeat", "desktop-app", "chat"],
    }),
    timeoutMs: 20000,
  });
  const next = {
    ...config,
    agent: payload.data.agent || config.agent,
    lastHeartbeatAt: new Date().toISOString(),
    lastHeartbeatError: null,
  };
  writeConfig(next);
  mainWindow?.webContents.send("agent:status", safePublicConfig(next));
  return safePublicConfig(next);
}

function startHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  const config = readConfig();
  if (!config.activated) {
    return;
  }
  sendHeartbeat().catch((error) => {
    const failed = { ...readConfig(), lastHeartbeatError: error.message };
    writeConfig(failed);
    mainWindow?.webContents.send("agent:status", safePublicConfig(failed));
  });
  heartbeatTimer = setInterval(() => {
    sendHeartbeat().catch((error) => {
      const failed = { ...readConfig(), lastHeartbeatError: error.message };
      writeConfig(failed);
      mainWindow?.webContents.send("agent:status", safePublicConfig(failed));
    });
  }, HEARTBEAT_INTERVAL_MS);
}

async function askAssistant(text) {
  const config = readConfig();
  if (!config.activated) {
    throw new Error("Сначала активируй агент registration code.");
  }
  const payload = await requestJson(`${normalizeBaseUrl(config.controlPlaneUrl)}/api/v1/local-agent/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Agent-Token": config.deviceToken,
    },
    body: JSON.stringify({
      deviceId: config.agent.deviceId,
      text,
    }),
    timeoutMs: 60000,
  });
  return payload.data.answer;
}

function safePublicConfig(config) {
  return {
    activated: Boolean(config.activated),
    controlPlaneUrl: config.controlPlaneUrl || DEFAULT_CONTROL_PLANE_URL,
    user: config.user || null,
    agent: config.agent || null,
    activatedAt: config.activatedAt || null,
    lastHeartbeatAt: config.lastHeartbeatAt || null,
    lastHeartbeatError: config.lastHeartbeatError || null,
    version: APP_VERSION,
    configPath: configPath(),
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 760,
    minWidth: 920,
    minHeight: 640,
    title: "Starlab OpenClaw Agent",
    backgroundColor: "#f4f7fb",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("agent:getStatus", () => safePublicConfig(readConfig()));
  ipcMain.handle("agent:activate", (_event, input) => activateDevice(input || {}));
  ipcMain.handle("agent:heartbeat", () => sendHeartbeat());
  ipcMain.handle("agent:ask", (_event, text) => askAssistant(text));
  ipcMain.handle("agent:reset", () => {
    fs.rmSync(configPath(), { force: true });
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    return safePublicConfig(readConfig());
  });
  ipcMain.handle("agent:openExternal", (_event, url) => shell.openExternal(url));

  createWindow();
  startHeartbeat();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
