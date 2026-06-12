import { appendAuditEvent } from "../infra/audit.js";
import { validation } from "./errors.js";
import {
  assertCanAccessProject,
  assertCanAccessUser,
  getUserById,
  publicProject,
  publicUser,
} from "./policy.js";

export async function buildPlatrumProjectStatusReport(state, { actor, request, platrumClient }) {
  const projectId = requireString(request.projectId, "projectId");
  const project = assertCanAccessProject(state, actor, projectId);
  const limit = normalizeLimit(request.limit);
  const [tasksResult, reportResult] = await Promise.all([
    platrumClient.getProjectTasks({ project, limit }),
    platrumClient.getProjectReport({ project }),
  ]);
  const tasks = tasksResult.tasks.map(normalizeTaskForReport);

  const snapshot = upsertPlatrumProjectSnapshot(state, {
    actor,
    project,
    tasks,
    projectReport: reportResult.report,
    source: tasksResult.source,
    configured: tasksResult.configured,
  });

  appendAuditEvent(state, {
    actorUserId: actor.id,
    actorTelegramUserId: actor.telegram?.telegramUserId,
    action: "platrum.project_status.read",
    target: {
      projectId: project.id,
      platrumProjectId: tasksResult.platrumProjectId ?? project.platrumProjectId ?? null,
    },
    metadata: {
      source: tasksResult.source,
      configured: tasksResult.configured,
      tasks: tasks.length,
      readOnly: true,
    },
  });

  return {
    source: tasksResult.source,
    configured: tasksResult.configured,
    readOnly: true,
    requestedBy: publicUser(actor),
    project: publicProject(project),
    platrumProjectId: tasksResult.platrumProjectId ?? project.platrumProjectId ?? null,
    summary: summarizePlatrumTasks(tasks),
    projectReport: reportResult.report,
    tasks,
    snapshot,
    note: tasksResult.note ?? reportResult.note ?? null,
  };
}

