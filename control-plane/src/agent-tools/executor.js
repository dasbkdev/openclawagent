// Cross-platform device action executor for Starlab device agents.
//
// Used by both the headless CLI agent (src/device-agent.js) and the Electron
// desktop agent (desktop-agent/src/main.cjs, via dynamic import). Zero extra
// dependencies: only node:* modules. Every action is best-effort and driven by
// OS-native commands (PowerShell / osascript / shell) so we never need native
// npm packages.
//
// Contract:
//   supportedActionsForPlatform(platform) -> string[]  (capabilities)
//   executeAction({ type, args, platform, confirmCallback, runner })
//     -> { status: "succeeded"|"failed"|"unsupported"|"rejected", result, error }
//   executeAction never throws — everything is caught.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isSensitiveDeviceAction } from "../domain/device-agents.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const LONG_TIMEOUT_MS = 60_000;
const MAX_STDOUT_BYTES = 1_000_000; // ~1 MB cap for command stdout
const MAX_BASE64_BYTES = 3_000_000; // ~3 MB cap for screenshot/base64 payloads
const MAX_LIST_ENTRIES = 500;

// Which action types are realistically achievable per platform using only
// OS-native commands. File operations work everywhere (pure fs). The rest
// depend on platform tooling. This is reported honestly as capabilities so the
// server only queues commands the device can actually run.
const FILE_ACTIONS = [
  "read_file",
  "write_file",
  "list_dir",
  "search_files",
  "make_dir",
  "move_path",
  "delete_path",
];

const COMMON_ACTIONS = [
  "open_url",
  "open_file",
  "open_app",
  "notify",
  "run_script",
  "system_info",
  ...FILE_ACTIONS,
];

const PLATFORM_ACTIONS = Object.freeze({
  win32: [
    ...COMMON_ACTIONS,
    "close_app",
    "list_running_apps",
    "active_window",
    "screenshot",
    "clipboard_get",
    "clipboard_set",
    "keyboard_type",
    "hotkey",
    "media_control",
    "set_volume",
  ],
  darwin: [
    ...COMMON_ACTIONS,
    "close_app",
    "list_running_apps",
    "active_window",
    "screenshot",
    "clipboard_get",
    "clipboard_set",
    "keyboard_type",
    "hotkey",
    "media_control",
    "set_volume",
  ],
  // Linux is best-effort: file ops + run_script + open_url are reliable; the
  // GUI bits need optional tools (xdotool/wmctrl/scrot/notify-send) which may
  // not be installed. We still advertise them, and individual actions return a
  // clear "unsupported" message if the tool is missing at runtime.
  linux: [
    ...COMMON_ACTIONS,
    "list_running_apps",
    "active_window",
    "screenshot",
    "clipboard_get",
    "clipboard_set",
    "keyboard_type",
    "hotkey",
    "notify",
  ],
});

export function supportedActionsForPlatform(platform) {
  const list = PLATFORM_ACTIONS[platform];
  // Always expose at least file ops + run_script + system_info so an unknown
  // platform is not totally useless.
  return Array.from(new Set(list || [...FILE_ACTIONS, "run_script", "system_info"]));
}

// ---------------------------------------------------------------------------
// Pure command builders (exported for unit tests — no OS execution involved).
// ---------------------------------------------------------------------------

