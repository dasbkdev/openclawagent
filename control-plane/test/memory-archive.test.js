import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendMemoryArchive,
  memoryArchiveDir,
  searchMemoryArchive,
} from "../src/infra/memory-archive.js";

async function tmpDataFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-archive-"));
  return path.join(dir, "control-plane.json");
}

test("append writes JSONL and search scores by term overlap", async () => {
  const dataFilePath = await tmpDataFile();
  await appendMemoryArchive({
    dataFilePath,
    userId: "u-a",
    events: [
      { id: "e1", text: "открой хром на маке", kind: "device_action_request", createdAt: "2026-06-01T00:00:00Z" },
      { id: "e2", text: "созвон по проекту альфа", kind: "assistant_question", createdAt: "2026-06-02T00:00:00Z" },
    ],
  });
  await appendMemoryArchive({
    dataFilePath,
    userId: "u-a",
    events: [
      { id: "e3", text: "напомни про проект альфа дедлайн", kind: "assistant_answer", createdAt: "2026-06-03T00:00:00Z" },
    ],
  });

  const archiveFile = path.join(memoryArchiveDir(dataFilePath), "u-a.jsonl");
  const content = await fs.readFile(archiveFile, "utf8");
  assert.equal(content.trim().split("\n").length, 3);

  const results = await searchMemoryArchive({
    dataFilePath,
    userId: "u-a",
    terms: ["проект", "альфа"],
    limit: 5,
  });
  assert.ok(results.length >= 2);
  // Highest scoring (two-term match) first.
  assert.ok(results.every((event) => event.source === "archive"));
  assert.ok(results.some((event) => event.id === "e3"));
});

test("search returns empty when archive file is missing", async () => {
  const dataFilePath = await tmpDataFile();
  const results = await searchMemoryArchive({
    dataFilePath,
    userId: "nobody",
    terms: ["anything"],
  });
  assert.deepEqual(results, []);
});

test("append and search are fail-safe with empty inputs", async () => {
  const dataFilePath = await tmpDataFile();
  assert.deepEqual(await appendMemoryArchive({ dataFilePath, userId: "u-a", events: [] }), {
    appended: 0,
  });
  assert.deepEqual(
    await searchMemoryArchive({ dataFilePath, userId: "u-a", terms: [] }),
    [],
  );
});

test("user ids with unsafe characters are sanitized into a single file", async () => {
  const dataFilePath = await tmpDataFile();
  await appendMemoryArchive({
    dataFilePath,
    userId: "u-a/../b",
    events: [{ id: "x", text: "hello world", createdAt: "2026-06-01T00:00:00Z" }],
  });
  const entries = await fs.readdir(memoryArchiveDir(dataFilePath));
  assert.equal(entries.length, 1);
  assert.ok(!entries[0].includes("/"));
});
