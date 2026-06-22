/**
 * Storage for the PERSONAL assistant contour — deliberately isolated from the
 * work control-plane:
 *  - a SEPARATE Postgres table `personal_assistant_state`,
 *  - ONE ROW PER USER (keyed by user_id), so a user's personal data (psychology,
 *    health, habits) is physically partitioned and strictly single-user.
 * Nothing here touches control_plane_state or the work memory.
 *
 * Two backends with the same interface (loadUser / updateUser):
 *  - PersonalPgStore (production, injected pg pool),
 *  - PersonalMemStore (tests / dev, in-memory).
 */

export function emptyPersonalState(userId) {
  return {
    userId,
    profile: {},          // user-chosen assistant name, preferences
    facts: [],            // durable personal facts (mood/health/habits/goals)
    dialogue: [],         // recent personal dialogue turns
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export class PersonalPgStore {
  constructor({ pool }) {
    this.pool = pool;
    this.writeChain = Promise.resolve();
  }

  async ensureSchema() {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS personal_assistant_state (
         user_id text PRIMARY KEY,
         data jsonb NOT NULL,
         updated_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
  }

  async loadUser(userId) {
    const result = await this.pool.query(
      "SELECT data FROM personal_assistant_state WHERE user_id = $1",
      [userId],
    );
    return result.rows.length === 0 ? emptyPersonalState(userId) : result.rows[0].data;
  }

  /** Atomic per-user read-modify-write (advisory lock scoped to the user). */
  async updateUser(userId, mutator) {
    const run = async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        // Lock on a hash of the userId so different users never block each other.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`personal:${userId}`]);
        const res = await client.query(
          "SELECT data FROM personal_assistant_state WHERE user_id = $1 FOR UPDATE",
          [userId],
        );
        const state = res.rows.length === 0 ? emptyPersonalState(userId) : res.rows[0].data;
        const result = await mutator(state);
        state.updatedAt = new Date().toISOString();
        await client.query(
          `INSERT INTO personal_assistant_state (user_id, data, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [userId, state],
        );
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // ignore
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

export class PersonalMemStore {
  constructor() {
    this.users = new Map();
    this.writeChain = Promise.resolve();
  }

  async ensureSchema() {}

  async loadUser(userId) {
    return this.users.get(userId) || emptyPersonalState(userId);
  }

  async updateUser(userId, mutator) {
    const run = async () => {
      const state = this.users.get(userId) || emptyPersonalState(userId);
      const result = await mutator(state);
      state.updatedAt = new Date().toISOString();
      this.users.set(userId, state);
      return result;
    };
    this.writeChain = this.writeChain.then(run, run);
    return this.writeChain;
  }
}