// Escape a string for embedding inside a PowerShell single-quoted literal.
export function escapePowerShellLiteral(value) {
  return String(value ?? "").replace(/'/gu, "''");
}

// Escape for a PowerShell double-quoted string. Backtick is the PS escape
// char; we keep %ENV% intact for ExpandEnvironmentVariables and forbid `$`
// expansion by escaping it.
export function escapePowerShellDouble(value) {
  return String(value ?? "")
    .replace(/`/gu, "``")
    .replace(/"/gu, '`"')
    .replace(/\$/gu, "`$");
}

// A target path may contain %ENV% placeholders expanded at runtime by
// [Environment]::ExpandEnvironmentVariables. Returned as-is here.
function expandableLiteral(value) {
  return String(value ?? "");
}

// Escape a string for embedding inside an AppleScript double-quoted string.
export function escapeAppleScriptLiteral(value) {
  return String(value ?? "")
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"');
}

// Map common human app names to candidate Windows launch targets. A
// human-readable name like "Visual Studio Code" is NOT a valid -FilePath;
// open_app tries these candidates in order until one launches.
const WINDOWS_APP_TARGETS = [
  { match: /visual studio code|vs ?code|вс ?код|вижуал/iu, targets: ["code", "code.cmd", "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe", "Code.exe"] },
  { match: /google chrome|chrome|хром/iu, targets: ["chrome", "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe", "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"] },
  { match: /firefox|файрфокс|фаерфокс/iu, targets: ["firefox", "%ProgramFiles%\\Mozilla Firefox\\firefox.exe"] },
  { match: /\bedge\b|майкрософт эдж|эдж/iu, targets: ["msedge"] },
  { match: /telegram|телеграм/iu, targets: ["Telegram", "%AppData%\\Telegram Desktop\\Telegram.exe"] },
  { match: /word|ворд/iu, targets: ["winword"] },
  { match: /excel|эксель/iu, targets: ["excel"] },
  { match: /power ?point|поинт/iu, targets: ["powerpnt"] },
  { match: /outlook|аутлук/iu, targets: ["outlook"] },
  { match: /notepad\+\+|нотпад\+\+/iu, targets: ["notepad++", "%ProgramFiles%\\Notepad++\\notepad++.exe"] },
  { match: /notepad|блокнот/iu, targets: ["notepad"] },
  { match: /calculator|калькул/iu, targets: ["calc"] },
  { match: /\bterminal\b|терминал/iu, targets: ["wt", "cmd"] },
  { match: /powershell|поверш/iu, targets: ["powershell"] },
  { match: /command prompt|\bcmd\b|командн/iu, targets: ["cmd"] },
  { match: /explorer|проводник|файлов/iu, targets: ["explorer"] },
  { match: /spotify|спотифай/iu, targets: ["spotify", "%AppData%\\Spotify\\Spotify.exe"] },
  { match: /zoom|зум/iu, targets: ["%AppData%\\Zoom\\bin\\Zoom.exe", "zoom"] },
  { match: /discord|дискорд/iu, targets: ["%LOCALAPPDATA%\\Discord\\Update.exe", "discord"] },
  { match: /paint|пейнт/iu, targets: ["mspaint"] },
];

function resolveWindowsAppTargets(name) {
  const raw = String(name || "").trim();
  if (!raw) {
    return [];
  }
  const known = WINDOWS_APP_TARGETS.find((entry) => entry.match.test(raw));
  const candidates = [];
  if (known) {
    candidates.push(...known.targets);
  }
  // Always also try the given name as-is and with .exe — covers exes on PATH.
  candidates.push(raw);
  if (!/\.[a-z0-9]{2,4}$/iu.test(raw)) {
    candidates.push(`${raw}.exe`);
  }
  return [...new Set(candidates)];
}

function buildWindowsOpenApp(args) {
  const name = args.name || args.app || args.path;
  const label = args.appLabel || name;
  const targets = resolveWindowsAppTargets(name);
  if (targets.length === 0) {
    return "Write-Error 'no app name'; exit 1";
  }
  // Try mapped candidates directly, then fall back to a universal lookup that
  // can open ANY installed app: Get-StartApps (Win32 + Store/UWP) and a Start
  // Menu shortcut search.
  const arrayLiteral = targets
    .map((t) => `"${escapePowerShellDouble(expandableLiteral(t))}"`)
    .join(", ");
  const labelLit = `"${escapePowerShellDouble(String(label))}"`;
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$cands = @(${arrayLiteral})`,
    "$ok = $false",
    "foreach ($c in $cands) {",
    "  try { Start-Process -FilePath ([System.Environment]::ExpandEnvironmentVariables($c)) -ErrorAction Stop; $ok = $true; break } catch {}",
    "}",
    `$needle = ${labelLit}`,
    "if (-not $ok) {",
    "  $apps = Get-StartApps | Where-Object { $_.Name -like ('*' + $needle + '*') }",
    "  if ($apps) { $b = $apps | Sort-Object { $_.Name.Length } | Select-Object -First 1; Start-Process ('shell:AppsFolder\\' + $b.AppID); Write-Output ('startapps:' + $b.Name); $ok = $true }",
    "}",
    "if (-not $ok) {",
    "  $roots = @(\"$env:ProgramData\\Microsoft\\Windows\\Start Menu\",\"$env:AppData\\Microsoft\\Windows\\Start Menu\")",
    "  $lnk = Get-ChildItem -Path $roots -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -like ('*' + $needle + '*') } | Sort-Object { $_.BaseName.Length } | Select-Object -First 1",
    "  if ($lnk) { Start-Process $lnk.FullName; Write-Output ('shortcut:' + $lnk.BaseName); $ok = $true }",
    "}",
    `if (-not $ok) { Write-Error ('Приложение не найдено: ' + ${labelLit}); exit 1 }`,
  ].join("; ");
}

// Build the PowerShell command string for a given action. Returns null when the
// action has no PowerShell-string form (handled by fs instead).
export function buildWindowsCommand(type, args = {}) {
  switch (type) {
    case "open_app":
      return buildWindowsOpenApp(args);
    case "close_app": {
      const name = escapePowerShellLiteral(stripExe(args.name || args.app));
      return `Stop-Process -Name '${name}' -Force -ErrorAction Stop`;
    }
    case "open_url":
    case "open_file": {
      const target = escapePowerShellLiteral(args.url || args.path || args.target);
      return `Start-Process '${target}'`;
    }
    case "list_running_apps":
      return "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Name, Id, MainWindowTitle | ConvertTo-Json -Compress";
    case "active_window":
      return "Get-Process | Where-Object { $_.MainWindowTitle } | Sort-Object -Property CPU -Descending | Select-Object -First 1 Name, Id, MainWindowTitle | ConvertTo-Json -Compress";
    case "clipboard_get":
      return "Get-Clipboard -Raw";
    case "clipboard_set":
      return `Set-Clipboard -Value '${escapePowerShellLiteral(args.text ?? args.value ?? "")}'`;
    case "keyboard_type":
      return `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellLiteral(
        toSendKeys(args.text ?? args.value ?? ""),
      )}')`;
    case "hotkey":
      return `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellLiteral(
        hotkeyToSendKeys(args.keys || args.combo || []),
      )}')`;
    case "media_control":
      return `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellLiteral(
        mediaControlToSendKeys(args.action || args.command),
      )}')`;
    case "set_volume":
      return buildWindowsVolumeCommand(args);
    case "notify":
      return buildWindowsNotifyCommand(args);
    case "screenshot":
      return buildWindowsScreenshotCommand();
    case "run_script":
      return String(args.script ?? args.command ?? "");
    default:
      return null;
  }
}

