import { appendAuditEvent } from "../infra/audit.js";
import { validation } from "./errors.js";
import {
  assertCanAccessUser,
  canAccessProject,
  getUserById,
  listAccessibleUserIds,
  publicProject,
  publicUser,
} from "./policy.js";
import { Roles } from "./roles.js";

const DEFAULT_TIME_ZONE = "Asia/Bishkek";
const DEFAULT_UTC_OFFSET = "+06:00";
const MORNING_START_HOUR = 9;
const MORNING_END_HOUR = 10;
const AFTERNOON_START_HOUR = 15;
const AFTERNOON_END_HOUR = 16;
const EVENING_START_HOUR = 18;
const EVENING_END_HOUR = 19;
const MANAGER_REPORT_START_HOUR = 19;
const MANAGER_REPORT_END_HOUR = 20;

export function ensureDailyAssistantState(state) {
  state.dailyWorkPlans ??= [];
  state.taskSnapshots ??= [];
  state.assistantCheckins ??= [];
  state.assistantNudges ??= [];
  state.workMetricsDaily ??= [];
  state.managerReports ??= [];
  return state;
}

export function getLocalDateKey(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function getLocalHour(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
}

export function getLocalDayPeriod(date, utcOffset = DEFAULT_UTC_OFFSET) {
  return {
    from: new Date(`${date}T00:00:00${utcOffset}`).toISOString(),
    to: new Date(`${date}T23:59:59.999${utcOffset}`).toISOString(),
    label: date,
  };
}

export function getCommandRemainder(command) {
  const raw = String(command?.raw || "").trim();
  const firstSpace = raw.search(/\s/u);
  return firstSpace === -1 ? "" : raw.slice(firstSpace + 1).trim();
}

export function createOrUpdateDailyPlan(state, { actor, userId = actor.id, text, replace = false, now = new Date() }) {
  ensureDailyAssistantState(state);
  assertCanAccessUser(state, actor, userId);
  if (actor.role === Roles.PM && actor.id !== userId) {
    throw validation("PM can edit only own daily plan");
  }

  const planText = String(text || "").trim();
  if (!planText) {
    throw validation("Plan text is required. Example: /plan закрыть задачу A; проверить отчет; написать клиенту");
  }

  const date = getLocalDateKey(now);
  const parsed = parsePlanItems(planText);
  if (!parsed.length) {
    throw validation("Plan must contain at least one task");
  }

  const existing = findDailyPlan(state, userId, date);

  // Default is to MERGE new items into today's plan (keeping already-planned
  // items and their done status), so a short or stray message can never wipe
  // the day's work. `replace` rebuilds the plan from scratch.
  let items;
  if (existing && !replace) {
    const seen = new Set(existing.items.map((item) => normalizeText(item.title)));
    const appended = parsed.filter((titleText) => !seen.has(normalizeText(titleText)));
    items = [...existing.items.map((item) => item.title), ...appended];
  } else {
    items = parsed;
  }

  const plan = existing || {
    id: `daily-plan-${userId}-${date}`,
    userId,
    date,
    source: "telegram",
    createdAt: now.toISOString(),
  };

  plan.items = items.map((title, index) => {
    const previous = existing?.items?.find((item) => normalizeText(item.title) === normalizeText(title));
    return {
      id: previous?.id || `plan-item-${date}-${index + 1}`,
      title,
      status: previous?.status || "planned",
      source: "manual",
      completedAt: previous?.completedAt || null,
    };
  });
  plan.plannedTaskTitles = plan.items.map((item) => item.title);
  plan.confirmedByUser = actor.id === userId;
  plan.userNotes = planText;
  plan.updatedAt = now.toISOString();
  plan.updatedByUserId = actor.id;

  if (!existing) {
    state.dailyWorkPlans.push(plan);
  }

  appendAuditEvent(state, {
    actorUserId: actor.id,
    actorTelegramUserId: actor.telegram?.telegramUserId,
    action: "daily_assistant.plan.upsert",
    target: { userId, date },
    metadata: { items: plan.items.length },
  });

  return plan;
}

export function markDailyPlanItemDone(state, { actor, userId = actor.id, selector, now = new Date() }) {
  ensureDailyAssistantState(state);
  assertCanAccessUser(state, actor, userId);
  if (actor.role === Roles.PM && actor.id !== userId) {
    throw validation("PM can update only own daily plan");
  }

  const date = getLocalDateKey(now);
  const plan = findDailyPlan(state, userId, date);
  if (!plan) {
    throw validation("Daily plan is not created yet. Use /plan first.");
  }

  const item = resolvePlanItem(plan, selector);
  item.status = "done";
  item.completedAt = now.toISOString();
  plan.updatedAt = now.toISOString();
  plan.updatedByUserId = actor.id;

  appendAuditEvent(state, {
    actorUserId: actor.id,
    actorTelegramUserId: actor.telegram?.telegramUserId,
    action: "daily_assistant.plan_item.done",
    target: { userId, date, itemId: item.id },
  });

  return { plan, item };
}

export function markRemainingDailyPlanItemsDone(state, { actor, userId = actor.id, now = new Date() }) {
  ensureDailyAssistantState(state);
  assertCanAccessUser(state, actor, userId);
  if (actor.role === Roles.PM && actor.id !== userId) {
    throw validation("PM can update only own daily plan");
  }

  const date = getLocalDateKey(now);
  const plan = findDailyPlan(state, userId, date);
  if (!plan) {
    throw validation("Daily plan is not created yet. Use /plan first.");
  }

  const items = plan.items.filter((item) => item.status !== "done");
  if (!items.length) {
    return { plan, items: [], completedCount: 0 };
  }

  for (const item of items) {
    item.status = "done";
    item.completedAt = now.toISOString();
  }
  plan.updatedAt = now.toISOString();
  plan.updatedByUserId = actor.id;

  appendAuditEvent(state, {
    actorUserId: actor.id,
    actorTelegramUserId: actor.telegram?.telegramUserId,
    action: "daily_assistant.plan_remaining.done",
    target: { userId, date },
    metadata: { items: items.length },
  });

  return { plan, items, completedCount: items.length };
}

export function addDailyBlocker(state, { actor, userId = actor.id, text, now = new Date() }) {
  ensureDailyAssistantState(state);
  assertCanAccessUser(state, actor, userId);
  if (actor.role === Roles.PM && actor.id !== userId) {
    throw validation("PM can create blockers only for self");
  }

  const blockerText = String(text || "").trim();
  if (!blockerText) {
    throw validation("Blocker text is required. Example: /blocker жду доступ от клиента");
  }

  const date = getLocalDateKey(now);
  const checkin = {
    id: `checkin-${date}-${userId}-blocker-${now.getTime()}`,
    userId,
    date,
    type: "blocker",
    direction: "inbound",
    message: blockerText,
    answer: null,
    createdAt: now.toISOString(),
    createdByUserId: actor.id,
  };
  const nudge = {
    id: `nudge-${date}-${userId}-blocker-${now.getTime()}`,
    userId,
    date,
    reason: "user_blocker",
    severity: "warning",
    message: blockerText,
    sentAt: null,
    acknowledgedAt: now.toISOString(),
    createdAt: now.toISOString(),
    createdByUserId: actor.id,
  };
  state.assistantCheckins.push(checkin);
  state.assistantNudges.push(nudge);

  appendAuditEvent(state, {
    actorUserId: actor.id,
    actorTelegramUserId: actor.telegram?.telegramUserId,
    action: "daily_assistant.blocker.create",
    target: { userId, date },
  });

  return { checkin, nudge };
}

export async function buildDailyProgress(state, {
  actor,
  userId = actor.id,
  now = new Date(),
  kickidlerClient,
  bitrixClient,
  platrumClient,
}) {
  ensureDailyAssistantState(state);
  assertCanAccessUser(state, actor, userId);
  const user = getUserById(state, userId);
  const date = getLocalDateKey(now);
  const period = getLocalDayPeriod(date);
  const plan = findDailyPlan(state, userId, date);
  const projects = listUserProjects(state, actor, userId);
  const usePlatrum = Boolean(platrumClient?.getUserTasks);
  const platrum = usePlatrum ? await readPlatrumProjects({ projects, platrumClient, now }) : [];
  const platrumUserTasks = usePlatrum ? await readPlatrumUserTasks({ user, platrumClient, now, period }) : null;
  const bitrix = usePlatrum ? platrum : await readBitrixProjects({ projects, bitrixClient, now });
  const bitrixUserTasks = usePlatrum ? platrumUserTasks : await readBitrixUserTasks({ user, bitrixClient, now });
  const metricon = await readMetriconUser({ user, period, kickidlerClient });
  const blockers = listDailyBlockers(state, userId, date);
  const metrics = calculateDailyMetrics({ user, date, plan, bitrix, bitrixUserTasks, metricon, blockers, now });
  upsertDailyMetrics(state, metrics);

  appendAuditEvent(state, {
    actorUserId: actor.id,
    actorTelegramUserId: actor.telegram?.telegramUserId,
    action: "daily_assistant.progress.read",
    target: { userId, date },
    metadata: {
      plannedTasks: metrics.plannedTasks,
      completedTasks: metrics.completedTasks,
      confidence: metrics.confidence,
    },
  });

  return {
    user: publicUser(user),
    date,
    period,
    plan: plan || null,
    projects: projects.map(publicProject),
    workSource: usePlatrum ? "platrum" : "bitrix",
    platrum,
    platrumUserTasks,
    bitrix,
    bitrixUserTasks,
    metricon,
    blockers,
    metrics,
  };
}

export async function buildDailyManagerReport(state, {
  actor,
  now = new Date(),
  kickidlerClient,
  bitrixClient,
  platrumClient,
  targetUserId,
}) {
  ensureDailyAssistantState(state);
  const date = getLocalDateKey(now);
  const targetUsers = resolveReportUsers(state, actor, targetUserId);
  const userReports = [];
  for (const user of targetUsers) {
    userReports.push(
      await buildDailyProgress(state, {
        actor,
        userId: user.id,
        now,
        kickidlerClient,
        bitrixClient,
        platrumClient,
      }),
    );
  }

  const risks = userReports.flatMap((report) => buildRisks(report));
  const report = {
    id: `manager-report-${actor.id}-${date}-${now.getTime()}`,
    recipientUserId: actor.id,
    period: "day",
    date,
    scopeUserIds: targetUsers.map((user) => user.id),
    summary: summarizeManagerReport(userReports),
    risks,
    createdAt: now.toISOString(),
    sentAt: null,
    reports: userReports,
  };
  state.managerReports.push(report);

  appendAuditEvent(state, {
    actorUserId: actor.id,
    actorTelegramUserId: actor.telegram?.telegramUserId,
    action: "daily_assistant.manager_report.create",
    target: { date, userIds: report.scopeUserIds },
    metadata: { risks: risks.length },
  });

  return report;
}

export function collectDueDailyAssistantPrompts(state, { now = new Date(), timeZone = DEFAULT_TIME_ZONE } = {}) {
  ensureDailyAssistantState(state);
  const date = getLocalDateKey(now, timeZone);
  const hour = getLocalHour(now, timeZone);
  const messages = [];
  const registeredUsers = state.users.filter((user) => user.telegram?.telegramUserId);

  if (hour >= MORNING_START_HOUR && hour < MORNING_END_HOUR) {
    for (const user of registeredUsers) {
      const type = "morning_prompt";
      if (hasOutboundCheckin(state, user.id, date, type)) {
        continue;
      }
      const text = [
        title(`Доброе утро, ${user.displayName}`),
        "Напиши план на день одной командой:",
        codeLine("/plan задача 1; задача 2; задача 3"),
        "",
        "Я буду помогать держать фокус и вечером соберу понятный итог для руководителя.",
      ].join("\n");
      recordOutboundCheckin(state, { userId: user.id, date, type, message: text, now });
      messages.push({ chatId: user.telegram.telegramUserId, text });
    }
  }

  if (hour >= AFTERNOON_START_HOUR && hour < AFTERNOON_END_HOUR) {
    for (const user of registeredUsers) {
      const type = "afternoon_prompt";
      if (hasOutboundCheckin(state, user.id, date, type)) {
        continue;
      }
      const text = [
        title(`${user.displayName}: проверка дня`),
        "Посмотри текущий прогресс:",
        codeLine("/progress"),
        "",
        "Если что-то мешает, сразу зафиксируй проблему:",
        codeLine("/blocker текст"),
      ].join("\n");
      recordOutboundCheckin(state, { userId: user.id, date, type, message: text, now });
      messages.push({ chatId: user.telegram.telegramUserId, text });
    }
  }

  if (hour >= EVENING_START_HOUR && hour < EVENING_END_HOUR) {
    for (const user of registeredUsers) {
      const type = "evening_prompt";
      if (hasOutboundCheckin(state, user.id, date, type)) {
        continue;
      }
      const text = [
        title(`${user.displayName}: закрываем день`),
        "Проверь итог дня:",
        codeLine("/today"),
        "",
        "Отметь готовые пункты:",
        codeLine("/done НОМЕР"),
        "",
        "Если что-то не успелось, напиши причину:",
        codeLine("/blocker текст"),
      ].join("\n");
      recordOutboundCheckin(state, { userId: user.id, date, type, message: text, now });
      messages.push({ chatId: user.telegram.telegramUserId, text });
    }
  }

  return messages;
}

export function isManagerReportDue(state, user, { now = new Date(), timeZone = DEFAULT_TIME_ZONE } = {}) {
  ensureDailyAssistantState(state);
  if (!user.telegram?.telegramUserId || (user.role !== Roles.OWNER && user.role !== Roles.SENIOR_PM)) {
    return false;
  }
  const date = getLocalDateKey(now, timeZone);
  const hour = getLocalHour(now, timeZone);
  if (hour < MANAGER_REPORT_START_HOUR || hour >= MANAGER_REPORT_END_HOUR) {
    return false;
  }
  return !state.managerReports.some(
    (report) => report.recipientUserId === user.id && report.date === date && report.period === "day" && report.sentAt,
  );
}

export function markManagerReportSent(report, now = new Date()) {
  report.sentAt = now.toISOString();
  return report;
}

export function formatDailyPlan(plan) {
  return [
    title(`План на ${plan.date} сохранен`),
    formatPlanItems(plan),
    "",
    "В течение дня можно использовать:",
    codeLine("/today"),
    codeLine("/progress"),
    codeLine("/done НОМЕР"),
    codeLine("/blocker текст"),
  ].join("\n");
}

export function formatDoneResult({ plan, item }) {
  return [
    title("Задача отмечена выполненной"),
    kv("Готово", item.title),
    "",
    formatPlanItems(plan),
  ].join("\n");
}

export function formatRemainingDoneResult({ plan, items, completedCount }) {
  return [
    title(completedCount ? "Оставшиеся задачи отмечены выполненными" : "Все задачи уже были выполнены"),
    completedCount ? kv("Новых выполненных пунктов", completedCount) : "Новых пунктов для закрытия не было.",
    "",
    items.length ? subtitle("Что закрыто") : "",
    ...items.map((item) => `- ${escapeHtml(item.title)}`),
    items.length ? "" : "",
    formatPlanItems(plan),
  ].filter((line) => line !== "").join("\n");
}

export function formatBlockerResult({ nudge }) {
  return [
    title("Проблема записана"),
    kv("Причина", nudge.message),
    "",
    "Руководитель увидит это в дневном отчете.",
  ].join("\n");
}

export function formatDailyProgress(progress) {
  const { user, plan, metrics, bitrix, bitrixUserTasks, metricon, blockers } = progress;
  const lines = [
    title(`Прогресс за ${progress.date}`),
    kv("Сотрудник", user.displayName),
    "",
    subtitle("Итоги"),
    kv("Эффективность", `${formatPercent(metrics.overallEfficiencyScore)} (${formatConfidence(metrics.confidence)})`),
    kv("План", `${metrics.completedTasks}/${metrics.plannedTasks || 0} выполнено`),
    kv("Bitrix", `всего ${metrics.bitrixTasks}, открыто ${metrics.inProgressTasks}, просрочено ${metrics.overdueTasks}`),
    kv("Bitrix по сотруднику/проектам", `${metrics.assignedBitrixTasks || 0}/${metrics.projectBitrixTasks || 0}`),
    kv("Metricon активность", formatSeconds(metrics.activeSeconds)),
  ];

  if (metrics.notes.length) {
    lines.push(kv("Примечания", metrics.notes.join("; ")));
  }

  lines.push("");
  lines.push(subtitle("План"));
  lines.push(plan ? formatPlanItems(plan) : "План еще не создан. Используй /plan задача 1; задача 2");

  if (bitrixUserTasks?.tasks?.length) {
    lines.push("");
    lines.push(subtitle("Bitrix: назначенные задачи"));
    for (const task of bitrixUserTasks.tasks.slice(0, 5)) {
      const group = task.groupId ? `, группа ${task.groupId}` : "";
      lines.push(`- [${escapeHtml(task.statusLabel)}] ${escapeHtml(task.title)}${escapeHtml(group)}`);
    }
  }

  const urgentTasks = bitrix.flatMap((project) => project.tasks.filter((task) => task.overdue).slice(0, 3));
  if (urgentTasks.length) {
    lines.push("");
    lines.push(subtitle("Риски Bitrix"));
    for (const task of urgentTasks.slice(0, 5)) {
      lines.push(`- [${escapeHtml(task.statusLabel)}] ${escapeHtml(task.title)}`);
    }
  }

  if (blockers.length) {
    lines.push("");
    lines.push(subtitle("Проблемы и блокеры"));
    for (const blocker of blockers.slice(0, 5)) {
      lines.push(`- ${escapeHtml(blocker.message)}`);
    }
  }

  if (metricon.error) {
    lines.push("");
    lines.push(kv("Metricon", metricon.error));
  }

  return lines.join("\n");
}

export function formatManagerReport(report) {
  const lines = [
    title(`Ежедневный отчет за ${report.date}`),
    kv("Сотрудников в доступе", report.scopeUserIds.length),
    "",
    subtitle("Сводка"),
    kv("Средняя эффективность", formatPercent(report.summary.averageEfficiency)),
    kv("План выполнен", `${report.summary.completedTasks}/${report.summary.plannedTasks}`),
    kv("Просрочено задач", report.summary.overdueTasks),
    "",
    subtitle("По сотрудникам"),
  ];

  for (const item of report.reports) {
    lines.push(
      `- ${escapeHtml(item.user.displayName)}: ${formatPercent(item.metrics.overallEfficiencyScore)}, план ${item.metrics.completedTasks}/${item.metrics.plannedTasks}, просрочено ${item.metrics.overdueTasks}, активность ${formatSeconds(item.metrics.activeSeconds)}`,
    );
  }

  if (report.risks.length) {
    lines.push("");
    lines.push(subtitle("Риски"));
    for (const risk of report.risks.slice(0, 10)) {
      lines.push(`- ${escapeHtml(risk.userDisplayName)}: ${escapeHtml(risk.message)}`);
    }
  }

  return lines.join("\n");
}

export function buildDailyAssistantContext(state, { targetUsers, now = new Date() }) {
  ensureDailyAssistantState(state);
  const date = getLocalDateKey(now);
  return {
    date,
    users: targetUsers.map((user) => ({
      user: publicUser(user),
      plan: findDailyPlan(state, user.id, date) || null,
      blockers: listDailyBlockers(state, user.id, date),
      metrics: findDailyMetrics(state, user.id, date) || null,
    })),
  };
}

// Header/date fragments that must never become plan items (e.g. a stray
// "план на дня" must not create an item "дня" that wipes the real plan).
const PLAN_ITEM_NOISE = new Set([
  "день", "дня", "сегодня", "завтра", "на день", "на сегодня",
  "план", "мой план", "todo", "to do", "задачи", "задача",
]);

function parsePlanItems(text) {
  return String(text)
    .split(/\r?\n|;|•/u)
    .map((item) => item.replace(/^\s*[-*\d.)]+\s*/u, "").trim())
    .filter(Boolean)
    .filter((item) => {
      const n = item.toLowerCase().replace(/ё/gu, "е").trim();
      return n.length >= 2 && !PLAN_ITEM_NOISE.has(n);
    })
    .slice(0, 20);
}

