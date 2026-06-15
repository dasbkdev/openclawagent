import test from "node:test";
import assert from "node:assert/strict";
import { syncTasksToTimeline } from "../src/domain/task-sync.js";

test("first sight of tasks emits task_created", () => {
  const state = {};
  const events = syncTasksToTimeline(state, {
    userId: "u-pm-1",
    tasks: [
      { id: "t1", title: "Сверстать лендинг", statusLabel: "in_progress", projectId: "p1" },
      { id: "t2", title: "Отчет", statusLabel: "new" },
    ],
    now: new Date("2026-06-15T10:00:00Z"),
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].event.kind, "task_created");
  assert.equal(events[0].userId, "u-pm-1");
  assert.deepEqual(events[0].event.links.taskIds, ["t1"]);
  assert.equal(state.taskSyncState["u-pm-1"].t1.status, "in_progress");
});

test("status change emits task_status_change, completion emits task_completed", () => {
  const state = {};
  syncTasksToTimeline(state, {
    userId: "u-pm-1",
    tasks: [{ id: "t1", title: "X", statusLabel: "in_progress" }],
    now: new Date("2026-06-15T10:00:00Z"),
  });
  const changed = syncTasksToTimeline(state, {
    userId: "u-pm-1",
    tasks: [{ id: "t1", title: "X", statusLabel: "review" }],
    now: new Date("2026-06-15T11:00:00Z"),
  });
  assert.equal(changed.length, 1);
  assert.equal(changed[0].event.kind, "task_status_change");

  const completed = syncTasksToTimeline(state, {
    userId: "u-pm-1",
    tasks: [{ id: "t1", title: "X", statusLabel: "completed" }],
    now: new Date("2026-06-15T12:00:00Z"),
  });
  assert.equal(completed[0].event.kind, "task_completed");
  assert.match(completed[0].event.title, /Завершила/u);
});

test("unchanged tasks emit nothing", () => {
  const state = {};
  syncTasksToTimeline(state, { userId: "u", tasks: [{ id: "t1", statusLabel: "new" }] });
  const again = syncTasksToTimeline(state, { userId: "u", tasks: [{ id: "t1", statusLabel: "new" }] });
  assert.equal(again.length, 0);
});

test("bad input is tolerated", () => {
  assert.deepEqual(syncTasksToTimeline({}, { userId: null, tasks: [] }), []);
  assert.deepEqual(syncTasksToTimeline({}, { userId: "u", tasks: null }), []);
});