function buildPwshArgList(value) {
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => `'${escapePowerShellLiteral(item)}'`).join(",");
}

function buildWindowsVolumeCommand(args) {
  const level = clampVolume(args.level ?? args.volume);
  if (args.mute === true) {
    return "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([char]173)";
  }
  if (level == null) {
    return null;
  }
  // SendKeys lacks absolute volume; approximate by issuing volume-up presses
  // from a known floor. Best-effort — exact level is not guaranteed.
  const presses = Math.round((level / 100) * 50);
  return `Add-Type -AssemblyName System.Windows.Forms; 1..50 | ForEach-Object { [System.Windows.Forms.SendKeys]::SendWait([char]174) }; 1..${presses} | ForEach-Object { [System.Windows.Forms.SendKeys]::SendWait([char]175) }`;
}

function buildWindowsNotifyCommand(args) {
  const title = escapePowerShellLiteral(args.title || "Starlab Agent");
  const message = escapePowerShellLiteral(args.message || args.text || "");
  // msg * is brittle on Home editions; use a balloon tip via NotifyIcon which
  // works without extra modules.
  return [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "$n = New-Object System.Windows.Forms.NotifyIcon;",
    "$n.Icon = [System.Drawing.SystemIcons]::Information;",
    "$n.Visible = $true;",
    `$n.ShowBalloonTip(5000, '${title}', '${message}', [System.Windows.Forms.ToolTipIcon]::Info);`,
    "Start-Sleep -Milliseconds 5500; $n.Dispose()",
  ].join(" ");
}

