# Icons

Icons are generated, not committed. Before the first build, generate them from a single
1024×1024 PNG logo:

```bash
npm run tauri icon path/to/logo.png
```

This creates `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns` (macOS) and
`icon.ico` (Windows) here — the paths referenced in `tauri.conf.json`.
