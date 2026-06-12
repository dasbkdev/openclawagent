import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { executeAction, supportedActionsForPlatform } from "./agent-tools/executor.js";

const AGENT_VERSION = "0.2.0";
const DEFAULT_INTERVAL_SECONDS = 60;
const COMMAND_POLL_INTERVAL_MS = 8000;

function deviceCapabilities() {
  return Array.from(new Set(["heartbeat", "command-polling", ...supportedActionsForPlatform(process.platform)]));
}

function allowSensitive() {
  return String(process.env.DEVICE_AGENT_ALLOW_SENSITIVE || "").toLowerCase() === "true";
}

main().catch((error) => {
  console.error(`[device-agent] fatal: ${error?.message || error}`);
  process.exitCode = 1;
});

async function main() {
  const envFile = readArgValue("--env-file") || process.env.DEVICE_AGENT_ENV_FILE || defaultEnvFile();
  if (envFile) {
    loadEnvFile(envFile, { optional: true });
  }

  if (readArgFlag("--app") || !process.env.DEVICE_AGENT_USER_ID) {
    const activated = await runLocalApp({ envFile });
    if (!activated && !process.env.DEVICE_AGENT_USER_ID) {
      return;
    }
  }

  const config = loadConfig();
  console.log(
    `[device-agent] starting ${config.deviceId} for ${config.userId} -> ${config.controlPlaneUrl}`,
  );

  let stopped = false;
  const stop = () => {
    stopped = true;
    console.log("[device-agent] stopping");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const canPoll = config.capabilities.includes("command-polling") && Boolean(config.token);
  let lastHeartbeatAt = 0;

  while (!stopped) {
    const nowMs = Date.now();
    if (nowMs - lastHeartbeatAt >= config.intervalSeconds * 1000) {
      lastHeartbeatAt = nowMs;
      try {
        const result = await sendHeartbeat(config);
        console.log(
          `[device-agent] heartbeat ok status=${result.agent?.status || "unknown"} count=${
            result.agent?.heartbeatCount || "n/a"
          }`,
        );
      } catch (error) {
        console.error(`[device-agent] heartbeat failed: ${error?.message || error}`);
      }
    }

    if (canPoll) {
      try {
        await pollAndExecuteCommands(config);
      } catch (error) {
        console.error(`[device-agent] command poll failed: ${error?.message || error}`);
      }
    }

    await sleep(COMMAND_POLL_INTERVAL_MS);
  }
}

async function pollAndExecuteCommands(config) {
  const commands = await claimCommands(config);
  if (!commands.length) {
    return;
  }
  const sensitiveAllowed = allowSensitive();
  for (const command of commands) {
    let outcome;
    try {
      outcome = await executeAction({
        type: command.type,
        args: command.args || {},
        platform: process.platform,
        confirmCallback: () => sensitiveAllowed,
      });
    } catch (error) {
      outcome = { status: "failed", error: error?.message || String(error) };
    }
    console.log(`[device-agent] executed ${command.type} -> ${outcome.status}`);
    try {
      await reportResult(config, command.id, outcome);
    } catch (error) {
      console.error(`[device-agent] result post failed for ${command.id}: ${error?.message || error}`);
    }
  }
}

async function claimCommands(config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.heartbeatTimeoutMs);
  const url = `${config.controlPlaneUrl}/api/v1/device-agents/commands?deviceId=${encodeURIComponent(config.deviceId)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(config),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  }
  return payload.data?.commands || [];
}

async function reportResult(config, commandId, outcome) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.heartbeatTimeoutMs);
  const url = `${config.controlPlaneUrl}/api/v1/device-agents/commands/${encodeURIComponent(commandId)}/result`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(config),
    signal: controller.signal,
    body: JSON.stringify({
      deviceId: config.deviceId,
      status: outcome.status,
      result: outcome.result ?? null,
      error: outcome.error ?? null,
    }),
  }).finally(() => clearTimeout(timer));
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  }
  return payload.data;
}

function loadConfig(env = process.env) {
  const userId = required(env.DEVICE_AGENT_USER_ID, "DEVICE_AGENT_USER_ID");
  const controlPlaneUrl = trim(env.CONTROL_PLANE_URL || "https://starlabagent.pp.ua").replace(/\/+$/u, "");
  const hostname = trim(env.DEVICE_AGENT_HOSTNAME || os.hostname());
  const deviceId = trim(env.DEVICE_AGENT_ID || `${userId}-${hostname}`.toLowerCase().replace(/[^a-z0-9._-]+/giu, "-"));
  const intervalSeconds = Math.max(
    15,
    Number(env.DEVICE_AGENT_INTERVAL_SECONDS || DEFAULT_INTERVAL_SECONDS),
  );
  const heartbeatTimeoutMs = Math.max(
    5000,
    Number(env.DEVICE_AGENT_HEARTBEAT_TIMEOUT_MS || 20000),
  );

  return {
    controlPlaneUrl,
    userId,
    deviceId,
    displayName: trim(env.DEVICE_AGENT_DISPLAY_NAME || `${userId} on ${hostname}`),
    hostname,
    intervalSeconds,
    heartbeatTimeoutMs,
    token: trim(env.DEVICE_AGENT_TOKEN || env.DEVICE_AGENT_INGEST_TOKEN || env.TOKEN_USAGE_INGEST_TOKEN),
    basicAuthUsername: trim(env.CONTROL_PLANE_BASIC_AUTH_USERNAME),
    basicAuthPassword: trim(env.CONTROL_PLANE_BASIC_AUTH_PASSWORD),
    labels: parseJsonObject(env.DEVICE_AGENT_LABELS),
    capabilities: deviceCapabilities(),
  };
}

async function runLocalApp({ envFile }) {
  const port = Number(process.env.DEVICE_AGENT_APP_PORT || 4157);
  const controlPlaneUrl = trim(process.env.CONTROL_PLANE_URL || "https://starlabagent.pp.ua").replace(/\/+$/u, "");
  let activated = Boolean(process.env.DEVICE_AGENT_USER_ID);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (request.method === "GET" && url.pathname === "/") {
        sendHtml(response, renderLocalAppPage({ activated, controlPlaneUrl }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/activate") {
        const body = await readRequestJson(request);
        const activation = await activateWithServer({
          controlPlaneUrl,
          registrationCode: body.registrationCode,
        });
        writeActivationEnv(envFile, { controlPlaneUrl, activation });
        loadEnvFile(envFile, { optional: false, override: true });
        activated = true;
        sendJson(response, 200, { ok: true, data: activation });
        return;
      }
      if (request.method === "POST" && url.pathname === "/chat") {
        const body = await readRequestJson(request);
        const answer = await askCentralAssistant({
          controlPlaneUrl,
          text: body.text,
        });
        sendJson(response, 200, { ok: true, data: { answer } });
        return;
      }
      if (request.method === "GET" && url.pathname === "/status") {
        sendJson(response, 200, {
          ok: true,
          data: {
            activated,
            userId: process.env.DEVICE_AGENT_USER_ID || null,
            deviceId: process.env.DEVICE_AGENT_ID || null,
            controlPlaneUrl,
          },
        });
        return;
      }
      sendJson(response, 404, { ok: false, error: { message: "Not found" } });
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: { message: error instanceof Error ? error.message : "Local agent error" },
      });
    }
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const localUrl = `http://127.0.0.1:${port}`;
  console.log(`[device-agent] local app: ${localUrl}`);
  openBrowser(localUrl);

  while (!activated) {
    await sleep(1000);
  }
  return true;
}

