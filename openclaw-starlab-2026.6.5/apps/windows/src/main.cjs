const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");

const APP_VERSION = app.getVersion();
const DEFAULT_CONTROL_PLANE_URL = "https://starlabagent.pp.ua";
const HEARTBEAT_INTERVAL_MS = 60_000;
const COMMAND_POLL_INTERVAL_MS = 5_000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_MANIFEST_PATH = "/downloads/releases.json";

let mainWindow = null;
let heartbeatTimer = null;
let commandTimer = null;
let updateTimer = null;

const DEVICE_CAPABILITIES = [
  "heartbeat",
  "openclaw-windows",
  "chat",
  "command-polling",
  "open_app",
  "close_app",
  "open_url",
  "play_youtube",
  "open_file",
  "list_running_apps",
  "active_window",
  "screenshot",
  "clipboard_get",
  "clipboard_set",
  "keyboard_type",
  "hotkey",
  "mouse_click",
  "minimize_window",
  "minimize_all",
];

const WINDOWS_APP_ALIASES = {
  chrome: [
    path.join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    "chrome",
  ],
  "google chrome": [
    path.join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    "chrome",
  ],
  edge: [
    path.join(process.env.ProgramFiles || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    "msedge",
  ],
  telegram: [
    path.join(process.env.APPDATA || "", "Telegram Desktop", "Telegram.exe"),
    "telegram",
  ],
  vscode: [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"),
    "code",
  ],
  "vs code": [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"),
    "code",
  ],
  "visual studio code": [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"),
    "code",
  ],
  code: [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"),
    "code",
  ],
  word: ["winword"],
  excel: ["excel"],
  powerpoint: ["powerpnt"],
  notepad: ["notepad"],
  explorer: ["explorer"],
  calculator: ["calc"],
};

function configPath() {
  return path.join(app.getPath("userData"), "agent-config.json");
}

function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    return {
      controlPlaneUrl: DEFAULT_CONTROL_PLANE_URL,
      activated: false,
      ...parsed,
    };
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

function compareVersions(left, right) {
  const a = String(left || "").split(/[^\d]+/u).filter(Boolean).map(Number);
  const b = String(right || "").split(/[^\d]+/u).filter(Boolean).map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

async function checkForUpdates() {
  const config = readConfig();
  const baseUrl = normalizeBaseUrl(config.controlPlaneUrl);
  try {
    const response = await fetch(`${baseUrl}${UPDATE_MANIFEST_PATH}`, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const manifest = await response.json();
    const release = manifest?.platforms?.windows;
    if (!release?.version || compareVersions(release.version, APP_VERSION) <= 0) {
      const next = { ...config, update: { available: false, checkedAt: new Date().toISOString() } };
      writeConfig(next);
      mainWindow?.webContents.send("agent:status", safePublicConfig(next));
      return next.update;
    }

    const downloadUrl = new URL(release.url, baseUrl).toString();
    const download = await fetch(downloadUrl);
    if (!download.ok) {
      throw new Error(`download HTTP ${download.status}`);
    }
    const bytes = Buffer.from(await download.arrayBuffer());
    const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
    if (release.sha256 && checksum.toLowerCase() !== String(release.sha256).toLowerCase()) {
      throw new Error("SHA-256 mismatch");
    }
    const updatesDir = path.join(app.getPath("userData"), "updates");
    fs.mkdirSync(updatesDir, { recursive: true });
    const filename = path.basename(new URL(downloadUrl).pathname) || "starlab-openclaw-update.exe";
    const installerPath = path.join(updatesDir, filename);
    fs.writeFileSync(installerPath, bytes, { mode: 0o600 });
    const next = {
      ...config,
      update: {
        available: true,
        version: release.version,
        notes: release.notes || null,
        installerPath,
        downloadUrl,
        sha256: checksum,
        checkedAt: new Date().toISOString(),
        error: null,
      },
    };
    writeConfig(next);
    mainWindow?.webContents.send("agent:status", safePublicConfig(next));
    return next.update;
  } catch (error) {
    const next = {
      ...config,
      update: {
        ...(config.update || {}),
        checkedAt: new Date().toISOString(),
        error: error.message || String(error),
      },
    };
    writeConfig(next);
    mainWindow?.webContents.send("agent:status", safePublicConfig(next));
    return next.update;
  }
}

function startUpdateChecks() {
  if (updateTimer) {
    clearInterval(updateTimer);
  }
  setTimeout(() => {
    void checkForUpdates();
  }, 30_000);
  updateTimer = setInterval(() => {
    void checkForUpdates();
  }, UPDATE_CHECK_INTERVAL_MS);
}

function installPendingUpdate() {
  const config = readConfig();
  const installerPath = config.update?.installerPath;
  if (!config.update?.available || !installerPath || !fs.existsSync(installerPath)) {
    throw new Error("Проверенный установщик обновления не найден.");
  }
  const child = spawn(installerPath, ["/S"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  setTimeout(() => app.quit(), 500);
  return { installing: true, version: config.update.version };
}

function defaultDeviceId() {
  return `${os.userInfo().username}-${os.hostname()}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/giu, "-");
}

function defaultDisplayName() {
  return `${os.userInfo().username} on ${os.hostname()}`;
}

function encryptDeviceToken(token) {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      deviceTokenEncrypted: safeStorage.encryptString(token).toString("base64"),
      deviceToken: undefined,
    };
  }
  return {
    deviceToken: token,
    deviceTokenEncrypted: undefined,
  };
}

function decryptDeviceToken(config) {
  if (config.deviceTokenEncrypted) {
    return safeStorage.decryptString(Buffer.from(config.deviceTokenEncrypted, "base64"));
  }
  return config.deviceToken || "";
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
      capabilities: DEVICE_CAPABILITIES,
    }),
  });

  const encryptedToken = encryptDeviceToken(payload.data.deviceToken);
  const config = {
    activated: true,
    controlPlaneUrl: baseUrl,
    user: payload.data.user,
    agent: payload.data.agent,
    ...encryptedToken,
    activatedAt: new Date().toISOString(),
    lastHeartbeatError: null,
  };
  writeConfig(config);
  startHeartbeat();
  startDeviceCommandPolling();
  return safePublicConfig(config);
}

async function sendHeartbeat() {
  const config = readConfig();
  const deviceToken = decryptDeviceToken(config);
  if (!config.activated || !deviceToken || !config.agent?.deviceId || !config.user?.id) {
    return null;
  }
  const payload = await requestJson(`${normalizeBaseUrl(config.controlPlaneUrl)}/api/v1/device-agents/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Agent-Token": deviceToken,
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
      capabilities: DEVICE_CAPABILITIES,
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
  sendHeartbeat().catch(storeHeartbeatError);
  heartbeatTimer = setInterval(() => {
    sendHeartbeat().catch(storeHeartbeatError);
  }, HEARTBEAT_INTERVAL_MS);
}

function startDeviceCommandPolling() {
  if (commandTimer) {
    clearInterval(commandTimer);
  }
  const config = readConfig();
  if (!config.activated) {
    return;
  }
  pollDeviceCommands().catch(storeDeviceCommandError);
  commandTimer = setInterval(() => {
    pollDeviceCommands().catch(storeDeviceCommandError);
  }, COMMAND_POLL_INTERVAL_MS);
}

function storeHeartbeatError(error) {
  const failed = { ...readConfig(), lastHeartbeatError: error.message || String(error) };
  writeConfig(failed);
  mainWindow?.webContents.send("agent:status", safePublicConfig(failed));
}

function storeDeviceCommandError(error) {
  const failed = { ...readConfig(), lastCommandError: error.message || String(error) };
  writeConfig(failed);
  mainWindow?.webContents.send("agent:status", safePublicConfig(failed));
}

async function pollDeviceCommands() {
  const config = readConfig();
  const deviceToken = decryptDeviceToken(config);
  if (!config.activated || !deviceToken || !config.agent?.deviceId) {
    return;
  }

  const payload = await requestJson(
    `${normalizeBaseUrl(config.controlPlaneUrl)}/api/v1/device-agents/commands?deviceId=${encodeURIComponent(
      config.agent.deviceId,
    )}&limit=5`,
    {
      headers: {
        "X-Device-Agent-Token": deviceToken,
      },
      timeoutMs: 20000,
    },
  );

  const commands = Array.isArray(payload.data?.commands) ? payload.data.commands : [];
  if (commands.length === 0) {
    return;
  }

  for (const command of commands) {
    let execution;
    try {
      execution = await executeDeviceCommand(command);
    } catch (error) {
      execution = {
        status: "failed",
        result: null,
        error: error.message || String(error),
      };
    }
    await submitDeviceCommandResult(config, deviceToken, command, execution);
  }

  const updated = { ...readConfig(), lastCommandAt: new Date().toISOString(), lastCommandError: null };
  writeConfig(updated);
  mainWindow?.webContents.send("agent:status", safePublicConfig(updated));
}

async function submitDeviceCommandResult(config, deviceToken, command, execution) {
  await requestJson(
    `${normalizeBaseUrl(config.controlPlaneUrl)}/api/v1/device-agents/commands/${encodeURIComponent(
      command.id,
    )}/result`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Agent-Token": deviceToken,
      },
      body: JSON.stringify({
        deviceId: config.agent.deviceId,
        status: execution.status,
        result: execution.result || null,
        error: execution.error || null,
      }),
      timeoutMs: 30000,
    },
  );
}

async function executeDeviceCommand(command) {
  const args = command.args || {};
  switch (command.type) {
    case "open_app":
      return succeed(await openApp(args));
    case "close_app":
      return succeed(await closeApp(args));
    case "open_url":
      return succeed(await openUrl(args));
    case "play_youtube":
      return succeed(await playYoutube(args));
    case "open_file":
      return succeed(await openFile(args));
    case "list_running_apps":
      return succeed(await listRunningApps());
    case "active_window":
      return succeed(await readActiveWindow());
    case "screenshot":
      return succeed(await takeScreenshot());
    case "clipboard_get":
      return succeed(await getClipboard());
    case "clipboard_set":
      return succeed(await setClipboard(args));
    case "keyboard_type":
      return succeed(await typeText(args));
    case "hotkey":
      return succeed(await pressHotkey(args));
    case "minimize_window":
      return succeed(await minimizeActiveWindow());
    case "minimize_all":
      return succeed(await minimizeAllWindows());
    case "mouse_click":
      return succeed(await clickMouse(args));
    case "ocr_screen":
    case "openclaw_prompt":
      return {
        status: "unsupported",
        result: null,
        error: `${command.type} is not supported in this local build yet`,
      };
    default:
      return {
        status: "unsupported",
        result: null,
        error: `Unknown command type: ${command.type}`,
      };
  }
}

function succeed(result = {}) {
  return { status: "succeeded", result, error: null };
}

async function openApp(args) {
  const appName = readArg(args, ["app", "name", "path", "target"]);
  if (!appName) {
    throw new Error("open_app requires args.app");
  }
  // Prefer the human label for fuzzy lookup ("Visual Studio Code"), fall back
  // to a known alias target ("code"). The universal resolver below can open
  // ANY installed app: direct launch, then the Start menu apps (incl. Store /
  // UWP via Get-StartApps), then a Start Menu shortcut search.
  const label = readArg(args, ["appLabel"]) || appName;
  const target = resolveWindowsAppTarget(appName);
  const result = await runPowerShell(buildUniversalOpenScript({ target, label }), { timeoutMs: 25000 });
  const method = String(result.stdout || "").trim() || "started";
  return { opened: appName, target, method };
}

// PowerShell that opens any installed app: direct -> Get-StartApps fuzzy ->
// Start Menu .lnk search. Echoes which method succeeded; exits non-zero only
// if nothing matched.
function buildUniversalOpenScript({ target, label }) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$target = ${psString(target)}
$label = ${psString(label)}

# 1) Direct launch (PATH, App Paths registry, full path).
try { Start-Process -FilePath $target -ErrorAction Stop; Write-Output 'direct'; exit 0 } catch {}
if ($label -ne $target) {
  try { Start-Process -FilePath $label -ErrorAction Stop; Write-Output 'direct-label'; exit 0 } catch {}
}

# 2) Start menu apps (Win32 + Store/UWP) via Get-StartApps, fuzzy by name.
$needle = $label
$apps = Get-StartApps | Where-Object { $_.Name -like ('*' + $needle + '*') }
if (-not $apps) { $apps = Get-StartApps | Where-Object { $_.Name -like ('*' + $target + '*') } }
if ($apps) {
  $best = $apps | Sort-Object { $_.Name.Length } | Select-Object -First 1
  Start-Process ('shell:AppsFolder\\' + $best.AppID)
  Write-Output ('startapps:' + $best.Name)
  exit 0
}

# 3) Start Menu shortcut (.lnk) search.
$roots = @("$env:ProgramData\\Microsoft\\Windows\\Start Menu","$env:AppData\\Microsoft\\Windows\\Start Menu")
$lnk = Get-ChildItem -Path $roots -Recurse -Filter *.lnk -ErrorAction SilentlyContinue |
  Where-Object { $_.BaseName -like ('*' + $needle + '*') } |
  Sort-Object { $_.BaseName.Length } | Select-Object -First 1
if ($lnk) { Start-Process $lnk.FullName; Write-Output ('shortcut:' + $lnk.BaseName); exit 0 }

Write-Error ('Приложение не найдено: ' + $label)
exit 1
`;
}

async function closeApp(args) {
  const appName = readArg(args, ["app", "name", "process", "processName"]);
  if (!appName) {
    throw new Error("close_app requires args.app");
  }
  const force = Boolean(args.force);
  const imageName = normalizeWindowsImageName(appName);
  const flags = force ? "/T /F" : "/T";
  await runPowerShell(`taskkill /IM ${psString(imageName)} ${flags}`);
  return { closed: imageName, force };
}

async function openUrl(args) {
  const url = readArg(args, ["url", "target"]);
  if (!url) {
    throw new Error("open_url requires args.url");
  }
  await shell.openExternal(url);
  return { opened: url };
}

async function minimizeActiveWindow() {
  // Win32 ShowWindow(SW_MINIMIZE=6) on the foreground window.
  await runPowerShell(`
Add-Type -Namespace W -Name U -MemberDefinition '
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);'
[W.U]::ShowWindow([W.U]::GetForegroundWindow(), 6) | Out-Null
`);
  return { minimized: "active" };
}

async function minimizeAllWindows() {
  // Shell.Application MinimizeAll == Win+M.
  await runPowerShell("(New-Object -ComObject Shell.Application).MinimizeAll()");
  return { minimized: "all" };
}

async function playYoutube(args) {
  const query = readArg(args, ["query", "song", "title", "text", "target"]);
  if (!query) {
    throw new Error("play_youtube requires args.query");
  }
  const video = await resolveYoutubeVideo(query);
  const target = resolveWindowsAppTarget("Google Chrome");
  const profileDir = path.join(app.getPath("userData"), "youtube-chrome-profile");
  fs.mkdirSync(profileDir, { recursive: true });

  try {
    await runPowerShell(`
Start-Process -FilePath ${psString(target)} -ArgumentList @(
  ${psString(`--user-data-dir=${profileDir}`)},
  "--no-first-run",
  "--no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required",
  "--new-window",
  ${psString(video.watchUrl)}
)
`, { timeoutMs: 15000 });
    return {
      query,
      opened: video.watchUrl,
      resolvedVideoId: video.videoId,
      attemptedPlay: true,
      method: "youtube-direct-watch-chrome-autoplay",
    };
  } catch (error) {
    await shell.openExternal(video.watchUrl);
    return {
      query,
      opened: video.watchUrl,
      resolvedVideoId: video.videoId,
      attemptedPlay: true,
      method: "youtube-direct-watch-default-browser",
      chromeError: error.message || String(error),
    };
  }
}

function buildYoutubeSearchUrl(query) {
  const url = new URL("https://www.youtube.com/results");
  url.searchParams.set("search_query", query);
  return url.toString();
}

async function resolveYoutubeVideo(query) {
  const searchUrl = buildYoutubeSearchUrl(query);
  const response = await fetch(searchUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ru,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`YouTube search failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const videoId =
    html.match(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/u)?.[1] ||
    html.match(/"videoId":"([A-Za-z0-9_-]{11})"/u)?.[1];
  if (!videoId) {
    throw new Error("YouTube did not return a playable video result");
  }

  const watchUrl = new URL("https://www.youtube.com/watch");
  watchUrl.searchParams.set("v", videoId);
  watchUrl.searchParams.set("autoplay", "1");
  return { videoId, watchUrl: watchUrl.toString(), searchUrl };
}

async function openFile(args) {
  const filePath = readArg(args, ["path", "file", "target"]);
  if (!filePath) {
    throw new Error("open_file requires args.path");
  }
  const error = await shell.openPath(filePath);
  if (error) {
    throw new Error(error);
  }
  return { opened: filePath };
}

async function listRunningApps() {
  const script = [
    "Get-Process |",
    "Sort-Object ProcessName |",
    "Select-Object -First 120 ProcessName, Id, MainWindowTitle |",
    "ConvertTo-Json -Compress",
  ].join(" ");
  const { stdout } = await runPowerShell(script, { timeoutMs: 15000, maxBuffer: 2 * 1024 * 1024 });
  return { processes: parseJsonMaybe(stdout) || [] };
}

async function readActiveWindow() {
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Window {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$handle = [Win32Window]::GetForegroundWindow()
$builder = New-Object System.Text.StringBuilder 1024
[void][Win32Window]::GetWindowText($handle, $builder, $builder.Capacity)
$processId = 0
[void][Win32Window]::GetWindowThreadProcessId($handle, [ref]$processId)
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
[PSCustomObject]@{ title = $builder.ToString(); processId = $processId; processName = $process.ProcessName } | ConvertTo-Json -Compress
`;
  const { stdout } = await runPowerShell(script, { timeoutMs: 15000 });
  return { window: parseJsonMaybe(stdout) || null };
}

async function takeScreenshot() {
  const outputPath = path.join(os.tmpdir(), `starlab-openclaw-shot-${Date.now()}.png`);
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save(${psString(outputPath)}, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`;
  await runPowerShell(script, { timeoutMs: 30000 });
  const base64 = fs.readFileSync(outputPath).toString("base64");
  fs.rmSync(outputPath, { force: true });
  return {
    mimeType: "image/png",
    filename: path.basename(outputPath),
    base64,
  };
}

async function getClipboard() {
  const { stdout } = await runPowerShell("Get-Clipboard -Raw", { timeoutMs: 10000 });
  return { text: stdout.replace(/\r?\n$/u, "") };
}

async function setClipboard(args) {
  const text = readArg(args, ["text", "value", "content"]);
  await runPowerShell(`Set-Clipboard -Value ${psString(text || "")}`, { timeoutMs: 10000 });
  return { ok: true };
}

async function typeText(args) {
  const text = readArg(args, ["text", "value"]);
  if (!text) {
    throw new Error("keyboard_type requires args.text");
  }
  await setClipboard({ text });
  await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("^v")
`, { timeoutMs: 10000 });
  return { typed: text.length, method: "clipboard-paste" };
}

async function pressHotkey(args) {
  const keys = normalizeKeys(args.keys || args.hotkey || args.combo);
  if (keys.length === 0) {
    throw new Error("hotkey requires args.keys");
  }
  const sendKeys = toWindowsSendKeys(keys);
  await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${psString(sendKeys)})
`, { timeoutMs: 10000 });
  return { keys, sendKeys };
}

async function clickMouse(args) {
  const x = Number(args.x);
  const y = Number(args.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("mouse_click requires numeric args.x and args.y");
  }
  const button = String(args.button || "left").toLowerCase();
  const down = button === "right" ? "0x0008" : "0x0002";
  const up = button === "right" ? "0x0010" : "0x0004";
  await runPowerShell(`
Add-Type @"
using System.Runtime.InteropServices;
public class MouseControl {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}
"@
[MouseControl]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
[MouseControl]::mouse_event(${down}, 0, 0, 0, 0)
[MouseControl]::mouse_event(${up}, 0, 0, 0, 0)
`, { timeoutMs: 10000 });
  return { x: Math.round(x), y: Math.round(y), button };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runPowerShell(script, { timeoutMs = 15000, maxBuffer = 10 * 1024 * 1024 } = {}) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { timeout: timeoutMs, windowsHide: true, maxBuffer },
  );
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function readArg(args, names) {
  for (const name of names) {
    if (args[name] !== undefined && args[name] !== null && String(args[name]).trim()) {
      return String(args[name]).trim();
    }
  }
  return "";
}

function resolveWindowsAppTarget(value) {
  const requested = String(value || "").trim();
  const normalized = requested
    .toLowerCase()
    .replace(/\.exe$/u, "")
    .replace(/\s+/gu, " ");
  const candidates = WINDOWS_APP_ALIASES[normalized] || [requested];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates.find(Boolean) || requested;
}

function normalizeWindowsImageName(value) {
  const requested = String(value || "").trim();
  const normalized = requested
    .toLowerCase()
    .replace(/\.exe$/u, "")
    .replace(/\s+/gu, " ");
  const target = resolveWindowsAppTarget(normalized);
  const base = path.basename(target);
  if (base && base.toLowerCase().endsWith(".exe")) {
    return base;
  }
  return requested.toLowerCase().endsWith(".exe") ? requested : `${requested}.exe`;
}

function psString(value) {
  return `'${String(value ?? "").replace(/'/gu, "''")}'`;
}

function parseJsonMaybe(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function normalizeKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  }
  return String(value || "")
    .split(/[+\s,]+/u)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function toWindowsSendKeys(keys) {
  const modifiers = {
    ctrl: "^",
    control: "^",
    cmd: "^",
    command: "^",
    win: "^",
    alt: "%",
    option: "%",
    shift: "+",
  };
  const special = {
    enter: "{ENTER}",
    return: "{ENTER}",
    tab: "{TAB}",
    esc: "{ESC}",
    escape: "{ESC}",
    backspace: "{BACKSPACE}",
    delete: "{DELETE}",
    space: " ",
    left: "{LEFT}",
    right: "{RIGHT}",
    up: "{UP}",
    down: "{DOWN}",
  };
  let prefix = "";
  let key = "";
  for (const item of keys) {
    if (modifiers[item]) {
      prefix += modifiers[item];
    } else {
      key = special[item] || item;
    }
  }
  if (!key) {
    throw new Error("hotkey requires a non-modifier key");
  }
  return `${prefix}${key}`;
}

async function askAssistant(text) {
  const config = readConfig();
  const deviceToken = decryptDeviceToken(config);
  if (!config.activated || !deviceToken) {
    throw new Error("Сначала активируйте агент через registration code.");
  }
  const payload = await requestJson(`${normalizeBaseUrl(config.controlPlaneUrl)}/api/v1/local-agent/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Agent-Token": deviceToken,
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
    lastCommandAt: config.lastCommandAt || null,
    lastCommandError: config.lastCommandError || null,
    tokenStorage: config.deviceTokenEncrypted ? "encrypted" : config.deviceToken ? "plain" : "none",
    version: APP_VERSION,
    update: config.update || null,
    configPath: configPath(),
  };
}

let isQuitting = false;

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

  // Launched at login (--hidden): start minimized so it runs quietly in the
  // background but stays reachable from the taskbar.
  mainWindow.once("ready-to-show", () => {
    if (process.argv.includes("--hidden")) {
      mainWindow.minimize();
    }
  });

  // Closing the window must NOT stop the agent: minimize and keep running
  // (heartbeat + command polling) so device commands keep working. Real quit
  // goes through before-quit (isQuitting).
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.minimize();
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: app.getPath("exe"),
      args: ["--hidden"],
    });
  }

  ipcMain.handle("agent:getStatus", () => safePublicConfig(readConfig()));
  ipcMain.handle("agent:activate", (_event, input) => activateDevice(input || {}));
  ipcMain.handle("agent:heartbeat", () => sendHeartbeat());
  ipcMain.handle("agent:checkUpdate", () => checkForUpdates());
  ipcMain.handle("agent:installUpdate", () => installPendingUpdate());
  ipcMain.handle("agent:ask", (_event, text) => askAssistant(text));
  ipcMain.handle("agent:reset", () => {
    fs.rmSync(configPath(), { force: true });
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (commandTimer) {
      clearInterval(commandTimer);
      commandTimer = null;
    }
    return safePublicConfig(readConfig());
  });
  ipcMain.handle("agent:openExternal", (_event, url) => shell.openExternal(url));

  createWindow();
  startHeartbeat();
  startDeviceCommandPolling();
  startUpdateChecks();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // Keep running in the background — the agent must stay reachable even with the
  // window closed. Only truly quit when the user/OS initiated it (before-quit).
  if (isQuitting && process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
