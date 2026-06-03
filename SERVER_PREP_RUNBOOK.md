# Central Server Prep Runbook

This runbook prepares the centralized server for the company agent product.

Current target:

- One centralized server.
- MVP server location: rented Linux server/VPS.
- All other devices are clients by default.
- Users interact through Telegram, central web UI, or a future local bridge.

## Server Role

The server is responsible for:

- control-plane HTTP API;
- setup wizard;
- Telegram bot runner;
- scheduled token usage reports;
- central agent/orchestrator;
- encrypted secret storage;
- Metricon, Bitrix, Google, Jira, Gmail connectors;
- audit log;
- token usage analytics;
- role and hierarchy enforcement.

The server is the only place that should store production API keys and OAuth
tokens.

## Recommended Server Spec

Minimum for pilot:

```text
CPU: 2 cores
RAM: 4 GB
Disk: 30-50 GB free SSD
OS: Linux with systemd
Network: stable internet
```

Recommended:

```text
CPU: 4 cores
RAM: 8-16 GB
Disk: 100 GB+ SSD
OS: Ubuntu Server 22.04+/24.04+, Debian 12+, or another systemd Linux
Network: stable internet plus Tailscale
```

GPU is not required because Claude/Sonnet runs through API calls, not locally.

Windows is no longer the preferred server path. Windows install docs remain as a
fallback under:

```text
control-plane\docs\WINDOWS_INSTALL.md
```

## What To Send Codex Before Remote Setup

Use temporary credentials and rotate them after setup.

Needed:

- server public IP or host name;
- SSH username;
- temporary SSH password or key;
- whether this user has `sudo`;
- Linux distribution/version;
- SSH port if not `22`;
- whether Tailscale is already installed;
- repo clone URL and branch if different from current `develop`;
- GitHub access method if the repo is private.

Do not send these in repo files:

- Telegram bot token;
- Claude API key;
- Metricon access token;
- Bitrix webhook;
- Google OAuth JSON;
- Jira/Gmail/Google tokens.

These secrets should be entered through the setup wizard after the server is
installed.

## Target Paths

Source checkout:

```text
~/agent
~/agent/control-plane
```

Installed app:

```text
/opt/company-control-plane
```

Non-secret config:

```text
/etc/company-control-plane/control-plane.env
```

Runtime data:

```text
/var/lib/company-control-plane
```

Important runtime files:

```text
/var/lib/company-control-plane/control-plane.json
/var/lib/company-control-plane/runtime-config.json
/var/lib/company-control-plane/secrets.json
/var/lib/company-control-plane/secrets.key
```

## Preflight

Run through SSH:

```bash
cd ~/agent/control-plane
sudo bash scripts/linux/preflight-linux-server.sh
```

The script checks:

- root/sudo privileges;
- Linux distribution;
- systemd availability;
- CPU cores;
- RAM;
- free disk space;
- Git availability;
- Node.js availability;
- Tailscale availability;
- port `3099`;
- scheduled task state;
- install and data directories.

Node.js `22+` is required before installing and should be installed system-wide,
not only through `nvm`, because the systemd service runs under a dedicated
service user. Git and Tailscale should normally be installed before production
setup.

## SSH Connectivity Troubleshooting

If SSH from Codex times out, the password has not been checked yet. A timeout
usually means port `22` is blocked by Linux firewall, provider firewall/security
group, or `sshd` is not listening on the public interface.

On the server console/provider panel, run:

```bash
sudo systemctl status ssh --no-pager || sudo systemctl status sshd --no-pager
sudo ss -ltnp | grep ':22'
sudo grep -E '^(Port|ListenAddress|PasswordAuthentication|PubkeyAuthentication)' /etc/ssh/sshd_config
```

If UFW is enabled:

```bash
sudo ufw status verbose
sudo ufw allow from <operator-public-ip> to any port 22 proto tcp
```

If firewalld is enabled:

```bash
sudo firewall-cmd --state
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="<operator-public-ip>" port protocol="tcp" port="22" accept'
sudo firewall-cmd --reload
```

If the server provider has a separate firewall/security group, allow inbound TCP
`22`. Safer option: allow it only from the operator's current public IP instead
of the whole internet.

After changing firewall settings, test from the operator machine:

```bash
ssh -o ConnectTimeout=12 ssh@<server-ip> hostname
```

## Install Flow

1. Log in through SSH.
2. Install Git, Node.js `22+`, and Tailscale if missing.
3. Join the company Tailscale tailnet.
4. Clone the repo:

```bash
mkdir -p ~/agent
cd ~/agent
git clone <repo-url> .
git checkout develop
```

If the repo is cloned as a folder:

```bash
cd ~
mkdir -p agent
cd agent
git clone <repo-url> openclawagent
cd ~/agent/openclawagent
git checkout develop
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

7. Open setup wizard through SSH tunnel:

```bash
ssh -L 3099:127.0.0.1:3099 <user>@<server-ip>
```

Then open:

```text
http://127.0.0.1:3099/setup
```

8. Fill setup values:

- Nikolay Telegram numeric ID;
- Telegram bot token;
- Claude API key;
- Metricon base URL;
- Metricon access token;
- Bitrix webhook/API credentials;
- Google OAuth client JSON;
- token usage report recipient: `984834133`;
- optional token usage ingest token.

9. Restart services if needed:

```bash
cd ~/agent/control-plane
sudo bash scripts/linux/restart-linux.sh
```

## Verification

Run:

```bash
curl -fsS http://127.0.0.1:3099/health
systemctl status company-control-plane-api.service --no-pager
systemctl status company-control-plane-telegram-bot.service --no-pager
tailscale status
tailscale ip -4
```

Expected:

- API returns a health response.
- Both systemd services exist.
- API service starts at boot.
- Telegram bot service starts at boot.
- Tailscale shows the server connected to the correct tailnet.

## Firewall

For the first pilot, keep the API local/private only.

Recommended:

- do not expose `3099` to the public internet;
- use Tailscale/private network for central web UI/API access;
- keep Telegram as the main external channel;
- add HTTPS/reverse proxy before any public web exposure.

## Backup

Back up this folder daily:

```text
/var/lib/company-control-plane
```

Important:

- `secrets.json` and `secrets.key` must be backed up together.
- If `secrets.key` is lost, encrypted secrets cannot be restored.
- Keep backups outside git.

Suggested backup target:

```text
/var/backups/company-control-plane
```

or a secure cloud/drive folder controlled by the owner.

## Client Onboarding After Server Is Ready

For Maksat and PM devices:

1. Install Tailscale and join the same tailnet.
2. Register through Telegram invite code.
3. Use the central Telegram bot.
4. Optional: open central web UI over Tailscale when implemented.
5. Do not install always-on API/bot tasks on client devices unless explicitly
   requested for development/testing.

## Open Server Tasks

- Decide whether this rented server replaces Nikolay's office computer or acts
  as a stronger central server owned by Nikolay.
- Configure Tailscale ACLs so client devices only reach required services.
- Add HTTPS/reverse proxy if the web UI needs non-Tailscale access.
- Add proper database storage before larger production rollout.
- Add automated backup script and retention policy.
