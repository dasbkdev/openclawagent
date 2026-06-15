import { JsonStore, resolveDefaultDataFile } from "./json-store.js";
import { PgStore } from "./pg-store.js";

/**
 * Picks the state store backend from the environment.
 *
 * Postgres is selected only when CONTROL_PLANE_STORE=postgres AND a connection
 * string is present (DATABASE_URL or CONTROL_PLANE_DATABASE_URL). Otherwise the
 * file-based JsonStore is used, so existing deployments keep working untouched
 * and the `pg` driver is never loaded.
 *
 * `filePath` is always set to the on-disk data path, even for Postgres, so
 * derived per-user artifacts (work-timeline JSONL, memory archive, obsidian
 * vault) keep living in the same directory.
 */
export async function createStore({ projectRoot, env = process.env, seedFactory }) {
  const dataFile = resolveDefaultDataFile(projectRoot, env);
  const connectionString = env.CONTROL_PLANE_DATABASE_URL || env.DATABASE_URL;

  if (String(env.CONTROL_PLANE_STORE || "").toLowerCase() === "postgres" && connectionString) {
    // Dynamic import keeps `pg` an optional dependency: only deployments that
    // actually opt into Postgres need the driver installed.
    const pg = await import("pg");
    const Pool = pg.default?.Pool || pg.Pool;
    const pool = new Pool({
      connectionString,
      max: Number(env.CONTROL_PLANE_PG_POOL_MAX || 6),
      idleTimeoutMillis: 30000,
    });
    const store = new PgStore({ pool, seedFactory, filePath: dataFile });
    await store.ensureSchema();
    return store;
  }

  return new JsonStore(dataFile, seedFactory);
}
