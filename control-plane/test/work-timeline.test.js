import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  appendTimelineEvent,
  appendTimelineEventForUsers,
  readTimeline,
  summarizeTimeline,
  listTimelineUserIds,
} from "../src/domain/work-timeline.js";

async function tmpDataFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "timeline-"));
  return path.join(dir, "control-plane.json");
}

test("append and read timeline events oldest-first", async () => {
  const dataFilePath = await tmpDataFile();
  await appendTimelineEvent({
    dataFilePath,
    userId: "u-pm-1",
    event: { ts: "2026-06-01T08:00:00Z", kind: "dialog_question", title: "вопрос про отчет" },
  });
  await appendTimelineEvent({
    dataFilePath,
    userId: "u-pm-1",
    event: { ts: "2026-06-02T09:00:00Z", kind: "task_completed", title: "закрыла задачу X", links: { taskIds: ["t1"], projectIds: ["p1"] } },
  });
  const all = await readTimeline({ dataFilePath, userId: "u-pm-1" });
  assert.equal(all.length, 2);
  assert.equal(all[0].kind, "dialog_question");
  assert.equal(all[1].kind, "task_completed");
  assert.deepEqual(all[1].links.taskIds, ["t1"]);
});

test("readTimeline filters by period and kind", async () => {
  const dataFilePath = await tmpDataFile();
  for (let d = 1; d <= 5; d += 1) {
    await appendTimelineEvent({
      dataFilePath,
      userId: "u-x",
      event: { ts: `2026-06-0${d}T10:00:00Z`, kind: d % 2 ? "task_completed" : "dialog_answer", title: `day ${d}` },
    });
  }
  const window = await readTimeline({
    dataFilePath,
    userId: "u-x",
    from: "2026-06-02T00:00:00Z",
    to: "2026-06-04T23:59:59Z",
  });
  assert.equal(window.length, 3);

  const onlyTasks = await readTimeline({ dataFilePath, userId: "u-x", kinds: ["task_completed"] });
  assert.equal(onlyTasks.every((e) => e.kind === "task_completed"), true);
});

test("appendTimelineEventForUsers writes to each user and summarize aggregates", async () => {
  const dataFilePath = await tmpDataFile();
  await appendTimelineEventForUsers({
    dataFilePath,
    userIds: ["u-maksat", "u-pm-1", "u-pm-1"],
    event: {
      kind: "task_assigned",
      title: "Максат поставил Бегайым задачу",
      actorUserId: "u-maksat",
      links: { userIds: ["u-maksat", "u-pm-1"], projectIds: ["p1"], taskIds: ["t9"] },
    },
  });
  const maksat = await readTimeline({ dataFilePath, userId: "u-maksat" });
  const pm1 = await readTimeline({ dataFilePath, userId: "u-pm-1" });
  assert.equal(maksat.length, 1);
  assert.equal(pm1.length, 1);

  const summary = summarizeTimeline(pm1);
  assert.equal(summary.tasksAssigned.length, 1);
  assert.deepEqual(summary.projectIds, ["p1"]);
  assert.ok(summary.collaborators.includes("u-maksat"));

  const users = await listTimelineUserIds({ dataFilePath });
  assert.ok(users.includes("u-maksat"));
  assert.ok(users.includes("u-pm-1"));
});

test("appendTimelineEvent is fail-safe on bad input", async () => {
  const r = await appendTimelineEvent({ dataFilePath: null, userId: "x", event: {} });
  assert.equal(r, null);
  const empty = await readTimeline({ dataFilePath: await tmpDataFile(), userId: "nobody" });
  assert.deepEqual(empty, []);
});

test("unknown kind falls back to note and fields are normalized", async () => {
  const dataFilePath = await tmpDataFile();
  const stored = await appendTimelineEvent({
    dataFilePath,
    userId: "u-1",
    event: { kind: "totally_made_up", title: "x", links: { taskIds: ["a", "a", "b"] } },
  });
  assert.equal(stored.kind, "note");
  assert.deepEqual(stored.links.taskIds, ["a", "b"]);
  assert.ok(stored.id.startsWith("tl-"));
});
