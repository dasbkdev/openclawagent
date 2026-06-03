import fs from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  constructor(filePath, seedFactory) {
    this.filePath = filePath;
    this.seedFactory = seedFactory;
    this.writeChain = Promise.resolve();
  }

  async load() {
    await this.ensureFile();
    const raw = await fs.readFile(this.filePath, "utf8");
    return JSON.parse(raw);
  }

  async save(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  async update(mutator) {
    const run = async () => {
      const state = await this.load();
      const result = await mutator(state);
      await this.save(state);
      return result;
    };

    this.writeChain = this.writeChain.then(run, run);
    return this.writeChain;
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

export function resolveDefaultDataFile(projectRoot, env = process.env) {
  return env.CONTROL_PLANE_DATA_FILE || path.join(projectRoot, "data", "control-plane.json");
}
