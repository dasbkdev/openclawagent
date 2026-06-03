# Device install checklist

Target devices:

- Nikolay: owner/main 24/7 Windows computer.
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
- Confirm Tailscale is connected before configuring agent-to-agent traffic.
- Write down each device's role, Tailscale IPv4 address, and MagicDNS name if
  MagicDNS is enabled.
- Use ZeroTier as the backup VPN if Tailscale cannot be used.
- Use Radmin VPN only as a Windows-only fallback/legacy option.
- On devices where the Tailscale CLI is available, verify with:

```powershell
tailscale status
tailscale ip -4
```

## Fast Install Steps

1. Clone the repo on the target device.
2. Open Codex with the same account and tell Codex which device it is.
3. Preferred after clone: run source installer as Administrator:

```powershell
cd C:\agent\control-plane
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -InstallTelegramBot -OpenSetupWizard
```

If a ready `.exe` was copied separately, run it as Administrator instead:

```powershell
C:\agent\control-plane\dist\CompanyControlPlaneInstaller.exe
```

4. Open setup if it did not open automatically:

```text
http://127.0.0.1:3099/setup
```

5. Fill setup:

- Telegram bot token: paste from the secure chat, do not save in git.
- Telegram report recipient: `984834133`.
- Nikolay owner Telegram ID: use Nikolay's numeric Telegram id.
- Metricon API base URL: `http://85.239.49.208:8080`.
- Metricon token: fill when available.
- Bitrix webhook: fill later.
- Google OAuth JSON: upload client JSON.
- Claude API key: paste and let setup store it encrypted.

6. Check:

```powershell
Invoke-RestMethod http://127.0.0.1:3099/health
Start-Process http://127.0.0.1:3099/setup
Get-ScheduledTask CompanyControlPlaneApi
Get-ScheduledTask CompanyControlPlaneTelegramBot
```

## Notes

- The setup wizard encrypts secrets into local runtime storage.
- Automatic token usage reports go only to Telegram id `984834133`.
- Latest Sonnet policy is enforced by the service:
  `anthropic/claude-sonnet-4-6`.
- Existing OpenClaw sessions may need model reset before the default is visible.
