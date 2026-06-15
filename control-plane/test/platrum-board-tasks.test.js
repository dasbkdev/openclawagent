import assert from "node:assert/strict";
import test from "node:test";
import {
  HttpPlatrumClient,
  MockPlatrumClient,
  normalizePlatrumTask,
} from "../src/connectors/platrum-client.js";

test("normalizePlatrumTask captures board identity including personal boards", () => {
  const personal = normalizePlatrumTask({
    id: 48,
    board: 13,
    board_name: "beks board",
    board_is_personal: true,
    project_id: null,
    column_name: "В работе",
    title: "Обсудить работу агента Metricon",
    assignee: 18,
    assignee_username: "beks",
    status: "in_progress",
  });
  assert.equal(personal.boardId, 13);
  assert.equal(personal.boardName, "beks board");
  assert.equal(personal.boardIsPersonal, true);
  // With no project mapping, projectId falls back to the board id (legacy behavior).
  assert.equal(personal.projectId, 13);

  const projectTask = normalizePlatrumTask({
    id: 43,
    board: 11,
    board_name: "проект для Нура",
    board_is_personal: false,
    project_id: 11,
    title: "сделать обход",
    status: "completed",
  });
  assert.equal(projectTask.boardIsPersonal, false);
  assert.equal(projectTask.boardId, 11);
  assert.equal(projectTask.projectId, 11);
});

test("getAllTasks returns every task across boards, normalized", async () => {
  const client = new HttpPlatrumClient({
    baseUrl: "https://example.test",
    username: "u",
    password: "p",
  });
  // Stub the HTTP layer: getAllTasks hits /api/v1/tasks/team/.
  client.requestJson = async (path) => {
    assert.equal(path, "/api/v1/tasks/team/");
    return [
      { id: 48, board: 13, board_name: "beks board", board_is_personal: true, project_id: null, title: "a", status: "in_progress" },
      { id: 44, board: 4, board_name: "ДТМ", board_is_personal: false, project_id: 4, title: "b", status: "new" },
    ];
  };
  const result = await client.getAllTasks({ limit: 100 });
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].boardIsPersonal, true);
  assert.equal(result.tasks[1].boardName, "ДТМ");
});

test("MockPlatrumClient.getAllTasks is a safe no-op when unconfigured", async () => {
  const result = await new MockPlatrumClient().getAllTasks();
  assert.deepEqual(result.tasks, []);
  assert.equal(result.configured, false);
});
