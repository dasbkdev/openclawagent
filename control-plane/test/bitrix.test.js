import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReadOnlyBitrixMethod,
  HttpBitrixClient,
  normalizeBitrixTask,
  READ_ONLY_BITRIX_METHODS,
} from "../src/connectors/bitrix-client.js";
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
    GROUP_ID: "93",
    STAGE_ID: "789",
    RESPONSIBLE_ID: "44",
    RESPONSIBLE_NAME: "Maksat",
    CREATED_BY: "1",
  });

  assert.equal(task.id, "123");
  assert.equal(task.title, "Task title");
  assert.equal(task.groupId, "93");
  assert.equal(task.stageId, "789");
  assert.equal(task.statusLabel, "in_progress");
  assert.equal(task.responsibleName, "Maksat");
  assert.equal(task.createdBy, "1");
});

test("Bitrix client can read tasks assigned to a mapped user", async (t) => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = null;
  let capturedBody = null;
  globalThis.fetch = async (url, options) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        result: {
          tasks: [
            {
              ID: "1199",
              TITLE: "Assigned task",
              GROUP_ID: "93",
              STATUS: "5",
              RESPONSIBLE_ID: "17",
            },
          ],
        },
      }),
      { status: 200 },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new HttpBitrixClient({ webhookUrl: "https://example.bitrix24.ru/rest/1/token" });
  const result = await client.getUserTasks({
    user: { id: "u-pm-1", displayName: "Begayym", bitrixUserId: 17 },
    limit: 10,
  });

  assert.equal(capturedUrl, "https://example.bitrix24.ru/rest/1/token/tasks.task.list.json");
  assert.equal(capturedBody.filter.RESPONSIBLE_ID, 17);
  assert.equal(result.userId, "u-pm-1");
  assert.equal(result.bitrixUserId, 17);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].groupId, "93");
  assert.equal(result.tasks[0].statusLabel, "completed");
});

test("Bitrix client skips user task lookup when user mapping is missing", async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ result: { tasks: [] } }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new HttpBitrixClient({ webhookUrl: "https://example.bitrix24.ru/rest/1/token" });
  // Placeholder names give no usable search tokens, so no network call
  // happens; users with real names are auto-resolved via user.search
  // (covered in external-mapping.test.js).
  const result = await client.getUserTasks({
    user: { id: "u-pm-2", displayName: "PM 2", bitrixUserId: null },
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.tasks.length, 0);
  assert.equal(result.note, "User has no Bitrix user mapping");
});

test("Bitrix read-only guard allows only explicit read methods", () => {
  assert.equal(assertReadOnlyBitrixMethod("TASKS.TASK.LIST"), "tasks.task.list");
  assert.equal(assertReadOnlyBitrixMethod("crm.deal.list"), "crm.deal.list");
  assert.equal(READ_ONLY_BITRIX_METHODS.includes("tasks.task.add"), false);

  for (const method of [
    "tasks.task.add",
    "tasks.task.update",
    "tasks.task.delete",
    "crm.deal.update",
    "crm.deal.delete",
    "batch",
  ]) {
    assert.throws(() => assertReadOnlyBitrixMethod(method), /read-only guard/);
  }
});

test("Bitrix read-only guard blocks write calls before network request", async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new HttpBitrixClient({ webhookUrl: "https://example.bitrix24.ru/rest/1/token" });

  await assert.rejects(() => client.callMethod("tasks.task.update", { taskId: 1 }), /read-only guard/);
  assert.equal(fetchCalled, false);
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
