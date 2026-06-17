#!/usr/bin/env node
/**
 * Zero-dependency generator for the desktop-agent update manifest
 * (public/downloads/releases.json).
 *
 * The config file is the single source of truth for version + notes + filename
 * per platform. The SHA-256 is ALWAYS computed from the real artifact on disk —
 * it is never hand-written, which is what let windows/macos drift apart before.
 *
 * If a platform's artifact is not present in the downloads dir, the previous
 * entry from the existing releases.json is carried over unchanged (so updating
 * one platform never wipes another). Pass --require to fail instead.
 *
 * Usage:
 *   node make-releases-manifest.mjs \
 *     [--config <path>] [--downloads <dir>] [--out <path>] [--require] [--quiet]
 *
 * Defaults: config = ./desktop-releases.config.json next to this script;
 * downloads = config.downloadsDir resolved relative to the config; out =
 * <downloads>/releases.json.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const args = { require: false, quiet: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--require") args.require = true;
    else if (a === "--quiet") args.quiet = true;
    else if (a === "--config") args.config = argv[++i];
    else if (a === "--downloads") args.downloads = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function log(quiet, ...parts) {
  if (!quiet) console.log(...parts);
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const args = parseArgs(process.argv);

  const configPath = path.resolve(args.config || path.join(here, "desktop-releases.config.json"));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (!config.platforms || typeof config.platforms !== "object") {
    throw new Error(`Config ${configPath} is missing a "platforms" object`);
  }

  const downloadsDir = path.resolve(
    args.downloads || path.resolve(path.dirname(configPath), config.downloadsDir || "."),
  );
  const outPath = path.resolve(args.out || path.join(downloadsDir, "releases.json"));

  const previous = existsSync(outPath)
    ? JSON.parse(readFileSync(outPath, "utf8"))
    : { platforms: {} };

  const platforms = {};
  for (const [name, entry] of Object.entries(config.platforms)) {
    if (!entry || !entry.file) {
      throw new Error(`Platform "${name}" in config is missing "file"`);
    }
    const filePath = path.join(downloadsDir, entry.file);
    if (existsSync(filePath)) {
      const bytes = statSync(filePath).size;
      platforms[name] = {
        version: String(entry.version || ""),
        url: `/downloads/${entry.file}`,
        sha256: sha256(filePath),
        bytes,
        notes: String(entry.notes || ""),
      };
      log(args.quiet, `  ${name}: ${entry.version} (${bytes} bytes) sha256=${platforms[name].sha256.slice(0, 12)}…`);
    } else if (previous.platforms && previous.platforms[name]) {
      if (args.require) {
        throw new Error(`Missing artifact for "${name}": ${filePath} (and --require was set)`);
      }
      platforms[name] = previous.platforms[name];
      log(args.quiet, `  ${name}: artifact not found — carried over previous entry (${platforms[name].version})`);
    } else if (args.require) {
      throw new Error(`Missing artifact for "${name}": ${filePath}`);
    } else {
      log(args.quiet, `  ${name}: artifact not found and no previous entry — skipped`);
    }
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    platforms,
  };
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  log(args.quiet, `Wrote ${outPath}`);
  return manifest;
}

try {
  main();
} catch (error) {
  console.error(`make-releases-manifest: ${error.message}`);
  process.exit(1);
}