function buildWindowsScreenshotCommand() {
  // Capture the primary screen to a PNG memory stream and emit base64.
  return [
    "Add-Type -AssemblyName System.Drawing;",
    "Add-Type -AssemblyName System.Windows.Forms;",
    "$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;",
    "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height;",
    "$g = [System.Drawing.Graphics]::FromImage($bmp);",
    "$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size);",
    "$ms = New-Object System.IO.MemoryStream;",
    "$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);",
    "$g.Dispose(); $bmp.Dispose();",
    "[Convert]::ToBase64String($ms.ToArray())",
  ].join(" ");
}

// Build a macOS command spec: { exec, args } where exec is osascript or a shell.
export function buildDarwinCommand(type, args = {}) {
  switch (type) {
    case "open_app":
      return { exec: "open", args: ["-a", String(args.name || args.app || "")] };
    case "open_url":
    case "open_file":
      return { exec: "open", args: [String(args.url || args.path || args.target || "")] };
    case "close_app":
      return osa(`tell application "${escapeAppleScriptLiteral(args.name || args.app || "")}" to quit`);
    case "list_running_apps":
      return osa('tell application "System Events" to get name of (every process whose background only is false)');
    case "active_window":
      return osa('tell application "System Events" to get name of first process whose frontmost is true');
    case "clipboard_get":
      return { exec: "pbpaste", args: [] };
    case "clipboard_set":
      return { exec: "pbcopy", args: [], stdin: String(args.text ?? args.value ?? "") };
    case "keyboard_type":
      return osa(`tell application "System Events" to keystroke "${escapeAppleScriptLiteral(args.text ?? args.value ?? "")}"`);
    case "hotkey":
      return osa(buildDarwinHotkeyScript(args.keys || args.combo || []));
    case "notify":
      return osa(
        `display notification "${escapeAppleScriptLiteral(args.message || args.text || "")}" with title "${escapeAppleScriptLiteral(
          args.title || "Starlab Agent",
        )}"`,
      );
    case "set_volume": {
      const level = clampVolume(args.level ?? args.volume);
      if (args.mute === true) {
        return osa("set volume with output muted");
      }
      if (level == null) {
        return null;
      }
      return osa(`set volume output volume ${level}`);
    }
    case "media_control":
      return osa(buildDarwinMediaScript(args.action || args.command));
    case "run_script":
      if (String(args.lang || "").toLowerCase() === "applescript") {
        return osa(String(args.script ?? args.command ?? ""));
      }
      return { exec: "/bin/sh", args: ["-c", String(args.script ?? args.command ?? "")] };
    default:
      return null;
  }
}

function osa(script) {
  return { exec: "osascript", args: ["-e", script] };
}

function buildDarwinHotkeyScript(keys) {
  const list = Array.isArray(keys) ? keys : String(keys || "").split("+");
  const modifiers = [];
  const plain = [];
  for (const key of list) {
    const k = String(key).trim().toLowerCase();
    if (["cmd", "command", "meta"].includes(k)) modifiers.push("command down");
    else if (["ctrl", "control"].includes(k)) modifiers.push("control down");
    else if (["alt", "option"].includes(k)) modifiers.push("option down");
    else if (k === "shift") modifiers.push("shift down");
    else if (k) plain.push(k);
  }
  const letter = escapeAppleScriptLiteral(plain[plain.length - 1] || "");
  const using = modifiers.length ? ` using {${modifiers.join(", ")}}` : "";
  return `tell application "System Events" to keystroke "${letter}"${using}`;
}

function buildDarwinMediaScript(action) {
  const map = {
    playpause: 16,
    play: 16,
    pause: 16,
    next: 17,
    previous: 18,
    prev: 18,
  };
  const code = map[String(action || "playpause").toLowerCase()] ?? 16;
  return `tell application "System Events" to key code ${code}`;
}

