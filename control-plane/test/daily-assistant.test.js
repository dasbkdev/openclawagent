import assert from "node:assert/strict";
import test from "node:test";
import {
  addDailyBlocker,
  buildDailyManagerReport,
  buildDailyProgress,
  collectDueDailyAssistantPrompts,
  clearDailyPlan,
  createOrUpdateDailyPlan,
  ensureDailyAssistantState,
  findTodayPlanForUser,
  formatDailyProgress,
  getLocalDateKey,
  markDailyPlanItemDone,
  removeDailyPlanItem,
} from "../src/domain/daily-assistant.js";

test("removeDailyPlanItem and clearDailyPlan edit/clear the plan", () => {
  const now = new Date("2026-06-16T06:00:00.000Z");
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const pm = getUserById(state, "u-pm-1");
  pm.telegram = { telegramUserId: "777", username: "pm1", linkedAt: now.toISOString() };

  createOrUpdateDailyPlan(state, { actor: pm, text: "отчет; канбан; клиент", now });
  // remove by text
  const r1 = removeDailyPlanItem(state, { actor: pm, selector: "канбан", now });
  assert.equal(r1.item.title, "канбан");
  assert.deepEqual(findTodayPlanForUser(state, pm.id, now).items.map((i) => i.title), ["отчет", "клиент"]);
  // remove by number
  removeDailyPlanItem(state, { actor: pm, selector: "1", now });
  assert.deepEqual(findTodayPlanForUser(state, pm.id, now).items.map((i) => i.title), ["клиент"]);
  // clear whole plan
  const cleared = clearDailyPlan(state, { actor: pm, now });
  assert.equal(cleared.existed, true);
  assert.equal(findTodayPlanForUser(state, pm.id, now), null);
  // clearing again is a safe no-op
  assert.equal(clearDailyPlan(state, { actor: pm, now }).existed, false);
});
import { getUserById } from "../src/domain/policy.js";
import { createInitialState } from "../src/infra/seed.js";

test("daily plan merges new items and a stray message never wipes it", () => {
  const now = new Date("2026-06-16T06:00:00.000Z");
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const pm = getUserById(state, "u-pm-1");
  pm.telegram = { telegramUserId: "777", username: "pm1", linkedAt: now.toISOString() };

  createOrUpdateDailyPlan(state, { actor: pm, text: "отчет; канбан; клиент", now });
  markDailyPlanItemDone(state, { actor: pm, selector: "1", now });
  const merged = createOrUpdateDailyPlan(state, { actor: pm, text: "почта; звонок", now });
  assert.deepEqual(merged.items.map((i) => i.title), ["отчет", "канбан", "клиент", "почта", "звонок"]);
  assert.equal(merged.items[0].status, "done"); // preserved across merge

  // a stray "дня" is filtered to nothing -> throws, plan untouched
  assert.throws(() => createOrUpdateDailyPlan(state, { actor: pm, text: "дня", now }));
  assert.equal(findTodayPlanForUser(state, pm.id, now).items.length, 5);

  // re-sending existing items does not duplicate them
  const again = createOrUpdateDailyPlan(state, { actor: pm, text: "отчет; почта", now });
  assert.equal(again.items.length, 5);

  // explicit replace rebuilds from scratch
  const replaced = createOrUpdateDailyPlan(state, { actor: pm, text: "ревью; деплой", replace: true, now });
  assert.deepEqual(replaced.items.map((i) => i.title), ["ревью", "деплой"]);
});

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
  // Only the project task assigned to u-pm-1 counts into personal metrics;
  // the other member's task is excluded.
  assert.equal(progress.metrics.projectBitrixTasks, 1);
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

test("plan reminder fires in the afternoon only when no plan exists yet", () => {
  const now = new Date("2026-06-18T10:30:00Z"); // 16:30 Asia/Bishkek -> plan_reminder window
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const pm = getUserById(state, "u-pm-1");
  pm.telegram = { telegramUserId: "777", linkedAt: now.toISOString() };

  const first = collectDueDailyAssistantPrompts(state, { now }).filter((m) => m.chatId === "777");
  assert.ok(first.some((m) => /плана на сегодня ещё нет/u.test(m.text)));
  // once per day — second poll sends nothing new to this user
  assert.equal(collectDueDailyAssistantPrompts(state, { now }).filter((m) => m.chatId === "777").length, 0);

  // a user who already has a plan gets no reminder
  const state2 = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const pm2 = getUserById(state2, "u-pm-1");
  pm2.telegram = { telegramUserId: "777", linkedAt: now.toISOString() };
  createOrUpdateDailyPlan(state2, { actor: pm2, text: "задача1; задача2", now });
  const withPlan = collectDueDailyAssistantPrompts(state2, { now }).filter((m) => m.chatId === "777");
  assert.equal(withPlan.some((m) => /плана на сегодня ещё нет/u.test(m.text)), false);
});

test("weekly manager report aggregates the last 7 days of stored daily reports", async () => {
  const { buildWeeklyManagerReport, formatWeeklyManagerReport } = await import("../src/domain/daily-assistant.js");
  const now = new Date("2026-06-22T12:00:00Z");
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const owner = getUserById(state, "u-nikolay");
  state.managerReports = [
    { recipientUserId: owner.id, period: "day", date: "2026-06-19", createdAt: "2026-06-19T19:00:00Z", summary: { plannedTasks: 4, completedTasks: 3, overdueTasks: 1, averageEfficiency: 0.7 }, risks: [{ userDisplayName: "Бегайым", message: "просрочка" }] },
    { recipientUserId: owner.id, period: "day", date: "2026-06-20", createdAt: "2026-06-20T19:00:00Z", summary: { plannedTasks: 2, completedTasks: 2, overdueTasks: 0, averageEfficiency: 0.9 }, risks: [] },
    { recipientUserId: owner.id, period: "day", date: "2026-06-10", createdAt: "2026-06-10T19:00:00Z", summary: { plannedTasks: 9, completedTasks: 0, overdueTasks: 9, averageEfficiency: 0 }, risks: [] }, // >7d ago, excluded
  ];
  const report = buildWeeklyManagerReport(state, { actor: owner, now });
  assert.equal(report.activeDays, 2);
  assert.equal(report.summary.plannedTasks, 6);
  assert.equal(report.summary.completedTasks, 5);
  assert.equal(report.summary.overdueTasks, 1);
  const text = formatWeeklyManagerReport(report);
  assert.match(text, /Недельный отчёт/u);
  assert.match(text, /5\/6/u);
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
            // Assigned to another member: excluded from personal metrics.
            responsibleId: "1",
            deadline: "2026-06-05T12:00:00.000Z",
          },
          {
            id: `${project.id}-2`,
            title: "Late task",
            status: 3,
            statusLabel: "in_progress",
            // Assigned to u-pm-1 (bitrixUserId 17 in seed).
            responsibleId: "17",
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