async function activateWithServer({ controlPlaneUrl, registrationCode }) {
  const response = await fetch(`${controlPlaneUrl}/api/v1/device-agents/activate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      registrationCode,
      deviceId: process.env.DEVICE_AGENT_ID || defaultDeviceId(),
      displayName: process.env.DEVICE_AGENT_DISPLAY_NAME || defaultDisplayName(),
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      osRelease: os.release(),
      agentVersion: AGENT_VERSION,
      capabilities: Array.from(new Set(["heartbeat", "local-app", ...deviceCapabilities()])),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || `Activation failed: HTTP ${response.status}`);
  }
  return payload.data;
}

async function askCentralAssistant({ controlPlaneUrl, text }) {
  const deviceId = required(process.env.DEVICE_AGENT_ID, "DEVICE_AGENT_ID");
  const token = required(process.env.DEVICE_AGENT_TOKEN, "DEVICE_AGENT_TOKEN");
  const response = await fetch(`${controlPlaneUrl}/api/v1/local-agent/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Device-Agent-Token": token,
    },
    body: JSON.stringify({
      deviceId,
      text,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || `Assistant request failed: HTTP ${response.status}`);
  }
  return payload.data?.answer || "";
}

function writeActivationEnv(envFile, { controlPlaneUrl, activation }) {
  const dir = path.dirname(envFile);
  fs.mkdirSync(dir, { recursive: true });
  const user = activation.user || {};
  const agent = activation.agent || {};
  const lines = [
    `CONTROL_PLANE_URL=${controlPlaneUrl}`,
    `DEVICE_AGENT_ID=${agent.deviceId}`,
    `DEVICE_AGENT_USER_ID=${user.id}`,
    `DEVICE_AGENT_DISPLAY_NAME=${escapeEnvValue(agent.displayName || `${user.displayName || user.id} on ${os.hostname()}`)}`,
    `DEVICE_AGENT_TOKEN=${activation.deviceToken}`,
    "DEVICE_AGENT_INTERVAL_SECONDS=60",
  ];
  fs.writeFileSync(envFile, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}

async function sendHeartbeat(config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.heartbeatTimeoutMs);
  const response = await fetch(`${config.controlPlaneUrl}/api/v1/device-agents/heartbeat`, {
    method: "POST",
    headers: buildHeaders(config),
    signal: controller.signal,
    body: JSON.stringify({
      userId: config.userId,
      deviceId: config.deviceId,
      displayName: config.displayName,
      hostname: config.hostname,
      platform: os.platform(),
      arch: os.arch(),
      osRelease: os.release(),
      agentVersion: AGENT_VERSION,
      capabilities: config.capabilities,
      labels: config.labels,
    }),
  }).finally(() => clearTimeout(timer));

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok || !payload?.ok) {
    const message = payload?.error?.message || payload?.raw || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload.data;
}

