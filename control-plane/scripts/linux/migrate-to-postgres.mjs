#!/usr/bin/env node
/**
 * One-shot migration: load the existing file-based control-plane state and
 * write it into the Postgres `control_plane_state` jsonb row.
 *
 * Idempotent: re-running overwrites the single state row. Safe to run with the
 * service stopped. Does NOT touch derived artifacts (timeline/archive/vault) —
 * those stay on disk next to the data file.
 *
 * Usage:
 *   CONTROL_PLANE_DATABASE_URL=postgres://user:pass@host:5432/db \
 *   node scripts/linux/migrate-to-postgres.mjs [--force]
 *
 * Reads the source file from CONTROL_PLANE_DATA_FILE or <projectRoot>/data/control-plane.json.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../../src/infra/env.js";
import { resolveDefaultDataFile } from "../../src/infra/json-store.js";
import { PgStore } from "../../src/infra/pg-store.js";
import { createInitialState } from "../../src/infra/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
loadEnvFile({ projectRoot });

const force = process.argv.includes("--force");
const connectionString =
  process.env.CONTROL_PLANE_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error("ERROR: set CONTROL_PLANE_DATABASE_URL (or DATABASE_URL) first.");
  process.exit(1);
}

const dataFile = resolveDefaultDataFile(projectRoot, process.env);

async function readSourceState() {
  try {
    const raw = await fs.readFile(dataFile, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn(`Source file ${dataFile} not found; seeding a fresh state.`);
      return createInitialState();
    }
    throw error;
  }
}

const pg = await import("pg");
const Pool = pg.default?.Pool || pg.Pool;
const pool = new Pool({ connectionString, max: 2 });

try {
  const store = new PgStore({ pool, seedFactory: () => createInitialState(), filePath: dataFile });
  await store.ensureSchema();

  const existing = await pool.query("SELECT data FROM control_plane_state WHERE id = $1", [1]);
  if (existing.rows.length > 0 && !force) {
    console.error(
      "ABORT: Postgres already has a control_plane_state row. Re-run with --force to overwrite.",
    );
    process.exit(2);
  }

  const state = await readSourceState();
  const users = Array.isArray(state.users) ? state.users.length : 0;
  const projects = Array.isArray(state.projects) ? state.projects.length : 0;
  await store.save(state);

  console.log(`Migrated state from ${dataFile} into Postgres.`);
  console.log(`  users: ${users}, projects: ${projects}`);
  console.log("Set CONTROL_PLANE_STORE=postgres and restart the service to use it.");
} finally {
  await pool.end();
}
