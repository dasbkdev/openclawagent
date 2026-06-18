/**
 * PostgreSQL-backed state store with the SAME interface as JsonStore
 * (load / save / update / filePath), so the whole domain works unchanged.
 *
 * The full control-plane state lives in one jsonb row. Concurrency is handled
 * by a PostgreSQL transaction + advisory lock (true cross-process mutual
 * exclusion — no file lock, no lost writes, no lock-timeout starvation).
 *
 * `filePath` still points at the on-disk data path so derived per-user files
 * (work-timeline JSONL, memory-archive, obsidian vault) keep living next to it.
 *
 * The `pg` Pool is injected so this module never imports `pg` directly —
 * unit tests pass a fake pool, and environments without Postgres never load
 * the driver.
 */
export class PgStore {
  constructor({ pool, seedFactory, stateId = 1, filePath = null }) {
    this.pool = pool;
    this.seedFactory = seedFactory;
    this.stateId = stateId;
    this.filePath = filePath;
    this.writeChain = Promise.resolve();
  }

  async ensureSchema() {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS control_plane_state (
         id integer PRIMARY KEY,
         data jsonb NOT NULL,
         updated_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
  }

  async load() {
    const result = await this.pool.query(
      "SELECT data FROM control_plane_state WHERE id = $1",
      [this.stateId],
    );
    if (result.rows.length === 0) {
      const seed = this.seedFactory();
      await this.pool.query(
        "INSERT INTO control_plane_state (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
        [this.stateId, seed],
      );
      return seed;
    }
    return result.rows[0].data;
  }

  /**
   * Narrow read of a single device command by id — avoids loading the whole
   * state jsonb on every poll of the agent-loop command runner.
   */
  async readDeviceCommand(commandId) {
    const result = await this.pool.query(
      `SELECT cmd
         FROM control_plane_state,
              jsonb_array_elements(COALESCE(data->'deviceCommands', '[]'::jsonb)) AS cmd
        WHERE id = $1 AND cmd->>'id' = $2
        LIMIT 1`,
      [this.stateId, String(commandId)],
    );
    return result.rows.length > 0 ? result.rows[0].cmd : null;
  }

  async save(state) {
    await this.pool.query(
      `INSERT INTO control_plane_state (id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [this.stateId, state],
    );
  }

  /**
   * Atomic read-modify-write. Serializes within the process via writeChain
   * (preserving JsonStore semantics) and across processes via a transaction
   * advisory lock + row lock.
   */
  async update(mutator) {
    const run = async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [this.stateId]);
        const result = await client.query(
          "SELECT data FROM control_plane_state WHERE id = $1 FOR UPDATE",
          [this.stateId],
        );
        const state = result.rows.length === 0 ? this.seedFactory() : result.rows[0].data;
        const mutatorResult = await mutator(state);
        await client.query(
          `INSERT INTO control_plane_state (id, data, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [this.stateId, state],
        );
        await client.query("COMMIT");
        return mutatorResult;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // ignore rollback failure
        }
        throw error;
      } finally {
        client.release();
      }
    };

    this.writeChain = this.writeChain.then(run, run);
    return this.writeChain;
  }
}
