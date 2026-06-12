# Starlab OpenClaw Agent for Windows and Linux

This desktop target is the Starlab-managed local agent that lives inside the
OpenClaw source tree. It is the employee computer "hands" for the central
Telegram/n8n/control-plane assistant at `https://starlabagent.pp.ua`.

The app does not ask employees for an AI provider, Claude key, or Telegram
channel. On first launch it asks only for the Starlab registration code created
by Nikolay. After activation it stores only a per-device token locally.

## Runtime Flow

1. Nikolay creates a registration code in the Telegram bot.
2. The employee launches the desktop app and enters that code.
3. The app calls `POST /api/v1/device-agents/activate`.
4. The server returns the employee, role, device, and device token.
5. Electron stores the token with `safeStorage` when OS encryption is available.
6. The app sends heartbeat every 60 seconds.
7. The app polls `/api/v1/device-agents/commands` every 5 seconds.
8. Local commands execute on the employee computer and report results back to
   `/api/v1/device-agents/commands/:id/result`.
9. Employee chat inside the app uses `POST /api/v1/local-agent/chat`, the same
   server-side brain and memory as the Telegram bot.

## Supported Commands

- `open_app`
- `close_app`
- `open_url`
- `open_file`
- `list_running_apps`
- `active_window`
- `screenshot`
- `clipboard_get`
- `clipboard_set`
- `keyboard_type`
- `hotkey`
- `mouse_click`

`ocr_screen` and `openclaw_prompt` are reserved for a later deeper OpenClaw
tool bridge.

## Build

```powershell
npm install
npm run build:win
```

The Windows artifact is:

```text
dist/starlab-openclaw-agent-windows.exe
```

Linux Debian package:

```powershell
npm run build:linux
```

```text
dist/starlab-openclaw-agent-linux-amd64.deb
```
