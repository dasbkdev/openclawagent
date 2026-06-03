# OpenClaw Agent Control Plane

This repository contains the company control-plane work for the centralized
agent product.

Start here for the rented/central server setup:

```text
SERVER_PREP_RUNBOOK.md
```

Linux production install docs:

```text
control-plane\docs\LINUX_INSTALL.md
control-plane\scripts\linux\
```

Main server code:

```text
control-plane\
```

Important safety rules:

- Do not commit Metricon/Kickidler source checkouts.
- Do not commit OpenClaw source unless intentionally changing repository
  structure.
- Do not commit `.env`, runtime data, `dist`, API keys, OAuth JSON, Telegram
  tokens, or encrypted runtime secret files.
- Enter production secrets through the setup wizard after installation.

Current architecture:

- one centralized server/agent;
- Linux is the preferred central server target;
- Nikolay is OWNER;
- Maksat is SENIOR_PM;
- three PM users are clients under Maksat;
- Tailscale is the primary private network.