// Build a Linux command spec. Returns { exec, args } or { unsupported: msg }.
export function buildLinuxCommand(type, args = {}) {
  switch (type) {
    case "open_app":
      return { exec: String(args.name || args.app || ""), args: toArgArray(args.args), detached: true };
    case "open_url":
    case "open_file":
      return { exec: "xdg-open", args: [String(args.url || args.path || args.target || "")] };
    case "list_running_apps":
      return { exec: "wmctrl", args: ["-l"], requires: "wmctrl" };
    case "active_window":
      return { exec: "xdotool", args: ["getactivewindow", "getwindowname"], requires: "xdotool" };
    case "clipboard_get":
      return { exec: "xclip", args: ["-selection", "clipboard", "-o"], requires: "xclip" };
    case "clipboard_set":
      return {
        exec: "xclip",
        args: ["-selection", "clipboard"],
        stdin: String(args.text ?? args.value ?? ""),
        requires: "xclip",
      };
    case "keyboard_type":
      return { exec: "xdotool", args: ["type", "--", String(args.text ?? args.value ?? "")], requires: "xdotool" };
    case "hotkey":
      return {
        exec: "xdotool",
        args: ["key", "--", linuxHotkeyString(args.keys || args.combo || [])],
        requires: "xdotool",
      };
    case "notify":
      return {
        exec: "notify-send",
        args: [String(args.title || "Starlab Agent"), String(args.message || args.text || "")],
        requires: "notify-send",
      };
    case "screenshot":
      // scrot to stdout via "-"; base64 conversion handled by caller reading file.
      return { exec: "scrot", args: ["-z", "/tmp/starlab-screenshot.png"], requires: "scrot", screenshotFile: "/tmp/starlab-screenshot.png" };
    case "run_script":
      return { exec: "/bin/sh", args: ["-c", String(args.script ?? args.command ?? "")] };
    default:
      return { unsupported: `Action "${type}" is not supported on linux` };
  }
}

function linuxHotkeyString(keys) {
  const list = Array.isArray(keys) ? keys : String(keys || "").split("+");
  return list
    .map((k) => {
      const key = String(k).trim().toLowerCase();
      if (["cmd", "command", "meta"].includes(key)) return "super";
      if (key === "control") return "ctrl";
      return key;
    })
    .filter(Boolean)
    .join("+");
}

// ---------------------------------------------------------------------------
// Helpers shared across platforms.
// ---------------------------------------------------------------------------

function stripExe(name) {
  return String(name || "").replace(/\.exe$/iu, "");
}

function toArgArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function clampVolume(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

// Escape special SendKeys characters: + ^ % ~ ( ) { } [ ]
function toSendKeys(text) {
  return String(text).replace(/([+^%~(){}[\]])/gu, "{$1}");
}

function hotkeyToSendKeys(keys) {
  const list = Array.isArray(keys) ? keys : String(keys || "").split("+");
  let prefix = "";
  let mainKey = "";
  for (const key of list) {
    const k = String(key).trim().toLowerCase();
    if (["ctrl", "control"].includes(k)) prefix += "^";
    else if (["alt", "option"].includes(k)) prefix += "%";
    else if (k === "shift") prefix += "+";
    else if (["win", "cmd", "meta"].includes(k)) prefix += "^"; // no native Win key in SendKeys
    else if (k) mainKey = sendKeysSpecial(k);
  }
  return `${prefix}${mainKey}`;
}

function sendKeysSpecial(key) {
  const specials = {
    enter: "{ENTER}",
    esc: "{ESC}",
    escape: "{ESC}",
    tab: "{TAB}",
    space: " ",
    backspace: "{BACKSPACE}",
    delete: "{DELETE}",
    home: "{HOME}",
    end: "{END}",
    up: "{UP}",
    down: "{DOWN}",
    left: "{LEFT}",
    right: "{RIGHT}",
  };
  return specials[key] || key;
}

function mediaControlToSendKeys(action) {
  const map = {
    playpause: "{MEDIA_PLAY_PAUSE}",
    play: "{MEDIA_PLAY_PAUSE}",
    pause: "{MEDIA_PLAY_PAUSE}",
    next: "{MEDIA_NEXT_TRACK}",
    previous: "{MEDIA_PREV_TRACK}",
    prev: "{MEDIA_PREV_TRACK}",
    stop: "{MEDIA_STOP}",
  };
  return map[String(action || "playpause").toLowerCase()] || "{MEDIA_PLAY_PAUSE}";
}

// ---------------------------------------------------------------------------
// Execution.
// ---------------------------------------------------------------------------

// Default runner: execFile a binary with args, return { stdout, stderr }.
function defaultRunner({ exec, args = [], stdin, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      exec,
      args,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: MAX_STDOUT_BYTES + MAX_BASE64_BYTES },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      },
    );
    if (stdin != null && child.stdin) {
      child.stdin.write(String(stdin));
      child.stdin.end();
    }
  });
}

