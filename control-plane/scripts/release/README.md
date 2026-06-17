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

### Chosen path: cloud CI on `macos-latest`

The build pipeline already exists: workflow `starlab-desktop-build.yml` +
`scripts/package-starlab-mac-dist.sh` + npm script `starlab:mac:package`
(`SKIP_NOTARIZE=1 ALLOW_ADHOC_SIGNING=1 pnpm starlab:mac:package` →
`dist/starlab-openclaw-agent-macos-universal.dmg`). It only needs the source in
a CI-reachable repo. **One-time setup (must run on the Mac, by whoever holds the
working tree — asik/Maksat):**

1. From `~/agent/openclaw`, bump `package.json` version to match Windows (`2026.6.7`).
2. Push that fork (full tree, incl. `apps/macos/Sources/OpenClaw/*` and the
   `Starlab*` files) to a private GitHub repo that has Actions enabled, with
   `.github/workflows/starlab-desktop-build.yml` present.
3. Trigger the **macOS DMG** job (push to `server`/`main`, or `workflow_dispatch`).
4. Download the `starlab-openclaw-agent-macos` artifact.

Then, from this repo: bump `desktop-releases.config.json` macOS → `2026.6.7`
and run `./publish-desktop-release.sh <downloaded>.dmg`.

The DMG is **ad-hoc signed** (no Apple Developer ID), so first launch needs
right-click → Open (Gatekeeper). A real `Developer ID Application` cert removes
that and enables notarization — track separately.

### Parity gap to close in the macOS source (vs Windows 2026.6.7)

- `play_youtube`, `minimize_window`, `minimize_all` device actions.
- Full auto-update install (manifest check exists; verify SHA-256 + install flow).
- Launch-at-Login autostart parity.
