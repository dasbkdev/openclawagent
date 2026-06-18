import fs from "node:fs/promises";
import path from "node:path";

const LOCK_RETRY_START_MS = 25;
const LOCK_RETRY_MAX_MS = 250;
// Some legacy mutators perform network reads while holding the lock
// (reports fetch Platrum/Metricon inside store.update), so writers must
// tolerate multi-second holds. Stale reaping must stay well above the
// longest legitimate hold to avoid stealing a live lock mid-write.
const LOCK_ACQUIRE_TIMEOUT_MS = Number(process.env.CONTROL_PLANE_LOCK_TIMEOUT_MS || 25000);
const LOCK_STALE_MS = Number(process.env.CONTROL_PLANE_LOCK_STALE_MS || 120000);

export class JsonStore {
  constructor(filePath, seedFactory) {
    this.filePath = filePath;
    this.seedFactory = seedFactory;
    this.lockPath = `${filePath}.lock`;
    this.writeChain = Promise.resolve();
  }

  async load() {
    await this.ensureFile();
    const raw = await fs.readFile(this.filePath, "utf8");
    return JSON.parse(raw);
  }

  async readDeviceCommand(commandId) {
    const state = await this.load();
    return (state.deviceCommands || []).find((cmd) => cmd.id === commandId) || null;
  }

  async save(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  async update(mutator) {
    const run = async () => {
      await this.acquireLock();
      try {
        const state = await this.load();
        const result = await mutator(state);
        await this.save(state);
        return result;
      } finally {
        await this.releaseLock();
      }
    };

    this.writeChain = this.writeChain.then(run, run);
    return this.writeChain;
  }

  async acquireLock() {
    await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
    const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
    let backoff = LOCK_RETRY_START_MS;
    for (;;) {
      try {
        const handle = await fs.open(this.lockPath, "wx");
        try {
          await handle.writeFile(
            JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
          );
        } finally {
          await handle.close();
        }
        return;
      } catch (error) {
        if (error.code !== "EEXIST") {
          throw error;
        }
        if (await this.reapStaleLock()) {
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `JsonStore: failed to acquire lock ${this.lockPath} within ${LOCK_ACQUIRE_TIMEOUT_MS}ms`,
          );
        }
        await sleep(backoff);
        backoff = Math.min(Math.round(backoff * 1.7), LOCK_RETRY_MAX_MS);
      }
    }
  }

  async reapStaleLock() {
    try {
      const stat = await fs.stat(this.lockPath);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.rm(this.lockPath, { force: true });
        return true;
      }
    } catch {
      // Lock vanished between attempts; let the caller retry the create.
    }
    return false;
  }

  async releaseLock() {
    try {
      await fs.rm(this.lockPath, { force: true });
    } catch {
      // Best-effort release; a stale lock will be reaped by the next writer.
    }
  }

  async ensureFile() {
    try {
      await fs.access(this.filePath);
    } catch {
      const initialState = this.seedFactory();
      await this.save(initialState);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveDefaultDataFile(projectRoot, env = process.env) {
  return env.CONTROL_PLANE_DATA_FILE || path.join(projectRoot, "data", "control-plane.json");
}
