import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBitrixTask } from "../src/connectors/bitrix-client.js";
import { buildBitrixProjectStatusReport, summarizeTasks } from "../src/domain/bitrix-reports.js";
import { getUserById } from "../src/domain/policy.js";
import { createInitialState } from "../src/infra/seed.js";

const fakeBitrixClient = {
  source: "test",
  configured: true,
  async getProjectTasks({ project }) {
    return {
      source: "test",
      configured: true,
      projectId: project.id,
      tasks: [
        {
          id: "1",
          title: "Open task",
          status: 3,
          statusLabel: "in_progress",
          deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        {
          id: "2",
          title: "Late task",
          status: 2,
          statusLabel: "pending",
          deadline: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        },
        {
          id: "3",
          title: "Done task",
          status: 5,
          statusLabel: "completed",
          deadline: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        },
      ],
    };
  },
};

test("Bitrix report summarizes project tasks and writes audit", async () => {
  const state = createInitialState();
  const owner = getUserById(state, "u-nikolay");
  const report = await buildBitrixProjectStatusReport(state, {
    actor: owner,
    request: { projectId: "project-alpha" },
    bitrixClient: fakeBitrixClient,
  });

  assert.equal(report.summary.total, 3);
  assert.equal(report.summary.open, 2);
  assert.equal(report.summary.completed, 1);
  assert.equal(report.summary.overdue, 1);
  assert.equal(state.auditLog.at(-1).action, "bitrix.project_status.read");
});

test("PM cannot read Bitrix report for another PM project", async () => {
  const state = createInitialState();
  const pm1 = getUserById(state, "u-pm-1");
  await assert.rejects(
    () =>
      buildBitrixProjectStatusReport(state, {
        actor: pm1,
        request: { projectId: "project-beta" },
        bitrixClient: fakeBitrixClient,
      }),
    /Actor cannot access/,
  );
});

test("Bitrix task normalization supports uppercase REST fields", () => {
  const task = normalizeBitrixTask({
    ID: 123,
    TITLE: "Task title",
    STATUS: "3",
    DEADLINE: "2026-06-03T10:00:00Z",
    RESPONSIBLE_ID: "44",
    RESPONSIBLE_NAME: "Maksat",
  });

  assert.equal(task.id, "123");
  assert.equal(task.title, "Task title");
  assert.equal(task.statusLabel, "in_progress");
  assert.equal(task.responsibleName, "Maksat");
});

test("summarizeTasks counts task states", () => {
  const summary = summarizeTasks([
    { statusLabel: "pending", overdue: true },
    { statusLabel: "pending", overdue: false },
    { statusLabel: "completed", overdue: false },
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.open, 2);
  assert.equal(summary.overdue, 1);
  assert.deepEqual(summary.statusCounts, { pending: 2, completed: 1 });
});