function clampStdout(value, limit = MAX_STDOUT_BYTES) {
  const text = String(value ?? "");
  return text.length > limit ? text.slice(0, limit) : text;
}

export async function executeAction({ type, args = {}, platform = process.platform, confirmCallback, runner } = {}) {
  try {
    if (!type) {
      return { status: "unsupported", error: "Missing action type" };
    }

    const supported = supportedActionsForPlatform(platform);
    const isFileAction = FILE_ACTIONS.includes(type);
    if (!supported.includes(type) && !isFileAction) {
      return { status: "unsupported", error: `Action "${type}" is not supported on ${platform}` };
    }

    // Sensitive-action gate. Without confirmation these never run.
    if (isSensitiveDeviceAction(type)) {
      const allowedByEnv = String(process.env.DEVICE_AGENT_ALLOW_SENSITIVE || "").toLowerCase() === "true";
      let confirmed = allowedByEnv;
      if (!confirmed && typeof confirmCallback === "function") {
        try {
          confirmed = (await confirmCallback({ type, args })) === true;
        } catch {
          confirmed = false;
        }
      }
      if (!confirmed) {
        return { status: "rejected", error: "confirmation required" };
      }
    }

    const run = runner || defaultRunner;

    // Pure-fs file actions are platform-independent.
    if (isFileAction) {
      return await executeFileAction(type, args);
    }

    if (type === "system_info") {
      return { status: "succeeded", result: collectSystemInfo() };
    }

    switch (platform) {
      case "win32":
        return await executeWindows(type, args, run);
      case "darwin":
        return await executeDarwin(type, args, run);
      case "linux":
        return await executeLinux(type, args, run);
      default:
        return { status: "unsupported", error: `Platform ${platform} is not supported` };
    }
  } catch (error) {
    return { status: "failed", error: error?.message || String(error) };
  }
}

async function executeWindows(type, args, run) {
  const command = buildWindowsCommand(type, args);
  if (command == null) {
    return { status: "unsupported", error: `Action "${type}" has no Windows implementation` };
  }
  const isHeavy = type === "screenshot" || type === "run_script";
  const { stdout } = await run({
    exec: "powershell",
    args: ["-NoProfile", "-NonInteractive", "-Command", command],
    timeoutMs: isHeavy ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
  });
  return shapeResult(type, stdout);
}

async function executeDarwin(type, args, run) {
  const spec = buildDarwinCommand(type, args);
  if (!spec) {
    return { status: "unsupported", error: `Action "${type}" has no macOS implementation` };
  }
  if (type === "screenshot") {
    return await captureFileScreenshot(run, {
      exec: "screencapture",
      buildArgs: (file) => ["-x", file],
    });
  }
  const isHeavy = type === "run_script";
  const { stdout } = await run({
    exec: spec.exec,
    args: spec.args,
    stdin: spec.stdin,
    timeoutMs: isHeavy ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
  });
  return shapeResult(type, stdout);
}

async function executeLinux(type, args, run) {
  if (type === "screenshot") {
    return await captureFileScreenshot(run, {
      exec: "scrot",
      buildArgs: (file) => ["-z", file],
      requires: "scrot",
    });
  }
  const spec = buildLinuxCommand(type, args);
  if (spec?.unsupported) {
    return { status: "unsupported", error: spec.unsupported };
  }
  if (spec?.requires && !(await hasBinary(spec.requires, run))) {
    return { status: "unsupported", error: `Required tool "${spec.requires}" is not installed` };
  }
  const isHeavy = type === "run_script";
  const { stdout } = await run({
    exec: spec.exec,
    args: spec.args,
    stdin: spec.stdin,
    timeoutMs: isHeavy ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
  });
  return shapeResult(type, stdout);
}

