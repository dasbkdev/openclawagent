# starlab-browser-service

Isolated Playwright (Chromium) browser-automation microservice for Starlab
Agent. The assistant uses it to "browse the web like a human": navigate,
click, type, read text, extract links, and take screenshots.

It is a **separate module** with its own `package.json` and a `playwright`
dependency. The main `control-plane` stays zero-dependency — it only talks to
this service over local HTTP.

## Architecture

- `src/validate.js` — pure request validation / step normalization / auth
  checks. **No playwright import.** Unit-tested on CI without a browser.
- `src/browser.js` — Playwright controller. One Chromium per process (lazy
  launch + reuse); a fresh `context` + `page` per task, closed in `finally`.
- `src/server.js` — `node:http` server bound to `127.0.0.1`.
- `test/browser-service.test.js` — pure-logic tests (`node --test`), no
  Chromium required.

## Install

```bash
npm install
npx playwright install chromium        # download the Chromium build
# On Ubuntu (server) also install OS libs Chromium needs:
npx playwright install-deps chromium   # or: npx playwright install --with-deps chromium
```

> The CI / unit tests do **not** require Chromium. You only need the two
> `playwright install` steps on the host that actually runs the browser.

## Run

```bash
npm start
# → [browser-service] listening on http://127.0.0.1:3210 (loopback-only)
```

### Environment variables

| Var | Default | Meaning |
|---|---|---|
| `BROWSER_SERVICE_PORT` | `3210` | TCP port (bound to `127.0.0.1` only) |
| `BROWSER_SERVICE_TOKEN` | _(unset)_ | If set, requests must send `X-Browser-Token: <token>`. If unset, only loopback callers are allowed. |

## HTTP API

### `GET /health`

Unauthenticated.

```json
{ "ok": true, "service": "starlab-browser-service" }
```

### `POST /api/v1/browse/run`

Runs a sequence of steps in a single browser session.

Headers: `Content-Type: application/json` and, if a token is configured,
`X-Browser-Token: <token>`.

Request body:

```json
{
  "url": "https://example.com",
  "timeoutMs": 45000,
  "stepTimeoutMs": 15000,
  "returnText": true,
  "screenshot": false,
  "steps": [
    { "action": "type", "selector": "input[name=q]", "text": "starlab", "submit": true },
    { "action": "wait", "selector": "#results" },
    { "action": "extract_text", "selector": "#results" },
    { "action": "extract_links" }
  ]
}
```

`url` is the initial navigation (optional if the first step is a `goto`).

### Supported step actions

| action | args | result `value` |
|---|---|---|
| `goto` | `url` (http/https only) | final url |
| `click` | `selector` **or** `text` | — |
| `type` | `selector`, `text`, `submit?` | — |
| `press` | `key` (e.g. `Enter`) | — |
| `wait` | `ms` **or** `selector` | — |
| `extract_text` | `selector?` (default: visible body text) | text (truncated ~20KB) |
| `extract_links` | — | `[{text, href}]` (visible only, max 200) |
| `screenshot` | `fullPage?` | `{screenshot: <base64 png>}` |
| `scroll` | `direction` (`down`/`up`/`to`), `selector?` (for `to`), `amount?` | — |
| `select` | `selector`, `value` | — |

### Response

```json
{
  "ok": true,
  "finalUrl": "https://example.com/results",
  "title": "Results",
  "text": "…(present when returnText:true)…",
  "screenshot": "…base64 png (present when screenshot:true)…",
  "steps": [
    { "action": "type", "status": "ok" },
    { "action": "extract_text", "status": "ok", "value": "…" }
  ],
  "elapsedMs": 1234
}
```

On failure the service never returns a bare 500 — it returns a structured
body, e.g. `{ "ok": false, "error": "…" }`. A failing step stops the
sequence and is recorded with `"status": "error"` and an `"error"` message.

## How control-plane should call it

- Method/path: `POST http://127.0.0.1:3210/api/v1/browse/run`
- Header: `X-Browser-Token: <BROWSER_SERVICE_TOKEN>` (when configured)
- Body: the JSON shown above; read `result.text`, `result.steps[*].value`,
  and `result.screenshot`.

Use the built-in `fetch` (Node ≥22, zero deps):

```js
const res = await fetch("http://127.0.0.1:3210/api/v1/browse/run", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-browser-token": process.env.BROWSER_SERVICE_TOKEN ?? "",
  },
  body: JSON.stringify({ url, steps, returnText: true }),
});
const data = await res.json();
```

## Security model

- Binds to `127.0.0.1` only — not reachable off-host.
- Auth: `X-Browser-Token` must match `BROWSER_SERVICE_TOKEN`; if no token is
  set, only loopback callers are accepted.
- **No arbitrary JS execution from requests** — no `eval`, and no
  `page.evaluate` with caller-supplied strings. Only the fixed action set
  above is allowed; unknown actions are rejected at validation time.
- `goto` accepts **http/https only** — `file:`, `about:`, `data:`,
  `javascript:` and relative URLs are rejected.
- File downloads are blocked (`acceptDownloads: false` + `download` cancel).
- Request bodies capped at 256KB; extracted text truncated (~20KB);
  screenshots capped (~3MB base64); per-step and global task timeouts.
- Chromium runs headless with `--no-sandbox --disable-dev-shm-usage`
  (required in most server/container environments).

## Test

```bash
npm test          # node --test test/*.test.js  — no Chromium needed
```

## Deployment note (systemd)

Run as a dedicated service alongside control-plane. Example unit:

```ini
# /etc/systemd/system/starlab-browser-service.service
[Unit]
Description=Starlab Browser Service (Playwright)
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/lib/company-control-plane/browser-service
ExecStart=/usr/bin/node src/server.js
Environment=BROWSER_SERVICE_PORT=3210
Environment=BROWSER_SERVICE_TOKEN=__set_me__
# Chromium needs a writable home for its profile/cache:
Environment=HOME=/var/lib/company-control-plane/browser-service
Restart=on-failure
RestartSec=3
# Hardening (relax if Chromium needs more):
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now starlab-browser-service
sudo systemctl status starlab-browser-service
```

Deployment is performed by the Architect — see project rules.
