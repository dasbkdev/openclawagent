// Self-hosted auto-update: checks the brain's /updates/latest.json (over Tailscale) for a
// newer signed build. If found, downloadAndInstall() fetches + verifies the signature and
// installs; then we relaunch. Errors (offline / no manifest yet) are swallowed silently.

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateInfo = { version: string; notes: string; install: () => Promise<void> };

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? "",
      install: async () => {
        await update.downloadAndInstall();
        await relaunch();
      },
    };
  } catch {
    return null; // no manifest reachable / offline — nothing to do
  }
}
