import assert from "node:assert/strict";
import test from "node:test";
import {
  HttpBitrixClient,
  MockBitrixClient,
  READ_ONLY_BITRIX_METHODS,
  assertReadOnlyBitrixMethod,
} from "../src/connectors/bitrix-client.js";

test("task.stages.get is in the read-only allowlist (kanban columns)", () => {
  assert.ok(READ_ONLY_BITRIX_METHODS.includes("task.stages.get"));
  assert.equal(assertReadOnlyBitrixMethod("TASK.STAGES.GET"), "task.stages.get");
});

test("getAllTasks pages every workgroup and labels group + kanban column", async () => {
  // Unique webhook URL so the module-level name caches don't leak across tests.
  const client = new HttpBitrixClient({ webhookUrl: "https://example.test/rest/1/abc1" });

  const calls = [];
  client.callMethod = async (method, params) => {
    calls.push({ method, params });
    if (method === "tasks.task.list") {
      if (Number(params.start) === 0) {
        return {
          result: {
            tasks: [
              { ID: 1965, TITLE: "Хэдер и навигация", GROUP_ID: 99, STAGE_ID: 913, STATUS: 3, RESPONSIBLE_ID: 15, CHANGED_DATE: "2026-06-12T10:00:00+03:00" },
              { ID: 419, TITLE: "Личная задача", GROUP_ID: 0, STAGE_ID: 0, STATUS: 2, RESPONSIBLE_ID: 53, CHANGED_DATE: "2026-06-12T09:00:00+03:00" },
            ],
          },
          total: 3,
          next: 50,
        };
      }
      return {
        result: {
          tasks: [
            { ID: 1629, TITLE: "Наблюдение за сервером", GROUP_ID: 69, STAGE_ID: 863, STATUS: 2, RESPONSIBLE_ID: 53, CHANGED_DATE: "2026-06-11T08:00:00+03:00" },
          ],
        },
        total: 3,
      };
    }
    if (method === "socialnetwork.api.workgroup.list") {
      return { result: { workgroups: [
        { ID: 99, NAME: "Сайт анализа звонков" },
        { ID: 69, NAME: "ИИ чат-бот" },
      ] } };
    }
    if (method === "task.stages.get") {
      const gid = Number(params.entityId);
      if (gid === 99) return { result: { 913: { ID: "913", TITLE: "В работе" } } };
      if (gid === 69) return { result: { 863: { ID: "863", TITLE: "Бэклог" } } };
      return { result: {} };
    }
    throw new Error(`unexpected method ${method}`);
  };

  const result = await client.getAllTasks({ limit: 100 });
  assert.equal(result.source, "bitrix");
  assert.equal(result.tasks.length, 3);

  const byId = Object.fromEntries(result.tasks.map((t) => [t.id, t]));
  assert.equal(byId["1965"].groupName, "Сайт анализа звонков");
  assert.equal(byId["1965"].stageName, "В работе");
  assert.equal(byId["1629"].groupName, "ИИ чат-бот");
  assert.equal(byId["1629"].stageName, "Бэклог");
  // group 0 is the personal kanban board.
  assert.equal(byId["419"].groupName, "Личные задачи");

  // Workgroup names resolved once even though three distinct groups appear.
  const workgroupCalls = calls.filter((c) => c.method === "socialnetwork.api.workgroup.list");
  assert.equal(workgroupCalls.length, 1);
  // Two pages of tasks were read (start 0, then start 50).
  const taskListCalls = calls.filter((c) => c.method === "tasks.task.list");
  assert.equal(taskListCalls.length, 2);
});

test("MockBitrixClient.getAllTasks is a safe no-op when unconfigured", async () => {
  const result = await new MockBitrixClient().getAllTasks();
  assert.deepEqual(result.tasks, []);
  assert.equal(result.configured, false);
});