async function hasBinary(name, run) {
  try {
    await run({ exec: "which", args: [name], timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function captureFileScreenshot(run, { exec, buildArgs, requires }) {
  if (requires && !(await hasBinary(requires, run))) {
    return { status: "unsupported", error: `Required tool "${requires}" is not installed` };
  }
  const file = path.join(os.tmpdir(), `starlab-screenshot-${Date.now()}.png`);
  try {
    await run({ exec, args: buildArgs(file), timeoutMs: LONG_TIMEOUT_MS });
    const buffer = await fs.readFile(file);
    if (buffer.length > MAX_BASE64_BYTES) {
      return { status: "failed", error: "Screenshot exceeds size limit" };
    }
    return { status: "succeeded", result: { format: "png", base64: buffer.toString("base64") } };
  } finally {
    await fs.rm(file, { force: true }).catch(() => {});
  }
}

// Shape stdout into a typed result object per action.
function shapeResult(type, rawStdout) {
  const stdout = clampStdout(rawStdout);
  switch (type) {
    case "screenshot": {
      const base64 = stdout.replace(/\s+/gu, "");
      if (base64.length > MAX_BASE64_BYTES) {
        return { status: "failed", error: "Screenshot exceeds size limit" };
      }
      return { status: "succeeded", result: { format: "png", base64 } };
    }
    case "clipboard_get":
      return { status: "succeeded", result: { text: stdout.replace(/\r?\n$/u, "") } };
    case "list_running_apps":
    case "active_window":
      return { status: "succeeded", result: { raw: stdout.trim(), parsed: tryParseJson(stdout) } };
    default:
      return { status: "succeeded", result: { output: stdout.trim() } };
  }
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// File actions (pure fs, platform-independent).
// ---------------------------------------------------------------------------

async function executeFileAction(type, args) {
  switch (type) {
    case "read_file": {
      const target = requirePath(args.path || args.target);
      const buffer = await fs.readFile(target);
      if (buffer.length > MAX_STDOUT_BYTES) {
        return { status: "failed", error: "File exceeds read size limit" };
      }
      const encoding = args.encoding === "base64" ? "base64" : "utf8";
      return { status: "succeeded", result: { path: target, encoding, content: buffer.toString(encoding) } };
    }
    case "write_file": {
      const target = requirePath(args.path || args.target);
      const content = String(args.content ?? args.text ?? "");
      const encoding = args.encoding === "base64" ? "base64" : "utf8";
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(content, encoding));
      return { status: "succeeded", result: { path: target, bytes: Buffer.byteLength(content, encoding) } };
    }
    case "list_dir": {
      const target = requirePath(args.path || args.target || ".");
      const entries = await fs.readdir(target, { withFileTypes: true });
      const items = entries.slice(0, MAX_LIST_ENTRIES).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
      }));
      return { status: "succeeded", result: { path: target, entries: items, total: entries.length } };
    }
    case "search_files": {
      const root = requirePath(args.path || args.root || ".");
      const pattern = String(args.pattern || args.query || "").toLowerCase();
      const matches = await searchFiles(root, pattern, Number(args.maxDepth) || 5);
      return { status: "succeeded", result: { root, pattern, matches } };
    }
    case "make_dir": {
      const target = requirePath(args.path || args.target);
      await fs.mkdir(target, { recursive: true });
      return { status: "succeeded", result: { path: target } };
    }
    case "move_path": {
      const from = requirePath(args.from || args.source);
      const to = requirePath(args.to || args.destination);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      return { status: "succeeded", result: { from, to } };
    }
    case "delete_path": {
      const target = requirePath(args.path || args.target);
      await fs.rm(target, { recursive: Boolean(args.recursive), force: Boolean(args.force) });
      return { status: "succeeded", result: { path: target, deleted: true } };
    }
    default:
      return { status: "unsupported", error: `Unknown file action "${type}"` };
  }
}

function requirePath(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error("Path argument is required");
  }
  return path.resolve(expandHome(normalized));
}

function expandHome(value) {
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(1));
  }
  return value;
}

async function searchFiles(root, pattern, maxDepth) {
  const matches = [];
  async function walk(dir, depth) {
    if (depth > maxDepth || matches.length >= MAX_LIST_ENTRIES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= MAX_LIST_ENTRIES) return;
      const full = path.join(dir, entry.name);
      if (!pattern || entry.name.toLowerCase().includes(pattern)) {
        matches.push(full);
      }
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(root, 0);
  return matches;
}

function collectSystemInfo() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    hostname: os.hostname(),
    uptimeSeconds: Math.round(os.uptime()),
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    cpuCount: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || null,
    loadAverage: os.loadavg(),
    userInfo: { username: os.userInfo().username, homedir: os.homedir() },
  };
}
