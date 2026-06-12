const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");

const APP_VERSION = "0.2.0";
const DEFAULT_CONTROL_PLANE_URL = "https://starlabagent.pp.ua";
const HEARTBEAT_INTERVAL_MS = 60_000;
const COMMAND_POLL_INTERVAL_MS = 8_000;
const MAX_RECENT_ACTIONS = 25;

let mainWindow = null;
let heartbeatTimer = null;
let commandPollTimer = null;
let commandPollBusy = false;
let executorModule = null;
const recentActions = [];

// The executor is an ESM module; main.cjs is CommonJS. Load it lazily via a
// dynamic import (supported in modern Electron/Node) and cache the namespace.
async function loadExecutor() {
  if (!executorModule) {
    const executorUrl = pathToFileURL(
      path.join(__dirname, "..", "..", "src", "agent-tools", "executor.js"),
    ).href;
    executorModule = await import(executorUrl);
  }
  return executorModule;
}

async function deviceCapabilities() {
  try {
    const { supportedActionsForPlatform } = await loadExecutor();
    return Array.from(
      new Set(["heartbeat", "command-polling", "chat", "desktop-app", ...supportedActionsForPlatform(process.platform)]),
    );
  } catch {
    return ["heartbeat", "command-polling", "chat", "desktop-app"];
  }
}

function recordAction(entry) {
  recentActions.unshift({ ...entry, at: new Date().toISOString() });
  if (recentActions.length > MAX_RECENT_ACTIONS) {
    recentActions.length = MAX_RECENT_ACTIONS;
  }
  mainWindow?.webContents.send("agent:recentActions", recentActions.slice(0, MAX_RECENT_ACTIONS));
}

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
  const capabilities = await deviceCapabilities();
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
      capabilities,
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
  startCommandPolling();
  return safePublicConfig(config);
}

async function sendHeartbeat() {
  const config = readConfig();
  if (!config.activated || !config.deviceToken || !config.agent?.deviceId || !config.user?.id) {
    return null;
  }
  const capabilities = await deviceCapabilities();
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
      capabilities,
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

function startCommandPolling() {
  if (commandPollTimer) {
    clearInterval(commandPollTimer);
  }
  const config = readConfig();
  if (!config.activated) {
    return;
  }
  commandPollTimer = setInterval(() => {
    pollCommandsOnce().catch((error) => {
      console.error(`[desktop-agent] command poll failed: ${error?.message || error}`);
    });
  }, COMMAND_POLL_INTERVAL_MS);
}

// Native confirmation dialog: the human controls the agent's hands. Sensitive
// actions only run if the user explicitly clicks "Разрешить".
async function confirmSensitiveAction({ type, args }) {
  const detail = JSON.stringify(args || {}, null, 2).slice(0, 1500);
  const { response } = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: "warning",
    buttons: ["Отклонить", "Разрешить"],
    defaultId: 0,
    cancelId: 0,
    title: "Подтверждение действия агента",
    message: `Агент хочет выполнить действие: ${type}`,
    detail: `Аргументы:\n${detail}`,
    noLink: true,
  });
  return response === 1;
}

async function pollCommandsOnce() {
  if (commandPollBusy) {
    return;
  }
  const config = readConfig();
  if (!config.activated || !config.deviceToken || !config.agent?.deviceId) {
    return;
  }
  commandPollBusy = true;
  try {
    const baseUrl = normalizeBaseUrl(config.controlPlaneUrl);
    const claimUrl = `${baseUrl}/api/v1/device-agents/commands?deviceId=${encodeURIComponent(config.agent.deviceId)}`;
    const payload = await requestJson(claimUrl, {
      method: "GET",
      headers: { "X-Device-Agent-Token": config.deviceToken },
      timeoutMs: 20000,
    });
    const commands = payload.data?.commands || [];
    if (!commands.length) {
      return;
    }
    const { executeAction } = await loadExecutor();
    for (const command of commands) {
      let outcome;
      try {
        outcome = await executeAction({
          type: command.type,
          args: command.args || {},
          platform: process.platform,
          confirmCallback: confirmSensitiveAction,
        });
      } catch (error) {
        outcome = { status: "failed", error: error?.message || String(error) };
      }
      recordAction({ type: command.type, status: outcome.status, error: outcome.error || null });
      try {
        await requestJson(
          `${baseUrl}/api/v1/device-agents/commands/${encodeURIComponent(command.id)}/result`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Device-Agent-Token": config.deviceToken,
            },
            body: JSON.stringify({
              deviceId: config.agent.deviceId,
              status: outcome.status,
              result: outcome.result ?? null,
              error: outcome.error ?? null,
            }),
            timeoutMs: 20000,
          },
        );
      } catch (error) {
        console.error(`[desktop-agent] result post failed for ${command.id}: ${error?.message || error}`);
      }
    }
  } finally {
    commandPollBusy = false;
  }
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
  ipcMain.handle("agent:recentActions", () => recentActions.slice(0, MAX_RECENT_ACTIONS));
  ipcMain.handle("agent:reset", () => {
    fs.rmSync(configPath(), { force: true });
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (commandPollTimer) {
      clearInterval(commandPollTimer);
      commandPollTimer = null;
    }
    recentActions.length = 0;
    return safePublicConfig(readConfig());
  });
  ipcMain.handle("agent:openExternal", (_event, url) => shell.openExternal(url));

  createWindow();
  startHeartbeat();
  startCommandPolling();
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
