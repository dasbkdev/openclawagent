import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReadOnlyPlatrumRequest,
  HttpPlatrumClient,
  normalizePlatrumTask,
  normalizePlatrumWeeklyPlan,
  READ_ONLY_PLATRUM_ENDPOINTS,
} from "../src/connectors/platrum-client.js";
import {
  buildPlatrumProjectStatusReport,
  buildPlatrumUserStatusReport,
  summarizePlatrumTasks,
} from "../src/domain/platrum-reports.js";
import { getUserById } from "../src/domain/policy.js";
import { createInitialState } from "../src/infra/seed.js";

test("Platrum read-only guard allows safe reads and auth only", () => {
  assert.ok(READ_ONLY_PLATRUM_ENDPOINTS.length > 5);
  assert.deepEqual(assertReadOnlyPlatrumRequest("GET", "/api/v1/tasks/team/"), {
    method: "GET",
    path: "/api/v1/tasks/team/",
  });
  assert.deepEqual(assertReadOnlyPlatrumRequest("POST", "/api/v1/auth/login/"), {
    method: "POST",
    path: "/api/v1/auth/login/",
  });

  for (const [method, path] of [
    ["POST", "/api/v1/tasks/projects/"],
    ["PATCH", "/api/v1/tasks/8/"],
    ["POST", "/api/v1/tasks/8/approve/"],
    ["POST", "/api/v1/tasks/8/move/"],
    ["DELETE", "/api/v1/tasks/8/"],
    ["PUT", "/api/v1/accounts/org/users/25/"],
  ]) {
    assert.throws(() => assertReadOnlyPlatrumRequest(method, path), /read-only guard/);
  }
});

test("Platrum write calls are blocked before network request", async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new HttpPlatrumClient({
    baseUrl: "https://platrum.example",
    username: "ai",
    password: "secret",
  });

  await assert.rejects(
    () => client.requestJson("/api/v1/tasks/8/", { method: "PATCH", body: { title: "changed" } }),
    /read-only guard/,
  );
  assert.equal(fetchCalled, false);
});

test("Platrum client reads project tasks through GET only", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    if (String(url).endsWith("/api/v1/auth/login/")) {
      return new Response(JSON.stringify({ access: "access-token", refresh: "refresh-token" }), { status: 200 });
    }
    if (String(url).endsWith("/api/v1/tasks/projects/6/tasks/")) {
      return new Response(
        JSON.stringify([
          {
            id: 8,
            title: "Configure AI agent",
            project_id: 6,
            assignee: 23,
            assignee_username: "max",
            status: "review",
            is_overdue: true,
            due_date: "2026-06-04T21:00:00+06:00",
          },
        ]),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new HttpPlatrumClient({
    baseUrl: "https://platrum.example",
    username: "ai",
    password: "secret",
  });
  const result = await client.getProjectTasks({
    project: { id: "project-alpha", platrumProjectId: 6 },
  });

  assert.deepEqual(calls.map((call) => call.method), ["POST", "GET"]);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].statusLabel, "review");
  assert.equal(result.tasks[0].overdue, true);
});

test("Platrum task normalization and summary include review credit and overdue penalty", () => {
  const tasks = [
    normalizePlatrumTask({ id: 1, title: "Done", status: "completed", is_overdue: false }),
    normalizePlatrumTask({ id: 2, title: "Review", status: "review", is_overdue: false }),
    normalizePlatrumTask({ id: 3, title: "Late", status: "in_progress", is_overdue: true }),
  ];
  const summary = summarizePlatrumTasks(tasks);

  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.review, 1);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.open, 2);
  assert.equal(summary.efficiencyPercent, 50);
});

test("Platrum weekly schedule normalization preserves exact daily hours", () => {
  const plan = normalizePlatrumWeeklyPlan({
    id: 7,
    user: 23,
    username: "max",
    week_start: "2026-06-08",
    status: "approved",
    days: [
      {
        date: "2026-06-11",
        start_time: "09:00:00",
        end_time: "18:00:00",
        mode: "office",
        segments: [{ mode: "office", start: "09:00", end: "18:00" }],
      },
      {
        date: "2026-06-13",
        start_time: null,
        end_time: null,
        mode: "day_off",
      },
    ],
  });

  assert.equal(plan.userId, 23);
  assert.equal(plan.days[0].startTime, "09:00");
  assert.equal(plan.days[0].endTime, "18:00");
  assert.equal(plan.days[1].mode, "day_off");
});