function findDailyPlan(state, userId, date) {
  return state.dailyWorkPlans?.find((plan) => plan.userId === userId && plan.date === date);
}

export function findTodayPlanForUser(state, userId, now = new Date()) {
  return findDailyPlan(state, userId, getLocalDateKey(now)) || null;
}

function findDailyMetrics(state, userId, date) {
  return state.workMetricsDaily?.find((metrics) => metrics.userId === userId && metrics.date === date);
}

function resolvePlanItem(plan, selector) {
  const normalizedSelector = String(selector || "").trim();
  if (!normalizedSelector) {
    throw validation("Specify task number or text. Example: /done 1");
  }

  const numeric = Number(normalizedSelector);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= plan.items.length) {
    return plan.items[numeric - 1];
  }

  const normalizedText = normalizeText(normalizedSelector);
  const item = plan.items.find((candidate) => normalizeText(candidate.title).includes(normalizedText));
  if (!item) {
    throw validation("Plan item not found", { selector: normalizedSelector });
  }
  return item;
}

function listUserProjects(state, actor, userId) {
  return state.projects.filter((project) => {
    const related =
      project.ownerUserId === userId ||
      project.managerUserId === userId ||
      project.memberUserIds.includes(userId);
    return related && canAccessProject(state, actor, project);
  });
}

