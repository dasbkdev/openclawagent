# macOS install packaging

Build macOS artifacts on a Mac. The scripts create:

- `dist/macos/Company Control Plane.app`
- `dist/macos/CompanyControlPlane.pkg`
- `dist/macos/CompanyControlPlane.dmg`

## Build

```bash
cd /path/to/control-plane
chmod +x scripts/macos/*.sh
./scripts/macos/build-macos-app.sh
./scripts/macos/build-macos-pkg.sh
./scripts/macos/build-macos-dmg.sh
```

The app bundle copies the service source into
`Company Control Plane.app/Contents/Resources/app`. If `node` is available on
the build Mac, the script also bundles it into
`Contents/Resources/runtime/node`.

## Install behavior

The `.pkg` installs the app into `/Applications`, registers a LaunchDaemon:

```text
/Library/LaunchDaemons/com.company.control-plane.plist
```

The daemon runs the HTTP API at `http://127.0.0.1:3099` and stores mutable
runtime data under:

```text
/Library/Application Support/CompanyControlPlane
```

During post-install the package also creates a Desktop symlink for the currently
logged-in console user:

```text
~/Desktop/Company Control Plane.app
```

After install it opens the local setup wizard:

```text
http://127.0.0.1:3099/setup
```

## Setup

Use the wizard to save:

- Nikolay's Telegram ID.
- Telegram bot token.
- Google OAuth client JSON.
- Claude API key.
- Metricon base URL and token.
- Bitrix incoming webhook URL.
- Token usage report recipient Telegram id.
- Optional token usage ingest token.

Secrets are written to encrypted local storage, not to `.env`.

The app also exposes the company model policy:

```text
http://127.0.0.1:3099/api/v1/setup/model-policy
```

OpenClaw should use:

```text
anthropic/claude-sonnet-4-6
```

Token reports are sent only to:

```text
984834133
```

## Current limitations

- Code signing and notarization are not configured yet.
- The `.pkg` should be tested on a real Mac before distributing it.
- For production, replace the local encryption key file with macOS Keychain or
  another managed secret store.
