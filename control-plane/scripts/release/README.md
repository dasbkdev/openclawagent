# Desktop-agent release tooling

Stops the `releases.json` drift that left macOS pinned at `2026.6.5` while
Windows shipped `2026.6.7`. One config file is the source of truth; the SHA-256
is always computed from the real artifact, never hand-written.

## Files

- `desktop-releases.config.json` — version + notes + filename per platform. **Edit this** to cut a release.
- `make-releases-manifest.mjs` — zero-dep generator → `public/downloads/releases.json`.
- `publish-desktop-release.sh` — uploads an artifact to prod and refreshes the manifest with a verified SHA-256.

## Cut a release (any platform)

1. Bump `version` (and `notes`) for the platform in `desktop-releases.config.json`.
2. Put the built artifact in `control-plane/public/downloads/` (local check) **or** publish straight to prod:

```bash
# local manifest only (artifact must already be in public/downloads):
node make-releases-manifest.mjs

# prod publish + manifest refresh + HTTPS verify (needs ~/.ssh/starlab_server):
./publish-desktop-release.sh /path/to/starlab-openclaw-agent-macos-universal.dmg
# dry run first:
DRY_RUN=1 ./publish-desktop-release.sh /path/to/<artifact>
```

If a platform's artifact is absent, its previous manifest entry is carried over
unchanged — updating macOS never disturbs the Windows entry.

## Building the macOS DMG (the actual blocker)

Windows builds locally (`apps/windows`, Electron, `npm run build:win`). **macOS
is a native Swift app** (`apps/macos`, Xcode/Swift → `OpenClaw.app` → `hdiutil`)
and **cannot be built on Windows.** The full, current Starlab-customised macOS
source lives only in the Mac working tree (`~/agent/openclaw`) — it is *not* in
this repo (the vendored `openclaw-starlab-2026.6.5/apps/macos` is missing the
main `Sources/OpenClaw` app target) and `openclaw/` is gitignored.

### Chosen path: cloud CI on `macos-latest` — NO physical Mac, NO separate fork

GitHub's `macos-latest` runner *is* a cloud Mac. The workflow
`.github/workflows/starlab-mac-dmg.yml` (in THIS repo) builds the DMG with zero
local Mac. Recipe, validated on Windows against tag `v2026.6.5` (0 failed hunks):

```
git clone --depth 1 --branch v2026.6.5 https://github.com/openclaw/openclaw.git
cd openclaw
patch -p1 --fuzz=3 < ../OPENCLAW_STARLAB_DEVICE_CONTROL.patch   # Starlab overlay
corepack enable && pnpm install
SKIP_NOTARIZE=1 ALLOW_ADHOC_SIGNING=1 pnpm starlab:mac:package  # -> dist/...universal.dmg
```

The committed `OPENCLAW_STARLAB_DEVICE_CONTROL.patch` carries the whole Starlab
overlay (mac Swift client/executor/window + MenuBar/menu hooks, apps/windows,
scripts, npm script). No need to push a separate fork — the workflow clones
upstream and applies the patch itself.

**To produce a DMG (all in the GitHub web UI):**

1. Actions → **Starlab macOS DMG (cloud build)** → *Run workflow* (defaults:
   `upstream_tag=v2026.6.5`, `version=2026.6.5`).
2. When green, download the `starlab-openclaw-agent-macos-<version>` artifact.
3. From this repo: set `desktop-releases.config.json` macOS `version` + drop the
   `.dmg` in `public/downloads/`, then `./publish-desktop-release.sh <downloaded>.dmg`.

Caveats (honest):
- **macOS minutes cost.** On a *private* repo GitHub bills macOS at 10×; the free
  2000 min/mo ≈ 200 macOS-min, and a full Swift+Sparkle+Peekaboo build is tens of
  minutes — a handful of runs/month before it's billed. Public repos: free.
- **First runs may need iteration.** The Swift build can't be compiled on Windows;
  if CI errors, fix from the logs and re-run.
- This produces a **2026.6.5-feature** Starlab agent. To reach Windows 2026.6.7
  parity, add the deltas below to the overlay (then refresh the patch).

The DMG is **ad-hoc signed** (no Apple Developer ID), so first launch needs
right-click → Open (Gatekeeper). A real `Developer ID Application` cert removes
that and enables notarization — track separately.

### Parity gap to close in the macOS source (vs Windows 2026.6.7)

- `play_youtube`, `minimize_window`, `minimize_all` device actions.
- Full auto-update install (manifest check exists; verify SHA-256 + install flow).
- Launch-at-Login autostart parity.
