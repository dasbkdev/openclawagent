// Persistent cache of memory-item embeddings, kept OUT of the main state blob
// (1024-dim vectors would bloat the single jsonb row and worsen write
// contention). Postgres-backed in production (its own small pool, plain jsonb —
// no pgvector extension needed at this scale; cosine is computed in Node),
// file-backed in dev/JSON mode.
import fs from "node:fs/promises";
import path from "node:path";

export async function createEmbeddingStore({ env = process.env, projectRoot = process.cwd() } = {}) {
  const connectionString = env.CONTROL_PLANE_DATABASE_URL || env.DATABASE_URL;
  if (String(env.CONTROL_PLANE_STORE || "").toLowerCase() === "postgres" && connectionString) {
    const pg = await import("pg");
    const Pool = pg.default?.Pool || pg.Pool;
    const pool = new Pool({ connectionString, max: Number(env.CONTROL_PLANE_PG_POOL_MAX_EMB || 3), idleTimeoutMillis: 30000 });
    const store = new PgEmbeddingStore({ pool });
    await store.ensureSchema();
    return store;
  }
  const dir = env.CONTROL_PLANE_CONFIG_DIR || path.join(projectRoot, "data");
  return new FileEmbeddingStore({ filePath: path.join(dir, "memory-embeddings.json") });
}

export class PgEmbeddingStore {
  constructor({ pool }) {
    this.pool = pool;
    this.backend = "postgres";
  }

  async ensureSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        id text PRIMARY KEY,
        user_id text,
        content text,
        embedding jsonb NOT NULL,
        model text,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS memory_embeddings_user_idx ON memory_embeddings(user_id);`);
  }

  async getMany(ids) {
    const out = new Map();
    const list = [...new Set((ids || []).filter(Boolean))];
    if (list.length === 0) {
      return out;
    }
    const res = await this.pool.query(`SELECT id, embedding FROM memory_embeddings WHERE id = ANY($1)`, [list]);
    for (const row of res.rows) {
      out.set(row.id, Array.isArray(row.embedding) ? row.embedding : row.embedding);
    }
    return out;
  }

  async upsertMany(rows) {
    for (const row of rows || []) {
      if (!row?.id || !Array.isArray(row.embedding)) {
        continue;
      }
      await this.pool.query(
        `INSERT INTO memory_embeddings (id, user_id, content, embedding, model, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, now())
         ON CONFLICT (id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding,
           model = EXCLUDED.model,
           updated_at = now()`,
        [row.id, row.userId ?? null, row.content ?? null, JSON.stringify(row.embedding), row.model ?? null],
      );
    }
  }

  async close() {
    await this.pool.end();
  }
}

export class FileEmbeddingStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.backend = "file";
    this.cache = null;
  }

  async load() {
    if (this.cache) {
      return this.cache;
    }
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.cache = JSON.parse(raw) || {};
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  async getMany(ids) {
    const data = await this.load();
    const out = new Map();
    for (const id of new Set((ids || []).filter(Boolean))) {
      if (data[id]?.embedding) {
        out.set(id, data[id].embedding);
      }
    }
    return out;
  }

  async upsertMany(rows) {
    const data = await this.load();
    for (const row of rows || []) {
      if (!row?.id || !Array.isArray(row.embedding)) {
        continue;
      }
      data[row.id] = { embedding: row.embedding, userId: row.userId ?? null, content: row.content ?? null, model: row.model ?? null, updatedAt: new Date().toISOString() };
    }
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data), "utf8");
  }

  async close() {}
}