function buildHeaders(config) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.token) {
    headers["X-Device-Agent-Token"] = config.token;
  }
  if (config.basicAuthUsername && config.basicAuthPassword) {
    headers.Authorization = `Basic ${Buffer.from(
      `${config.basicAuthUsername}:${config.basicAuthPassword}`,
    ).toString("base64")}`;
  }
  return headers;
}

function loadEnvFile(filePath, { optional = false, override = false } = {}) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    if (optional) {
      return;
    }
    throw new Error(`Env file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, "utf8");
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim().replace(/^\uFEFF/u, "");
    const value = unquote(trimmed.slice(index + 1).trim());
    if (key && (override || process.env[key] === undefined)) {
      process.env[key] = value;
    }
  }
}

function defaultEnvFile() {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || os.tmpdir(), "StarlabOpenClawAgent", "device-agent.env");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "StarlabOpenClawAgent", "device-agent.env");
  }
  return path.join(os.homedir(), ".config", "starlab-openclaw-agent", "device-agent.env");
}

function defaultDeviceId() {
  return `${os.userInfo().username}-${os.hostname()}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/giu, "-");
}

function defaultDisplayName() {
  return `${os.userInfo().username} on ${os.hostname()}`;
}

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] || null;
}

function readArgFlag(name) {
  return process.argv.includes(name);
}

