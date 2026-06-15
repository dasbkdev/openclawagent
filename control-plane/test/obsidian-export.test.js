import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { appendTimelineEvent } from "../src/domain/work-timeline.js";
import { exportObsidianVault, safeNoteName } from "../src/domain/obsidian-export.js";

async function tmpDataFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "obsidian-"));
  return path.join(dir, "control-plane.json");
}

function sampleState() {
  return {
    users: [
      { id: "u-nikolay", displayName: "Nikolay", role: "owner", managerId: null },
      { id: "u-maksat", displayName: "Maksat", role: "senior_pm", managerId: "u-nikolay" },
      { id: "u-pm-1", displayName: "Project Manager 1", role: "pm", managerId: "u-maksat" },
    ],
    projects: [
      {
        id: "project-alpha",
        name: "Project Alpha",
        ownerUserId: "u-pm-1",
        managerUserId: "u-maksat",
        memberUserIds: ["u-pm-1"],
      },
      {
        id: "project-beta",
        name: "Project Beta",
        ownerUserId: "u-maksat",
        managerUserId: "u-nikolay",
        memberUserIds: ["u-maksat"],
      },
    ],
  };
}

async function seedTimelines(dataFilePath) {
  await appendTimelineEvent({
    dataFilePath,
    userId: "u-pm-1",
    event: {
      ts: "2026-06-01T08:30:00Z",
      kind: "dialog_question",
      title: "Когда дедлайн по альфе?",
      links: { projectIds: ["project-alpha"], userIds: ["u-maksat"] },
    },
  });
  await appendTimelineEvent({
    dataFilePath,
    userId: "u-pm-1",
    event: {
      ts: "2026-06-02T09:15:00Z",
      kind: "task_completed",
      title: "Закрыл задачу по альфе",
      links: { projectIds: ["project-alpha"], taskIds: ["t1"] },
    },
  });
  await appendTimelineEvent({
    dataFilePath,
    userId: "u-maksat",
    event: {
      ts: "2026-06-02T10:00:00Z",
      kind: "task_assigned",
      title: "Назначил задачу на PM1",
      links: { projectIds: ["project-beta"], userIds: ["u-pm-1"] },
    },
  });
}

test("exportObsidianVault creates People/Projects/Daily/Home files", async () => {
  const dataFilePath = await tmpDataFile();
  await seedTimelines(dataFilePath);
  const vaultDir = path.join(path.dirname(dataFilePath), "vault");

  const result = await exportObsidianVault({ state: sampleState(), dataFilePath, vaultDir });
  assert.ok(result.filesWritten > 0);
  assert.equal(result.vaultDir, vaultDir);

  const home = await fs.readFile(path.join(vaultDir, "Home.md"), "utf8");
  assert.match(home, /tags: \[index\]/);
  assert.match(home, /Людей: 3/);
  assert.match(home, /Проектов: 2/);

  const people = await fs.readdir(path.join(vaultDir, "People"));
  assert.ok(people.includes("Nikolay.md"));
  assert.ok(people.includes("Maksat.md"));
  assert.ok(people.includes("Project Manager 1.md"));

  const projects = await fs.readdir(path.join(vaultDir, "Projects"));
  assert.ok(projects.includes("Project Alpha.md"));
  assert.ok(projects.includes("Project Beta.md"));

  const daily = await fs.readdir(path.join(vaultDir, "Daily"));
  assert.ok(daily.includes("2026-06-01.md"));
  assert.ok(daily.includes("2026-06-02.md"));
});

test("person file has project wiki-link and timeline summary", async () => {
  const dataFilePath = await tmpDataFile();
  await seedTimelines(dataFilePath);
  const vaultDir = path.join(path.dirname(dataFilePath), "vault");
  await exportObsidianVault({ state: sampleState(), dataFilePath, vaultDir });

  const pm1 = await fs.readFile(path.join(vaultDir, "People", "Project Manager 1.md"), "utf8");
  assert.match(pm1, /tags: \[person\]/);
  assert.match(pm1, /## Сводка хронологии/);
  assert.match(pm1, /Всего событий: 2/);
  assert.match(pm1, /\[\[Project Alpha\]\]/);
  // Manager link
  assert.match(pm1, /\[\[Maksat\]\]/);
  // Daily back-links
  assert.match(pm1, /\[\[2026-06-01\]\]/);
});

test("wiki-links resolve to real note files (graph consistency)", async () => {
  const dataFilePath = await tmpDataFile();
  await seedTimelines(dataFilePath);
  const vaultDir = path.join(path.dirname(dataFilePath), "vault");
  await exportObsidianVault({ state: sampleState(), dataFilePath, vaultDir });

  // Collect every note stem present in the vault.
  const stems = new Set();
  for (const sub of ["People", "Projects", "Daily"]) {
    const files = await fs.readdir(path.join(vaultDir, sub));
    for (const f of files) {
      if (f.endsWith(".md")) {
        stems.add(f.slice(0, -3));
      }
    }
  }
  stems.add("Home");

  // For the event→project link, the [[name]] must equal the project file name.
  const projectStem = safeNoteName("Project Alpha");
  assert.ok(stems.has(projectStem), "project note file must exist");

  const pm1 = await fs.readFile(path.join(vaultDir, "People", "Project Manager 1.md"), "utf8");
  const linkRefs = [...pm1.matchAll(/\[\[([^\]]+)\]\]/gu)].map((m) => m[1]);
  for (const ref of linkRefs) {
    assert.ok(stems.has(ref), `wiki-link [[${ref}]] must point to an existing note file`);
  }
});

test("export is idempotent (repeat call does not throw, stable file set)", async () => {
  const dataFilePath = await tmpDataFile();
  await seedTimelines(dataFilePath);
  const vaultDir = path.join(path.dirname(dataFilePath), "vault");

  const first = await exportObsidianVault({ state: sampleState(), dataFilePath, vaultDir });
  const second = await exportObsidianVault({ state: sampleState(), dataFilePath, vaultDir });
  assert.equal(first.filesWritten, second.filesWritten);

  // No stale files left over from a previous run.
  const people = await fs.readdir(path.join(vaultDir, "People"));
  assert.equal(people.length, 3);
});

test("safeNoteName strips reserved characters consistently", () => {
  assert.equal(safeNoteName("a/b:c*?\"<>|"), "a b c");
  assert.equal(safeNoteName("  spaced   name  "), "spaced name");
  assert.equal(safeNoteName(""), "Untitled");
  assert.equal(safeNoteName("Project [Alpha]"), "Project Alpha");
});

test("vaultDir validation: rejects empty and relative paths", async () => {
  const dataFilePath = await tmpDataFile();
  await assert.rejects(
    () => exportObsidianVault({ state: sampleState(), dataFilePath, vaultDir: "" }),
    /non-empty/,
  );
  await assert.rejects(
    () => exportObsidianVault({ state: sampleState(), dataFilePath, vaultDir: "relative/vault" }),
    /absolute/,
  );
});

test("missing timeline does not abort export (fail-safe per user)", async () => {
  const dataFilePath = await tmpDataFile();
  // No timeline events at all.
  const vaultDir = path.join(path.dirname(dataFilePath), "vault");
  const result = await exportObsidianVault({ state: sampleState(), dataFilePath, vaultDir });
  assert.ok(result.filesWritten >= 4); // 3 people + 2 projects + Home (no daily)
  const home = await fs.readFile(path.join(vaultDir, "Home.md"), "utf8");
  assert.match(home, /Событий всего: 0/);
});
