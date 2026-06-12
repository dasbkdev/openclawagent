# Linux Install On Central Server

This install flow is for the centralized Linux server.

Recommended production layout:

```text
/opt/company-control-plane          # installed application files
/etc/company-control-plane          # non-secret environment file
/var/lib/company-control-plane      # runtime state and encrypted secrets
```

Systemd services:

```text
company-control-plane-api.service
company-control-plane-telegram-bot.service
```

## Requirements

- Linux with `systemd`.
- Root/sudo access.
- Node.js `22+`, installed system-wide rather than only through `nvm`.
- Git.
- Tailscale for private network access.
- Stable internet access for Telegram, Claude, Metricon, Bitrix, and Google
  APIs.

GPU is not required because Claude/Sonnet runs through API calls.

## Server Preflight

SSH into the server and run:

```bash
cd ~/agent/control-plane
sudo bash scripts/linux/preflight-linux-server.sh
```

Fix any `FAIL` result before installing. `WARN` results can be acceptable for a
pilot if the tradeoff is understood.

## Install

From the `control-plane` checkout:

```bash
cd ~/agent/control-plane
sudo bash scripts/linux/install-linux.sh --start-now
```

This installs both API and Telegram bot services.

If the Telegram bot should not be installed yet:

```bash
sudo bash scripts/linux/install-linux.sh --no-bot --start-now
```

By default the API binds to localhost:

```text
HOST=127.0.0.1
PORT=3099
```

Keep this default for the first pilot. Use SSH tunnel or Tailscale-only firewall
rules before exposing the setup UI to other devices.

## Setup Wizard

Open the setup wizard through SSH tunnel:

```bash
ssh -L 3099:127.0.0.1:3099 <user>@<server-ip>
```

Then open locally:

```text
http://127.0.0.1:3099/setup
```

Fill:

- Nikolay Telegram numeric ID.
- Telegram bot token.
- Claude API key.
- Metricon base URL.
- Metricon access token or refresh token. Refresh token is preferred because
  Metricon access tokens are short lived.
- Bitrix webhook/API credentials.
- Google OAuth client JSON.
- Token usage report recipient: `984834133`.
- Optional token usage ingest token.

Do not write production secrets into `/etc/company-control-plane/control-plane.env`.
Use the setup wizard so secrets are encrypted at rest.

## Check

```bash
curl -fsS http://127.0.0.1:3099/health
systemctl status company-control-plane-api.service --no-pager
systemctl status company-control-plane-telegram-bot.service --no-pager
journalctl -u company-control-plane-api.service -n 80 --no-pager
journalctl -u company-control-plane-telegram-bot.service -n 80 --no-pager
```

Tailscale:

```bash
tailscale status
tailscale ip -4
```

## Restart

```bash
cd ~/agent/control-plane
sudo bash scripts/linux/restart-linux.sh
```

or:

```bash
sudo systemctl restart company-control-plane-api.service
sudo systemctl restart company-control-plane-telegram-bot.service
```

## Runtime Files

Non-secret environment:

```text
/etc/company-control-plane/control-plane.env
```

Runtime state and encrypted setup files:

```text
/var/lib/company-control-plane/control-plane.json
/var/lib/company-control-plane/runtime-config.json
/var/lib/company-control-plane/secrets.json
/var/lib/company-control-plane/secrets.key
```

Back up `secrets.json` and `secrets.key` together. If `secrets.key` is lost,
encrypted secrets cannot be restored.

## Firewall

For the pilot:

- allow SSH only from trusted operator IPs;
- do not expose port `3099` to the public internet;
- use SSH tunnel for setup;
- use Tailscale for private server access;
- keep Telegram as the main external user channel.

If the web UI must be reachable later, add HTTPS/reverse proxy and strict access
rules before public exposure.

## Uninstall

Preserve runtime data:

```bash
cd ~/agent/control-plane
sudo bash scripts/linux/uninstall-linux.sh
```

Remove runtime data too:

```bash
sudo bash scripts/linux/uninstall-linux.sh --remove-data
```
