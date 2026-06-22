/**
 * Personal-contour identity: registration codes + device tokens, kept in their
 * OWN table `personal_identity` (separate from work device-agents). A personal
 * token maps to exactly one user — the OpenClaw desktop uses it as the provider
 * apiKey, and the personal endpoint resolves the single owner from it.
 */
import crypto from "node:crypto";

const TOKEN_BYTES = 32;
const CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashPersonalToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function genToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export class PersonalIdentityPgStore {
  constructor({ pool }) {
    this.pool = pool;
  }

  async ensureSchema() {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS personal_identity (
         token_hash text PRIMARY KEY,
         user_id text NOT NULL,
         display_name text,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS personal_codes (
         code text PRIMARY KEY,
         user_id text NOT NULL,
         display_name text,
         created_at timestamptz NOT NULL DEFAULT now(),
         redeemed_at timestamptz
       )`,
    );
  }

  async issueCode({ userId, displayName, code }) {
    const value = String(code || crypto.randomBytes(5).toString("hex")).toUpperCase();
    await this.pool.query(
      `INSERT INTO personal_codes (code, user_id, display_name) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET user_id = EXCLUDED.user_id, display_name = EXCLUDED.display_name`,
      [value, userId, displayName || null],
    );
    return { code: value, userId, displayName: displayName || null };
  }

  async redeemCode(code) {
    const value = String(code || "").toUpperCase().trim();
    const res = await this.pool.query("SELECT * FROM personal_codes WHERE code = $1", [value]);
    const row = res.rows[0];
    if (!row) {
      return null;
    }
    if (Date.now() - new Date(row.created_at).getTime() > CODE_TTL_MS) {
      return null;
    }
    const token = genToken();
    await this.pool.query(
      "INSERT INTO personal_identity (token_hash, user_id, display_name) VALUES ($1, $2, $3)",
      [hashPersonalToken(token), row.user_id, row.display_name],
    );
    await this.pool.query("UPDATE personal_codes SET redeemed_at = now() WHERE code = $1", [value]);
    return { token, userId: row.user_id, displayName: row.display_name || null };
  }

  async resolveToken(token) {
    if (!token) {
      return null;
    }
    const res = await this.pool.query(
      "SELECT user_id, display_name FROM personal_identity WHERE token_hash = $1",
      [hashPersonalToken(token)],
    );
    const row = res.rows[0];
    return row ? { userId: row.user_id, displayName: row.display_name || null } : null;
  }
}

export class PersonalIdentityMemStore {
  constructor() {
    this.codes = new Map();
    this.tokens = new Map();
  }

  async ensureSchema() {}

  async issueCode({ userId, displayName, code }) {
    const value = String(code || crypto.randomBytes(5).toString("hex")).toUpperCase();
    this.codes.set(value, { userId, displayName: displayName || null, createdAt: Date.now() });
    return { code: value, userId, displayName: displayName || null };
  }

  async redeemCode(code) {
    const value = String(code || "").toUpperCase().trim();
    const row = this.codes.get(value);
    if (!row || Date.now() - row.createdAt > CODE_TTL_MS) {
      return null;
    }
    const token = genToken();
    this.tokens.set(hashPersonalToken(token), { userId: row.userId, displayName: row.displayName });
    return { token, userId: row.userId, displayName: row.displayName };
  }

  async resolveToken(token) {
    if (!token) {
      return null;
    }
    return this.tokens.get(hashPersonalToken(token)) || null;
  }
}