async function readPlatrumProjects({ projects, platrumClient, now }) {
  const result = [];
  for (const project of projects) {
    try {
      const response = await platrumClient.getProjectTasks({ project, limit: 50 });
      const tasks = response.tasks.map((task) => ({
        ...task,
        overdue: Boolean(task.overdue ?? isTaskOverdue(task, now)),
      }));
      result.push({
        source: response.source,
        configured: response.configured,
        readOnly: true,
        project: publicProject(project),
        tasks,
        error: null,
        note: response.note ?? null,
      });
    } catch (error) {
      result.push({
        source: "platrum",
        configured: true,
        readOnly: true,
        project: publicProject(project),
        tasks: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

async function readPlatrumUserTasks({ user, platrumClient, now, period }) {
  if (!platrumClient?.getUserTasks) {
    return {
      source: "none",
      configured: false,
      readOnly: true,
      user: publicUser(user),
      platrumUserId: user.platrumUserId ?? null,
      tasks: [],
      error: null,
      note: "Platrum user task lookup is not supported",
    };
  }

  try {
    const response = await platrumClient.getUserTasks({ user, limit: 50, period });
    const tasks = response.tasks.map((task) => ({
      ...task,
      overdue: Boolean(task.overdue ?? isTaskOverdue(task, now)),
    }));
    return {
      source: response.source,
      configured: response.configured,
      readOnly: true,
      user: publicUser(user),
      platrumUserId: response.platrumUserId ?? user.platrumUserId ?? null,
      platrumUsername: response.platrumUsername ?? user.platrumUsername ?? null,
      tasks,
      error: null,
      note: response.note ?? null,
    };
  } catch (error) {
    return {
      source: "platrum",
      configured: true,
      readOnly: true,
      user: publicUser(user),
      platrumUserId: user.platrumUserId ?? null,
      tasks: [],
      error: error instanceof Error ? error.message : String(error),
      note: null,
    };
  }
}

async function readBitrixProjects({ projects, bitrixClient, now }) {
  const result = [];
  for (const project of projects) {
    try {
      const response = await bitrixClient.getProjectTasks({ project, limit: 50 });
      const tasks = response.tasks.map((task) => ({
        ...task,
        overdue: isTaskOverdue(task, now),
      }));
      result.push({
        source: response.source,
        configured: response.configured,
        project: publicProject(project),
        tasks,
        error: null,
      });
    } catch (error) {
      result.push({
        source: "bitrix",
        configured: true,
        project: publicProject(project),
        tasks: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

async function readBitrixUserTasks({ user, bitrixClient, now }) {
  if (!bitrixClient?.getUserTasks) {
    return {
      source: "none",
      configured: false,
      user: publicUser(user),
      bitrixUserId: user.bitrixUserId ?? null,
      tasks: [],
      error: null,
      note: "Bitrix user task lookup is not supported",
    };
  }

  try {
    const response = await bitrixClient.getUserTasks({ user, limit: 50 });
    const tasks = response.tasks.map((task) => ({
      ...task,
      overdue: isTaskOverdue(task, now),
    }));
    return {
      source: response.source,
      configured: response.configured,
      user: publicUser(user),
      bitrixUserId: response.bitrixUserId ?? user.bitrixUserId ?? null,
      tasks,
      error: null,
      note: response.note ?? null,
    };
  } catch (error) {
    return {
      source: "bitrix",
      configured: true,
      user: publicUser(user),
      bitrixUserId: user.bitrixUserId ?? null,
      tasks: [],
      error: error instanceof Error ? error.message : String(error),
      note: null,
    };
  }
}

async function readMetriconUser({ user, period, kickidlerClient }) {
  if (!user.kickidlerEmployeeId) {
    return {
      source: "none",
      configured: false,
      activeSeconds: null,
      idleSeconds: null,
      raw: null,
      error: "Metricon employee id is not configured",
    };
  }

  try {
    const summary = await kickidlerClient.getActivitySummary({
      employeeIds: [user.kickidlerEmployeeId],
      from: period.from,
      to: period.to,
    });
    const item = summary.employees[0] || null;
    return {
      source: summary.source,
      configured: summary.configured,
      activeSeconds: readMetriconSeconds(item, "active"),
      idleSeconds: readMetriconSeconds(item, "idle"),
      raw: item,
      error: null,
    };
  } catch (error) {
    return {
      source: "metricon",
      configured: true,
      activeSeconds: null,
      idleSeconds: null,
      raw: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function calculateDailyMetrics({ user, date, plan, bitrix, bitrixUserTasks, metricon, blockers }) {
  const planItems = plan?.items || [];
  // Project boards contain tasks of every member. Personal daily metrics
  // must only count tasks assigned to this user; other members' tasks
  // would skew completed/overdue counts (reported bug: Maksat's task was
  // attributed to Begayym).
  const projectBitrixTasks = bitrix
    .flatMap((project) => project.tasks)
    .filter((task) => taskBelongsToUser(task, user));
  const assignedBitrixTasks = bitrixUserTasks?.tasks || [];
  const bitrixTasks = dedupeTasks([...projectBitrixTasks, ...assignedBitrixTasks]);
  const completedPlanTasks = planItems.filter((item) => item.status === "done").length;
  const completedBitrixTasks = bitrixTasks.filter((task) => task.statusLabel === "completed").length;
  const plannedTasks = planItems.length || bitrixTasks.length;
  const completedTasks = planItems.length ? completedPlanTasks : completedBitrixTasks;
  const overdueTasks = bitrixTasks.filter((task) => task.overdue).length;
  const activeSeconds = metricon.activeSeconds;
  const notes = [];

  if (!planItems.length) {
    notes.push("план дня не создан");
  }
  if (metricon.error) {
    notes.push("Metricon недоступен");
  }
  if (bitrix.some((project) => project.error)) {
    notes.push("Bitrix частично недоступен");
  }

  if (bitrixUserTasks?.error) {
    notes.push("Bitrix tasks by user are unavailable");
  }
  if (bitrixUserTasks?.note) {
    notes.push(bitrixUserTasks.note);
  }

  const taskCompletionScore = plannedTasks ? completedTasks / plannedTasks : null;
  const deadlineScore = bitrixTasks.length ? Math.max(0, 1 - overdueTasks / Math.max(1, bitrixTasks.length)) : null;
  const focusScore = Number.isFinite(activeSeconds) ? Math.min(1, activeSeconds / (6 * 60 * 60)) : null;
  const communicationScore = planItems.length ? 1 : blockers.length ? 0.7 : 0.4;
  const weighted = weightedAverage([
    [taskCompletionScore, 0.55],
    [deadlineScore, 0.2],
    [focusScore, 0.15],
    [communicationScore, 0.1],
  ]);

  const availableSignals = [
    planItems.length > 0,
    bitrixTasks.length > 0,
    Number.isFinite(activeSeconds),
    blockers.length > 0,
  ].filter(Boolean).length;

  return {
    userId: user.id,
    date,
    plannedTasks,
    completedTasks,
    inProgressTasks: bitrixTasks.filter((task) => task.statusLabel !== "completed").length,
    overdueTasks,
    bitrixTasks: bitrixTasks.length,
    projectBitrixTasks: projectBitrixTasks.length,
    assignedBitrixTasks: assignedBitrixTasks.length,
    activeSeconds: Number.isFinite(activeSeconds) ? activeSeconds : null,
    idleSeconds: Number.isFinite(metricon.idleSeconds) ? metricon.idleSeconds : null,
    meetingSeconds: null,
    focusScore,
    taskCompletionScore,
    deadlineScore,
    communicationScore,
    overallEfficiencyScore: weighted,
    confidence: availableSignals >= 3 ? "high" : availableSignals >= 2 ? "medium" : "low",
    notes,
    updatedAt: new Date().toISOString(),
  };
}

function taskBelongsToUser(task, user) {
  const platrumId = user?.platrumUserId !== null && user?.platrumUserId !== undefined ? String(user.platrumUserId) : null;
  const platrumName = user?.platrumUsername ? String(user.platrumUsername).toLowerCase() : null;
  const bitrixId = user?.bitrixUserId !== null && user?.bitrixUserId !== undefined ? String(user.bitrixUserId) : null;
  const assigneeId = task?.assigneeId !== null && task?.assigneeId !== undefined ? String(task.assigneeId) : null;
  const assigneeName = task?.assigneeUsername ? String(task.assigneeUsername).toLowerCase() : null;
  const responsibleId = task?.responsibleId !== null && task?.responsibleId !== undefined ? String(task.responsibleId) : null;
  return Boolean(
    (platrumId && assigneeId && assigneeId === platrumId) ||
    (platrumName && assigneeName && assigneeName === platrumName) ||
    (bitrixId && responsibleId && responsibleId === bitrixId),
  );
}

function dedupeTasks(tasks) {
  const seen = new Map();
  for (const task of tasks) {
    const key = task.id ? `id:${task.id}` : `task:${task.title}|${task.deadline || ""}`;
    if (!seen.has(key)) {
      seen.set(key, task);
    }
  }
  return [...seen.values()];
}

function upsertDailyMetrics(state, metrics) {
  const index = state.workMetricsDaily.findIndex((item) => item.userId === metrics.userId && item.date === metrics.date);
  if (index === -1) {
    state.workMetricsDaily.push(metrics);
  } else {
    state.workMetricsDaily[index] = { ...state.workMetricsDaily[index], ...metrics };
  }
}

function listDailyBlockers(state, userId, date) {
  return (state.assistantCheckins || []).filter(
    (checkin) => checkin.userId === userId && checkin.date === date && checkin.type === "blocker",
  );
}

function resolveReportUsers(state, actor, targetUserId) {
  if (targetUserId) {
    assertCanAccessUser(state, actor, targetUserId);
    return [getUserById(state, targetUserId)];
  }

  if (actor.role === Roles.PM) {
    return [actor];
  }

  return listAccessibleUserIds(state, actor).map((userId) => getUserById(state, userId));
}

function summarizeManagerReport(reports) {
  const plannedTasks = reports.reduce((sum, report) => sum + report.metrics.plannedTasks, 0);
  const completedTasks = reports.reduce((sum, report) => sum + report.metrics.completedTasks, 0);
  const overdueTasks = reports.reduce((sum, report) => sum + report.metrics.overdueTasks, 0);
  const scores = reports
    .map((report) => report.metrics.overallEfficiencyScore)
    .filter((score) => Number.isFinite(score));
  return {
    plannedTasks,
    completedTasks,
    overdueTasks,
    averageEfficiency: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
  };
}

function buildRisks(report) {
  const risks = [];
  if (!report.plan) {
    risks.push({
      userId: report.user.id,
      userDisplayName: report.user.displayName,
      severity: "warning",
      message: "план дня не создан",
    });
  }
  if (report.metrics.overdueTasks > 0) {
    risks.push({
      userId: report.user.id,
      userDisplayName: report.user.displayName,
      severity: "critical",
      message: `просрочено задач: ${report.metrics.overdueTasks}`,
    });
  }
  for (const blocker of report.blockers) {
    risks.push({
      userId: report.user.id,
      userDisplayName: report.user.displayName,
      severity: "warning",
      message: `блокер: ${blocker.message}`,
    });
  }
  if (report.metricon.error) {
    risks.push({
      userId: report.user.id,
      userDisplayName: report.user.displayName,
      severity: "info",
      message: "Metricon не отдал данные",
    });
  }
  return risks;
}

function recordOutboundCheckin(state, { userId, date, type, message, now }) {
  state.assistantCheckins.push({
    id: `checkin-${date}-${userId}-${type}`,
    userId,
    date,
    type,
    direction: "outbound",
    message,
    answer: null,
    createdAt: now.toISOString(),
    createdByUserId: "system",
  });
}

function hasOutboundCheckin(state, userId, date, type) {
  return state.assistantCheckins.some(
    (checkin) => checkin.userId === userId && checkin.date === date && checkin.type === type,
  );
}

function formatPlanItems(plan) {
  return plan.items
    .map((item, index) => `${index + 1}. ${item.status === "done" ? "[x]" : "[ ]"} ${escapeHtml(item.title)}`)
    .join("\n");
}

function isTaskOverdue(task, now = new Date()) {
  if (!task.deadline || task.statusLabel === "completed") {
    return false;
  }
  const deadline = new Date(task.deadline).getTime();
  return Number.isFinite(deadline) && deadline < now.getTime();
}

function readMetriconSeconds(item, kind) {
  const raw = item?.raw?.data || item?.raw || item || {};
  const keys =
    kind === "active"
      ? ["activeSeconds", "totalActiveTime", "activeTime", "activitySeconds"]
      : ["idleSeconds", "totalIdleTime", "idleTime"];
  for (const key of keys) {
    const value = Number(raw[key] ?? item?.[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function weightedAverage(items) {
  let weightSum = 0;
  let valueSum = 0;
  for (const [value, weight] of items) {
    if (Number.isFinite(value)) {
      valueSum += value * weight;
      weightSum += weight;
    }
  }
  return weightSum ? valueSum / weightSum : null;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "n/a";
}

function formatSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return "n/a";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours && minutes) {
    return `${hours} ч ${minutes} мин`;
  }
  if (hours) {
    return `${hours} ч`;
  }
  return `${minutes} мин`;
}

function formatConfidence(value) {
  switch (value) {
    case "high":
      return "высокая уверенность";
    case "medium":
      return "средняя уверенность";
    case "low":
      return "низкая уверенность";
    default:
      return value || "n/a";
  }
}

function title(value) {
  return `<b>${escapeHtml(value)}</b>`;
}

function subtitle(value) {
  return `<b>${escapeHtml(value)}</b>`;
}

function kv(label, value) {
  return `<b>${escapeHtml(label)}:</b> ${escapeHtml(value ?? "n/a")}`;
}

function codeLine(value) {
  return `<code>${escapeHtml(value)}</code>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
}