test("Platrum project report writes read-only project KPI snapshot", async () => {
  const state = createInitialState();
  const owner = getUserById(state, "u-nikolay");
  const client = {
    async getProjectTasks() {
      return {
        source: "test",
        configured: true,
        platrumProjectId: 6,
        tasks: [
          { id: 8, title: "Review task", statusLabel: "review", overdue: true, deadline: "2026-06-04T00:00:00Z" },
        ],
      };
    },
    async getProjectReport() {
      return {
        source: "test",
        configured: true,
        platrumProjectId: 6,
        report: { projectId: 6, progressPercentage: 0, overdueTaskCount: 1 },
      };
    },
  };

  const report = await buildPlatrumProjectStatusReport(state, {
    actor: owner,
    request: { projectId: "project-alpha" },
    platrumClient: client,
  });

  assert.equal(report.readOnly, true);
  assert.equal(report.summary.total, 1);
  assert.equal(state.projectKpiDaily.length, 1);
  assert.equal(state.platrumSnapshots.length, 1);
  assert.equal(state.auditLog.at(-1).action, "platrum.project_status.read");
});

test("Platrum user report stores employee KPI snapshot", async () => {
  const state = createInitialState();
  const owner = getUserById(state, "u-nikolay");
  const client = {
    async getUserTasks() {
      return {
        source: "test",
        configured: true,
        platrumUserId: 23,
        platrumUsername: "max",
        tasks: [
          { id: 10, title: "Done", statusLabel: "completed", overdue: false },
          { id: 11, title: "Review", statusLabel: "review", overdue: false },
        ],
      };
    },
    async getProjectTasks() {
      return { source: "test", configured: true, platrumProjectId: 6, tasks: [] };
    },
    async getDailyReports() {
      return {
        source: "test",
        configured: true,
        reports: [
          { id: 1, userId: 23, username: "max", reportDate: "2026-06-10", isLate: false },
        ],
      };
    },
    async getTeamMetrics() {
      return { source: "test", configured: true, metrics: { attendance_percent_month: 90 } };
    },
  };

  const report = await buildPlatrumUserStatusReport(state, {
    actor: owner,
    request: { userId: "u-maksat" },
    platrumClient: client,
  });

  assert.equal(report.readOnly, true);
  assert.equal(report.analytics.efficiencyPercent, 80);
  assert.equal(state.employeeKpiDaily.length, 1);
  assert.equal(state.platrumSnapshots.length, 1);
  assert.equal(state.auditLog.at(-1).action, "platrum.user_status.read");
});

test("Platrum user report does not attribute other members' project tasks", async () => {
  const state = createInitialState();
  const owner = getUserById(state, "u-nikolay");
  const targetUser = getUserById(state, "u-pm-1");
  targetUser.platrumUserId = 18;
  targetUser.platrumUsername = "beks";
  const client = {
    async getUserTasks() {
      return {
        source: "test",
        configured: true,
        platrumUserId: 18,
        platrumUsername: "beks",
        tasks: [],
      };
    },
    async getProjectTasks() {
      return {
        source: "test",
        configured: true,
        platrumProjectId: 6,
        tasks: [
          {
            id: 50,
            title: "Задача Максата",
            statusLabel: "review",
            overdue: true,
            assigneeId: 23,
            assigneeUsername: "max",
          },
          {
            id: 51,
            title: "Задача Бегайым в проекте",
            statusLabel: "completed",
            overdue: false,
            assigneeId: 18,
            assigneeUsername: "beks",
          },
        ],
      };
    },
    async getDailyReports() {
      return { source: "test", configured: true, reports: [] };
    },
    async getTeamMetrics() {
      return { source: "test", configured: true, metrics: {} };
    },
  };

  const report = await buildPlatrumUserStatusReport(state, {
    actor: owner,
    request: { userId: "u-pm-1" },
    platrumClient: client,
  });

  const combinedIds = report.combined.tasks.map((task) => task.id);
  assert.deepEqual(combinedIds, [51]);
  assert.equal(report.analytics.taskSummary.total, 1);
  assert.equal(report.analytics.taskSummary.overdue, 0);
  assert.equal(report.combined.summary.completed, 1);
});
