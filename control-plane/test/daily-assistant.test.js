import assert from "node:assert/strict";
import test from "node:test";
import {
  addDailyBlocker,
  buildDailyManagerReport,
  buildDailyProgress,
  collectDueDailyAssistantPrompts,
  createOrUpdateDailyPlan,
  ensureDailyAssistantState,
  formatDailyProgress,
  getLocalDateKey,
  markDailyPlanItemDone,
} from "../src/domain/daily-assistant.js";
import { getUserById } from "../src/domain/policy.js";
import { createInitialState } from "../src/infra/seed.js";

test("daily assistant creates plan, marks done, and calculates progress", async () => {
  const now = new Date("2026-06-05T06:00:00.000Z");
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const pm = getUserById(state, "u-pm-1");
  pm.telegram = { telegramUserId: "777", username: "pm1", linkedAt: now.toISOString() };

  const plan = createOrUpdateDailyPlan(state, {
    actor: pm,
    text: "закрыть отчет; проверить канбан; написать клиенту",
    now,
  });
  assert.equal(plan.items.length, 3);

  const done = markDailyPlanItemDone(state, { actor: pm, selector: "1", now });
  assert.equal(done.item.status, "done");

  addDailyBlocker(state, { actor: pm, text: "жду ответ от клиента", now });

  const progress = await buildDailyProgress(state, {
    actor: pm,
    now,
    kickidlerClient: fakeMetriconClient(),
    bitrixClient: fakeBitrixClient(),
  });

  assert.equal(progress.metrics.plannedTasks, 3);
  assert.equal(progress.metrics.completedTasks, 1);
  assert.equal(progress.metrics.overdueTasks, 1);
  assert.equal(progress.metrics.projectBitrixTasks, 2);
  assert.equal(progress.metrics.assignedBitrixTasks, 1);
  assert.equal(progress.metrics.activeSeconds, 18_000);
  assert.equal(progress.blockers.length, 1);
  assert.equal(progress.metrics.confidence, "high");
  assert.match(formatDailyProgress(progress), /Эффективность/u);
  assert.match(formatDailyProgress(progress), /жду ответ от клиента/u);
  assert.equal(state.workMetricsDaily.length, 1);
});

test("daily assistant manager report follows hierarchy", async () => {
  const now = new Date("2026-06-05T06:00:00.000Z");
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const owner = getUserById(state, "u-nikolay");
  const maksat = getUserById(state, "u-maksat");
  const pm1 = getUserById(state, "u-pm-1");
  maksat.telegram = { telegramUserId: "888", username: "maksat", linkedAt: now.toISOString() };
  pm1.telegram = { telegramUserId: "777", username: "pm1", linkedAt: now.toISOString() };
  createOrUpdateDailyPlan(state, { actor: pm1, text: "закрыть отчет; проверить канбан", now });

  const report = await buildDailyManagerReport(state, {
    actor: owner,
    now,
    kickidlerClient: fakeMetriconClient(),
    bitrixClient: fakeBitrixClient(),
  });

  assert.deepEqual(report.scopeUserIds, ["u-nikolay", "u-maksat", "u-pm-1", "u-pm-2", "u-pm-3"]);
  assert.equal(report.summary.plannedTasks >= 2, true);
  assert.equal(state.managerReports.length, 1);
});

test("daily assistant prompts are sent once per local day window", () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  ensureDailyAssistantState(state);
  const now = new Date("2026-06-05T03:15:00.000Z");
  const date = getLocalDateKey(now);

  const first = collectDueDailyAssistantPrompts(state, { now });
  const second = collectDueDailyAssistantPrompts(state, { now });

  assert.equal(date, "2026-06-05");
  assert.equal(first.length, 1);
  assert.equal(first[0].text.includes("/plan"), true);
  assert.equal(second.length, 0);
  assert.equal(state.assistantCheckins.some((checkin) => checkin.type === "morning_prompt"), true);
});

function fakeMetriconClient() {
  return {
    async getActivitySummary({ employeeIds, from, to }) {
      return {
        source: "metricon",
        configured: true,
        from,
        to,
        employees: employeeIds.map((kickidlerEmployeeId) => ({
          kickidlerEmployeeId,
          activeSeconds: 18_000,
          idleSeconds: 1_200,
        })),
      };
    },
  };
}

function fakeBitrixClient() {
  return {
    async getProjectTasks({ project }) {
      return {
        source: "bitrix",
        configured: true,
        projectId: project.id,
        tasks: [
          {
            id: `${project.id}-1`,
            title: "Done task",
            status: 5,
            statusLabel: "completed",
            deadline: "2026-06-05T12:00:00.000Z",
          },
          {
            id: `${project.id}-2`,
            title: "Late task",
            status: 3,
            statusLabel: "in_progress",
            deadline: "2026-06-04T12:00:00.000Z",
          },
        ],
      };
    },
    async getUserTasks({ user }) {
      return {
        source: "bitrix",
        configured: true,
        userId: user.id,
        bitrixUserId: user.bitrixUserId ?? null,
        tasks: [
          {
            id: `${user.id}-assigned-1`,
            title: "Assigned done task",
            groupId: "93",
            status: 5,
            statusLabel: "completed",
            deadline: "2026-06-05T12:00:00.000Z",
          },
        ],
      };
    },
  };
}