export async function buildPlatrumUserStatusReport(state, { actor, request, platrumClient }) {
  const targetUserId = requireString(request.userId, "userId");
  assertCanAccessUser(state, actor, targetUserId);
  const targetUser = getUserById(state, targetUserId);
  const limit = normalizeLimit(request.limit);
  const period = request.from || request.to
    ? { from: request.from || null, to: request.to || null }
    : null;
  const projects = state.projects.filter((project) =>
    project.managerUserId === targetUser.id ||
    project.ownerUserId === targetUser.id ||
    project.memberUserIds.includes(targetUser.id) ||
    targetUser.projectIds?.includes(project.id)
  );

  const [userTasksResult, projectResults, dailyReportsResult, metricsResult] = await Promise.all([
    platrumClient.getUserTasks({ user: targetUser, limit, period }),
    Promise.all(projects.map(async (project) => {
      try {
        const result = await platrumClient.getProjectTasks({ project, limit });
        const tasks = result.tasks.map(normalizeTaskForReport);
        return {
          ok: true,
          source: result.source,
          configured: result.configured,
          project: publicProject(project),
          platrumProjectId: result.platrumProjectId ?? project.platrumProjectId ?? null,
          summary: summarizePlatrumTasks(tasks),
          tasks,
          note: result.note ?? null,
        };
      } catch (error) {
        return {
          ok: false,
          project: publicProject(project),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })),
    platrumClient.getDailyReports({ limit: 100 }),
    platrumClient.getTeamMetrics(),
  ]);

  // Persist a mapping discovered by name search so the next request
  // does not need to resolve again (runs inside store.update).
  if (!targetUser.platrumUserId && userTasksResult.platrumUserId) {
    targetUser.platrumUserId = userTasksResult.platrumUserId;
    targetUser.platrumUsername = targetUser.platrumUsername ?? userTasksResult.platrumUsername ?? null;
  }

  const userTasks = userTasksResult.tasks.map(normalizeTaskForReport);
  const allProjectTasks = projectResults.flatMap((result) => result.ok ? result.tasks : []);
  // Personal stats must only count tasks assigned to the target user.
  // Project boards contain tasks of every member; mixing them in skews
  // the employee KPI with other people's tasks.
  const assigneeIdentity = {
    platrumUserId: userTasksResult.platrumUserId ?? targetUser.platrumUserId ?? null,
    platrumUsername: userTasksResult.platrumUsername ?? targetUser.platrumUsername ?? null,
  };
  const assignedProjectTasks = allProjectTasks.filter((task) => taskAssignedToUser(task, assigneeIdentity));
  const combinedTasks = dedupeTasks([...userTasks, ...assignedProjectTasks]);
  const dailyReports = filterDailyReportsForUser(dailyReportsResult.reports, userTasksResult, targetUser);
  const analytics = buildEmployeeKpi({
    user: targetUser,
    tasks: combinedTasks,
    dailyReports,
    metrics: metricsResult.metrics,
  });
  const snapshot = upsertPlatrumEmployeeSnapshot(state, {
    user: targetUser,
    analytics,
    tasks: combinedTasks,
    dailyReports,
    source: userTasksResult.source,
    configured: userTasksResult.configured,
  });

  appendAuditEvent(state, {
    actorUserId: actor.id,
    actorTelegramUserId: actor.telegram?.telegramUserId,
    action: "platrum.user_status.read",
    target: {
      userId: targetUser.id,
      platrumUserId: userTasksResult.platrumUserId ?? targetUser.platrumUserId ?? null,
      projectIds: projects.map((project) => project.id),
    },
    metadata: {
      source: userTasksResult.source,
      configured: userTasksResult.configured,
      userTasks: userTasks.length,
      projectTasks: allProjectTasks.length,
      assignedProjectTasks: assignedProjectTasks.length,
      combinedTasks: combinedTasks.length,
      readOnly: true,
      efficiencyPercent: analytics.efficiencyPercent,
    },
  });

  return {
    source: userTasksResult.source,
    configured: userTasksResult.configured,
    readOnly: true,
    requestedBy: publicUser(actor),
    user: publicUser(targetUser),
    platrumUserId: userTasksResult.platrumUserId ?? targetUser.platrumUserId ?? null,
    projects: projectResults,
    userTasks: {
      platrumUserId: userTasksResult.platrumUserId ?? targetUser.platrumUserId ?? null,
      platrumUsername: userTasksResult.platrumUsername ?? targetUser.platrumUsername ?? null,
      note: userTasksResult.note || null,
      summary: summarizePlatrumTasks(userTasks),
      tasks: userTasks,
    },
    dailyReports,
    teamMetrics: metricsResult.metrics,
    combined: {
      summary: summarizePlatrumTasks(combinedTasks),
      tasks: combinedTasks.slice(0, limit),
    },
    analytics,
    snapshot,
  };
}

export function taskAssignedToUser(task, { platrumUserId, platrumUsername } = {}) {
  const idMatch =
    platrumUserId !== null &&
    platrumUserId !== undefined &&
    task.assigneeId !== null &&
    task.assigneeId !== undefined &&
    String(task.assigneeId) === String(platrumUserId);
  const usernameMatch =
    Boolean(platrumUsername) &&
    Boolean(task.assigneeUsername) &&
    String(task.assigneeUsername).toLowerCase() === String(platrumUsername).toLowerCase();
  return idMatch || usernameMatch;
}

export function summarizePlatrumTasks(tasks) {
  const statusCounts = {};
  for (const task of tasks) {
    statusCounts[task.statusLabel] = (statusCounts[task.statusLabel] ?? 0) + 1;
  }
  const total = tasks.length;
  const overdue = tasks.filter((task) => task.overdue).length;
  const completed = tasks.filter((task) => task.statusLabel === "completed").length;
  const review = tasks.filter((task) => task.statusLabel === "review").length;
  const open = tasks.filter((task) => task.statusLabel !== "completed").length;
  const inProgress = tasks.filter((task) => task.statusLabel === "in_progress").length;
  const newTasks = tasks.filter((task) => task.statusLabel === "new").length;
  const weightedScore = completed + review * 0.5 + inProgress * 0.25;
  const efficiencyPercent = total
    ? Math.max(0, Math.min(100, Math.round(((weightedScore / total) * 100) - ((overdue / total) * 25))))
    : null;

  return {
    total,
    new: newTasks,
    inProgress,
    review,
    overdue,
    open,
    completed,
    completionPercent: percent(completed, total),
    overduePercent: percent(overdue, total),
    efficiencyPercent,
    statusCounts,
  };
}

export function buildEmployeeKpi({ user, tasks, dailyReports = [], metrics = null, date = null }) {
  const taskSummary = summarizePlatrumTasks(tasks);
  const reportsSubmitted = dailyReports.length;
  const lateReports = dailyReports.filter((report) => report.isLate).length;
  const reportScore = reportsSubmitted ? Math.max(0, Math.min(1, (reportsSubmitted - lateReports * 0.5) / reportsSubmitted)) : null;
  const taskScore = taskSummary.efficiencyPercent === null ? null : taskSummary.efficiencyPercent / 100;
  const companyAttendance = normalizePercent(metrics?.attendance_percent_month);
  const attendanceScore = companyAttendance === null ? null : companyAttendance / 100;
  const weighted = weightedAverage([
    [taskScore, 0.75],
    [reportScore, 0.15],
    [attendanceScore, 0.1],
  ]);
  const availableSignals = [taskScore, reportScore, attendanceScore].filter((value) => value !== null).length;

  return {
    userId: user.id,
    platrumUserId: user.platrumUserId ?? null,
    date,
    taskSummary,
    reportsSubmitted,
    lateReports,
    reportScore,
    attendanceScore,
    efficiencyPercent: weighted === null ? taskSummary.efficiencyPercent : Math.round(weighted * 100),
    confidence: availableSignals >= 3 ? "high" : availableSignals >= 2 ? "medium" : "low",
    source: "platrum",
    calculatedAt: new Date().toISOString(),
  };
}

export function ensurePlatrumAnalyticsState(state) {
  state.platrumSnapshots ??= [];
  state.employeeKpiDaily ??= [];
  state.projectKpiDaily ??= [];
  state.assistantInsights ??= [];
  return state;
}

function upsertPlatrumEmployeeSnapshot(state, { user, analytics, tasks, dailyReports, source, configured }) {
  ensurePlatrumAnalyticsState(state);
  const date = analytics.date || localDateKey();
  const snapshot = {
    id: `platrum-employee-${user.id}-${date}`,
    kind: "employee",
    userId: user.id,
    platrumUserId: analytics.platrumUserId,
    date,
    source,
    configured,
    taskSummary: analytics.taskSummary,
    reportsSubmitted: analytics.reportsSubmitted,
    lateReports: analytics.lateReports,
    efficiencyPercent: analytics.efficiencyPercent,
    confidence: analytics.confidence,
    taskIds: tasks.map((task) => task.id).filter(Boolean).slice(0, 200),
    dailyReportIds: dailyReports.map((report) => report.id).filter(Boolean).slice(0, 100),
    updatedAt: new Date().toISOString(),
  };
  upsertById(state.platrumSnapshots, snapshot);
  upsertById(state.employeeKpiDaily, snapshot);
  return snapshot;
}

function upsertPlatrumProjectSnapshot(state, { actor, project, tasks, projectReport, source, configured }) {
  ensurePlatrumAnalyticsState(state);
  const date = localDateKey();
  const taskSummary = summarizePlatrumTasks(tasks);
  const snapshot = {
    id: `platrum-project-${project.id}-${date}`,
    kind: "project",
    projectId: project.id,
    platrumProjectId: project.platrumProjectId ?? projectReport?.projectId ?? null,
    date,
    source,
    configured,
    requestedByUserId: actor.id,
    taskSummary,
    projectReport,
    efficiencyPercent: taskSummary.efficiencyPercent,
    taskIds: tasks.map((task) => task.id).filter(Boolean).slice(0, 200),
    updatedAt: new Date().toISOString(),
  };
  upsertById(state.platrumSnapshots, snapshot);
  upsertById(state.projectKpiDaily, snapshot);
  return snapshot;
}

function normalizeTaskForReport(task) {
  return {
    ...task,
    overdue: Boolean(task.overdue ?? task.isOverdue),
    statusLabel: task.statusLabel || task.status || "unknown",
    deadline: task.deadline || task.dueDate || null,
  };
}

function filterDailyReportsForUser(reports, userTasksResult, user) {
  const platrumUserId = String(userTasksResult.platrumUserId ?? user.platrumUserId ?? "");
  const platrumUsername = String(userTasksResult.platrumUsername ?? user.platrumUsername ?? "").toLowerCase();
  return reports.filter((report) => {
    if (platrumUserId && String(report.userId) === platrumUserId) {
      return true;
    }
    if (platrumUsername && String(report.username || "").toLowerCase() === platrumUsername) {
      return true;
    }
    return false;
  });
}

function upsertById(list, value) {
  const index = list.findIndex((item) => item.id === value.id);
  if (index === -1) {
    list.push(value);
  } else {
    list[index] = { ...list[index], ...value };
  }
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

function weightedAverage(items) {
  const valid = items.filter(([score]) => Number.isFinite(score));
  const weight = valid.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  if (!valid.length || !weight) {
    return null;
  }
  return valid.reduce((sum, [score, itemWeight]) => sum + score * itemWeight, 0) / weight;
}

function normalizePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(100, numeric));
}

function percent(value, total) {
  return total ? Math.round((value / total) * 100) : null;
}

function localDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function normalizeLimit(value) {
  if (value === undefined || value === null) {
    return 50;
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 100) {
    throw validation("limit must be an integer between 1 and 100");
  }
  return normalized;
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw validation(`${field} is required`);
  }
  return value.trim();
}