function required(value, name) {
  const normalized = trim(value);
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function trim(value) {
  return String(value || "").trim();
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function escapeEnvValue(value) {
  const normalized = String(value || "");
  if (/[\s"#']/u.test(normalized)) {
    return JSON.stringify(normalized);
  }
  return normalized;
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, status, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendHtml(response, body) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function openBrowser(url) {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(command, args, { windowsHide: true }, () => {});
}

function renderLocalAppPage({ activated, controlPlaneUrl }) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Starlab OpenClaw Agent</title>
  <style>
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #f4f7fb; color: #172033; }
    main { width: min(640px, calc(100% - 32px)); margin: 64px auto; background: #fff; border: 1px solid #d9e1ee; border-radius: 8px; padding: 24px; }
    h1 { margin: 0 0 10px; font-size: 26px; letter-spacing: 0; }
    p { color: #667085; line-height: 1.55; }
    label { display: block; font-weight: 650; margin: 18px 0 8px; }
    input { width: 100%; min-height: 44px; border: 1px solid #bdc7d8; border-radius: 6px; padding: 10px 12px; font-size: 16px; }
    button { margin-top: 14px; min-height: 44px; border: 0; border-radius: 6px; background: #1267d8; color: #fff; padding: 0 16px; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .65; cursor: default; }
    .status { margin-top: 16px; white-space: pre-wrap; }
    .ok { color: #0e7c66; }
    .bad { color: #b42318; }
    code { font-family: Consolas, Menlo, monospace; }
  </style>
</head>
<body>
  <main>
    <h1>Starlab OpenClaw Agent</h1>
    <p>Введите registration code, который выдал Николай. После активации это устройство будет привязано к вашему пользователю и начнёт отправлять статус на центральный сервер.</p>
    <p>Сервер: <code>${escapeHtml(controlPlaneUrl)}</code></p>
    <section id="chat" style="${activated ? "" : "display:none"}">
      <p class="ok">Агент активирован. Можно задавать вопросы так же, как Telegram-боту.</p>
      <form id="chatForm">
        <label for="question">Вопрос агенту</label>
        <input id="question" name="question" autocomplete="off" placeholder="Например: дай сводку по Максату за неделю">
        <button id="ask" type="submit">Спросить</button>
      </form>
      <div id="answer" class="status"></div>
    </section>
    ${activated ? "" : `
      <form id="form">
        <label for="code">Registration code</label>
        <input id="code" name="code" autocomplete="one-time-code" required placeholder="Например: WIOD23WED">
        <button id="submit" type="submit">Активировать</button>
      </form>
      <div id="status" class="status"></div>
      <script>
        const form = document.getElementById('form');
        const status = document.getElementById('status');
        const submit = document.getElementById('submit');
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          submit.disabled = true;
          status.className = 'status';
          status.textContent = 'Проверяю код...';
          try {
            const response = await fetch('/activate', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ registrationCode: form.code.value.trim() })
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'Ошибка активации');
            status.className = 'status ok';
            status.textContent = 'Готово. Устройство привязано к: ' + payload.data.user.displayName + '\\nМожно закрыть это окно.';
            document.getElementById('chat').style.display = '';
            form.style.display = 'none';
          } catch (error) {
            status.className = 'status bad';
            status.textContent = error.message || String(error);
            submit.disabled = false;
          }
        });
      </script>
    `}
    <script>
      const chatForm = document.getElementById('chatForm');
      const answer = document.getElementById('answer');
      const ask = document.getElementById('ask');
      if (chatForm) {
        chatForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          ask.disabled = true;
          answer.className = 'status';
          answer.textContent = 'Думаю...';
          try {
            const response = await fetch('/chat', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ text: chatForm.question.value.trim() })
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'Ошибка ответа');
            answer.className = 'status';
            answer.textContent = payload.data.answer || 'Пустой ответ';
          } catch (error) {
            answer.className = 'status bad';
            answer.textContent = error.message || String(error);
          } finally {
            ask.disabled = false;
          }
        });
      }
    </script>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseJsonObject(value) {
  if (!trim(value)) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
