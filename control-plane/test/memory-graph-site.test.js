import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { exportMemoryGraphSite } from "../src/domain/memory-graph-site.js";
import { appendTimelineEvent } from "../src/domain/work-timeline.js";

async function tmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "graph-site-"));
  return { dataFilePath: path.join(dir, "control-plane.json"), outDir: path.join(dir, "web") };
}

test("exportMemoryGraphSite writes graph.json and index.html with nodes/links", async () => {
  const { dataFilePath, outDir } = await tmp();
  const state = {
    users: [
      { id: "u-nikolay", displayName: "Николай", role: "OWNER" },
      { id: "u-maksat", displayName: "Максат", role: "SENIOR_PM", managerId: "u-nikolay" },
      { id: "u-pm-1", displayName: "Бегайым", role: "PM", managerId: "u-maksat" },
    ],
    projects: [{ id: "p1", name: "Проект Альфа", memberUserIds: ["u-pm-1"] }],
  };
  await appendTimelineEvent({
    dataFilePath,
    userId: "u-pm-1",
    event: { kind: "task_completed", title: "Закрыла лендинг", links: { projectIds: ["p1"], userIds: ["u-maksat"] } },
  });

  const result = await exportMemoryGraphSite({ state, dataFilePath, outDir });
  assert.ok(result.nodes >= 4); // 3 people + 1 project
  assert.ok(result.links >= 2);

  const graph = JSON.parse(await fs.readFile(path.join(outDir, "graph.json"), "utf8"));
  assert.equal(graph.stats.people, 3);
  assert.equal(graph.stats.projects, 1);
  const person = graph.nodes.find((n) => n.id === "person:u-pm-1");
  assert.equal(person.detail.totals.tasksCompleted, 1);
  // person↔project link exists
  const ids = graph.links.map((l) => `${l.source}|${l.target}`);
  assert.ok(ids.some((k) => k.includes("project:p1") && k.includes("person:u-pm-1")));

  const html = await fs.readFile(path.join(outDir, "index.html"), "utf8");
  assert.ok(html.includes("Граф памяти"));
  assert.ok(html.includes("graph.json"));
});

test("exportMemoryGraphSite requires outDir", async () => {
  await assert.rejects(() => exportMemoryGraphSite({ state: {}, dataFilePath: "x", outDir: "" }));
});
