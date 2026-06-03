# Device install checklist

Target devices:

- Central server: Linux VPS/server owned by Nikolay.
- Nikolay: owner/admin user.
- Maksat: senior PM.
- One PM device for the first rollout test.

## Before Switching Devices

- Push only the safe deployment repository, preferably `control-plane`.
- Do not push `C:\Users\dasmu\agent\kickidler`.
- Do not push local secrets, `.env`, `data`, or `dist` folders.
- Keep Telegram bot token out of git. Paste it into the setup wizard after
  install.
- Bitrix webhook/API details are still pending.
- Install Tailscale on every target device and join the same company tailnet.
- Confirm Tailscale is connected before configuring access to the central
  server.
- Write down each device's role, Tailscale IPv4 address, and MagicDNS name if
  MagicDNS is enabled.
- Use ZeroTier as the backup VPN if Tailscale cannot be used.
- Use Radmin VPN only as a Windows-only fallback/legacy option.
- On devices where the Tailscale CLI is available, verify with:

```powershell
tailscale status
tailscale ip -4
```

## Fast Install Steps For Linux Central Server

Use these steps only on the central Linux server.

1. SSH into the server.
2. Clone the repo on the server.
3. Open Codex with the same account and tell Codex this is the Linux central
   server.
4. Read the central server prep runbook:

```text
~/agent/SERVER_PREP_RUNBOOK.md
```

5. Run preflight:

```bash
cd ~/agent/control-plane
sudo bash scripts/linux/preflight-linux-server.sh
```

6. Install the central server:

```bash
cd ~/agent/control-plane
sudo bash scripts/linux/install-linux.sh --start-now
```

7. Open setup through SSH tunnel:

```bash
ssh -L 3099:127.0.0.1:3099 <user>@<server-ip>
```

Then open locally:

```text
http://127.0.0.1:3099/setup
```

8. Fill setup:

- Telegram bot token: paste from the secure chat, do not save in git.
- Telegram report recipient: `984834133`.
- Nikolay owner Telegram ID: use Nikolay's numeric Telegram id.
- Metricon API base URL: `http://85.239.49.208:8080`.
- Metricon token: fill when available.
- Bitrix webhook: fill later.
- Google OAuth JSON: upload client JSON.
- Claude API key: paste and let setup store it encrypted.

9. Check server services:

```bash
curl -fsS http://127.0.0.1:3099/health
systemctl status company-control-plane-api.service --no-pager
systemctl status company-control-plane-telegram-bot.service --no-pager
```

## Fast Client Onboarding For Maksat And PMs

Do not install always-on API/bot tasks on Maksat or PM devices by default.

1. Install Tailscale and join the same company tailnet as Nikolay's server.
2. Record the device role, Tailscale IPv4 address, and MagicDNS name.
3. Register the user through the Telegram invite code from Nikolay.
4. Point the user to the central Telegram bot and, when available, central web
   UI URL.
5. Verify RBAC:

- Maksat can see own data plus subordinate PM data.
- Maksat cannot manage Nikolay or OWNER-only settings.
- PM can see only own user/project scope.

Clone `control-plane` or `openclaw` on client devices only for
development/testing or if a future local bridge is required.

## Notes

- The setup wizard encrypts secrets into local runtime storage.
- Automatic token usage reports go only to Telegram id `984834133`.
- Latest Sonnet policy is enforced by the service:
  `anthropic/claude-sonnet-4-6`.
- Existing OpenClaw sessions may need model reset before the default is visible.
