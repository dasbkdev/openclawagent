import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/infra/json-store.js";

async function tmpFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "json-store-lock-"));
  return path.join(dir, "state.json");
}

test("two JsonStore instances on one file increment without losses", async () => {
  const filePath = await tmpFile();
  const seed = () => ({ counter: 0 });
  const storeA = new JsonStore(filePath, seed);
  const storeB = new JsonStore(filePath, seed);

  const N = 25;
  const tasks = [];
  for (let i = 0; i < N; i += 1) {
    tasks.push(storeA.update((state) => {
      state.counter += 1;
    }));
    tasks.push(storeB.update((state) => {
      state.counter += 1;
    }));
  }
  await Promise.all(tasks);

  const final = await storeA.load();
  assert.equal(final.counter, N * 2);
});

test("a stale lock file is reaped and the update proceeds", async () => {
  const filePath = await tmpFile();
  const store = new JsonStore(filePath, () => ({ counter: 0 }));
  // Materialize the file first.
  await store.update((state) => {
    state.counter = 1;
  });

  // Write a stale lock (mtime far in the past).
  const lockPath = `${filePath}.lock`;
  await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, createdAt: "2000-01-01T00:00:00Z" }));
  const oldTime = new Date(Date.now() - 60_000);
  await fs.utimes(lockPath, oldTime, oldTime);

  await store.update((state) => {
    state.counter += 1;
  });

  const final = await store.load();
  assert.equal(final.counter, 2);
  // Lock released after the update.
  await assert.rejects(fs.access(lockPath));
});
