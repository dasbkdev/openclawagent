import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const ALGORITHM = "aes-256-gcm";

export class SecretStore {
  constructor({ keyPath, filePath }) {
    this.keyPath = keyPath;
    this.filePath = filePath;
    this.writeChain = Promise.resolve();
  }

  async readSecret(name) {
    const raw = await this.loadRaw();
    const item = raw.items?.[name];
    if (!item) {
      return null;
    }
    return decryptSecret(await this.loadKey(), item);
  }

  async writeSecret(name, value) {
    return await this.update(async (raw) => {
      raw.items[name] = encryptSecret(await this.loadKey(), String(value));
      raw.items[name].updatedAt = new Date().toISOString();
    });
  }

  async deleteSecret(name) {
    return await this.update(async (raw) => {
      delete raw.items[name];
    });
  }

  async describeSecrets(names) {
    const raw = await this.loadRaw();
    const key = await this.loadKey();
    const result = {};
    for (const name of names) {
      const item = raw.items?.[name];
      if (!item) {
        result[name] = { configured: false, masked: null, updatedAt: null };
        continue;
      }
      const value = decryptSecret(key, item);
      result[name] = {
        configured: true,
        masked: maskSecret(value),
        updatedAt: item.updatedAt || null,
      };
    }
    return result;
  }

  async update(mutator) {
    const run = async () => {
      const raw = await this.loadRaw();
      await mutator(raw);
      await this.saveRaw(raw);
    };
    this.writeChain = this.writeChain.then(run, run);
    return this.writeChain;
  }

  async loadRaw() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        version: parsed.version || 1,
        items: parsed.items && typeof parsed.items === "object" ? parsed.items : {},
      };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      return { version: 1, items: {} };
    }
  }

  async saveRaw(raw) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tempPath, this.filePath);
  }

  async loadKey() {
    try {
      const key = Buffer.from((await fs.readFile(this.keyPath, "utf8")).trim(), "base64");
      if (key.length !== KEY_BYTES) {
        throw new Error(`Invalid secret key length at ${this.keyPath}`);
      }
      return key;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      const key = crypto.randomBytes(KEY_BYTES);
      await fs.mkdir(path.dirname(this.keyPath), { recursive: true });
      await fs.writeFile(this.keyPath, `${key.toString("base64")}\n`, { mode: 0o600 });
      return key;
    }
  }
}

export function encryptSecret(key, value) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: ALGORITHM,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptSecret(key, encrypted) {
  if (encrypted.alg !== ALGORITHM) {
    throw new Error(`Unsupported secret algorithm: ${encrypted.alg}`);
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskSecret(value) {
  const normalized = String(value || "");
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 8) {
    return "*".repeat(normalized.length);
  }
  return `${normalized.slice(0, 4)}${"*".repeat(Math.min(normalized.length - 8, 12))}${normalized.slice(-4)}`;
}
