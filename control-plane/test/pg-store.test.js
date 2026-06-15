import assert from "node:assert/strict";
import test from "node:test";
import { PgStore } from "../src/infra/pg-store.js";

// In-memory fake of the `pg` Pool/Client surface PgStore relies on:
// pool.query(), pool.connect() -> client.query()/release(). A single jsonb row
// keyed by id is held in a Map; transactions are simulated well enough to
// exercise the read-modify-write path and the writeChain serialization.
function createFakePool() {
  const rows = new Map();
  const log = [];

  function runQuery(sql, params = []) {
    const text = sql.replace(/\s+/gu, " ").trim();
    log.push(text.slice(0, 40));
    if (text.startsWith("CREATE TABLE")) {
      return { rows: [] };
    }
    if (text.startsWith("BEGIN") || text.startsWith("COMMIT") || text.startsWith("ROLLBACK")) {
      return { rows: [] };
    }
    if (text.startsWith("SELECT pg_advisory_xact_lock")) {
      return { rows: [{ pg_advisory_xact_lock: "" }] };
    }
    if (text.startsWith("SELECT data FROM control_plane_state")) {
      const id = params[0];
      return rows.has(id) ? { rows: [{ data: rows.get(id) }] } : { rows: [] };
    }
    if (text.startsWith("INSERT INTO control_plane_state")) {
      const [id, data] = params;
      // ON CONFLICT DO NOTHING vs DO UPDATE: the load() seed uses DO NOTHING.
      if (text.includes("DO NOTHING") && rows.has(id)) {
        return { rows: [] };
      }
      rows.set(id, data);
      return { rows: [] };
    }
    throw new Error(`unexpected SQL: ${text}`);
  }

  return {
    rows,
    log,
    async query(sql, params) {
      return runQuery(sql, params);
    },
    async connect() {
      return {
        async query(sql, params) {
          return runQuery(sql, params);
        },
        release() {},
      };
    },
  };
}

test("load seeds the row on first access and returns it afterwards", async () => {
  const pool = createFakePool();
  const store = new PgStore({ pool, seedFactory: () => ({ users: [], n: 0 }) });
  await store.ensureSchema();

  const first = await store.load();
  assert.deepEqual(first, { users: [], n: 0 });
  // Row is now persisted; a second load reads it back, not a fresh seed.
  pool.rows.get(1).n = 5;
  const second = await store.load();
  assert.equal(second.n, 5);
});

test("update applies the mutator atomically and persists the result", async () => {
  const pool = createFakePool();
  const store = new PgStore({ pool, seedFactory: () => ({ count: 0 }) });
  await store.ensureSchema();
  await store.load();

  const result = await store.update((state) => {
    state.count += 1;
    return state.count;
  });

  assert.equal(result, 1);
  assert.equal(pool.rows.get(1).count, 1);
  // Advisory lock was taken inside the transaction.
  assert.ok(pool.log.some((entry) => entry.startsWith("SELECT pg_advisory_xact_lock")));
});

test("concurrent updates serialize through writeChain without lost writes", async () => {
  const pool = createFakePool();
  const store = new PgStore({ pool, seedFactory: () => ({ count: 0 }) });
  await store.ensureSchema();
  await store.load();

  await Promise.all(
    Array.from({ length: 25 }, () =>
      store.update((state) => {
        state.count += 1;
      }),
    ),
  );

  assert.equal(pool.rows.get(1).count, 25);
});

test("update seeds when the row is missing", async () => {
  const pool = createFakePool();
  const store = new PgStore({ pool, seedFactory: () => ({ count: 10 }) });
  await store.ensureSchema();

  await store.update((state) => {
    state.count += 1;
  });

  assert.equal(pool.rows.get(1).count, 11);
});

test("filePath is preserved for derived on-disk artifacts", () => {
  const store = new PgStore({ pool: createFakePool(), seedFactory: () => ({}), filePath: "/data/cp.json" });
  assert.equal(store.filePath, "/data/cp.json");
});
