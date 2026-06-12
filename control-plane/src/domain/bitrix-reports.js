import { appendAuditEvent } from "../infra/audit.js";
import { validation } from "./errors.js";
import { assertCanAccessProject, assertCanAccessUser, getUserById, publicProject, publicUser } from "./policy.js";

export async function buildBitrixProjectStatusReport(state, { actor, request, bitrixClient }) {
  const projectId = requireString(request.projectId, "projectId");
  const project = assertCanAccessProject(state, actor, projectId);
  const limit = normalizeLimit(request.limit);
  const result = await bitrixClient.getProjectTasks({ project, limit });
  const tasks = result.tasks.map((task) => ({
    ...task,
    overdue: isTaskOverdue(task),
  }));

  appendAuditEvent(state, {
    actorUserId: actor.id,
    actorTelegramUserId: actor.telegram?.telegramUserId,
    action: "bitrix.project_status.read",
    target: {
      projectId: project.id,
    },
    metadata: {
      source: result.source,
      configured: result.configured,
      tasks: tasks.length,
    },
  });

  return {
    source: result.source,
    configured: result.configured,
    requestedBy: publicUser(actor),
    project: publicProject(project),
    summary: summarizeTasks(tasks),
    tasks,
  };
}

export async function buildBitrixUserStatusReport(state, { actor, request, bitrixClient }) {
  const targetUserId = requireString(request.userId, "userId");
  assertCanAccessUser(state, actor, targetUserId);
  const targetUser = getUserById(state, targetUserId);
  const limit = normalizeLimit(request.limit);
  const projects = state.projects.filter((project) =>
    project.managerUserId === targetUser.id ||
    project.ownerUserId === targetUser.id ||
    project.memberUserIds.includes(targetUser.id) ||
    targetUser.projectIds?.includes(project.id),
  );

  const [userTasksResult, projectResults] = await Promise.all([
    bitrixClient.getUserTasks({ user: targetUser, limit, includeClosed: true }),
    Promise.all(projects.map(async (project) => {
      try {
        const result = await bitrixClient.getProjectTasks({ project, limit });
        const tasks = result.tasks.map((task) => ({ ...task, overdue: isTaskOverdue(task) }));
        return {
          ok: true,
          source: result.source,
          configured: result.configured,
          project: publicProject(project),
          summary: summarizeTasks(tasks),
          tasks,
        };
      } catch (error) {
        return {
          ok: false,
          project: publicProject(project),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })),
  ]);

  const userTasks = userTasksResult.tasks.map((task) => ({ ...task, overdue: isTaskOverdue(task) }));
  const allProjectTasks = projectResults.flatMap((result) => result.ok ? result.tasks : []);
  const combinedTasks = dedupeTasks([...userTasks, ...allProjectTasks]);

  appendAuditEvent(state, {
    actorUserId: actor.id,
    actorTelegramUserId: actor.telegram?.telegramUserId,
    action: "bitrix.user_status.read",
    target: {
      userId: targetUser.id,
      projectIds: projects.map((project) => project.id),
    },
    metadata: {
      source: userTasksResult.source,
      configured: userTasksResult.configured,
      userTasks: userTasks.length,
      projectTasks: allProjectTasks.length,
      combinedTasks: combinedTasks.length,
    },
  });

  return {
    source: userTasksResult.source,
    configured: userTasksResult.configured,
    requestedBy: publicUser(actor),
    user: publicUser(targetUser),
    projects: projectResults,
    userTasks: {
      bitrixUserId: userTasksResult.bitrixUserId ?? null,
      note: userTasksResult.note || null,
      summary: summarizeTasks(userTasks),
      tasks: userTasks,
    },
    combined: {
      summary: summarizeTasks(combinedTasks),
      tasks: combinedTasks.slice(0, limit),
    },
  };
}

export function summarizeTasks(tasks) {
  const statusCounts = {};
  for (const task of tasks) {
    statusCounts[task.statusLabel] = (statusCounts[task.statusLabel] ?? 0) + 1;
  }
  const total = tasks.length;
  const overdue = tasks.filter((task) => task.overdue).length;
  const completed = tasks.filter((task) => task.statusLabel === "completed").length;
  const open = tasks.filter((task) => task.statusLabel !== "completed").length;
  const openNotOverdue = tasks.filter((task) =>
    task.statusLabel !== "completed" && !task.overdue
  ).length;
  const weightedScore = completed + openNotOverdue * 0.6;

  return {
    total,
    overdue,
    open,
    completed,
    openNotOverdue,
    completionPercent: percent(completed, total),
    overduePercent: percent(overdue, total),
    efficiencyPercent: total ? Math.max(0, Math.min(100, Math.round((weightedScore / total) * 100))) : null,
    statusCounts,
  };
}

function percent(value, total) {
  return total ? Math.round((value / total) * 100) : null;
}

function isTaskOverdue(task) {
  if (!task.deadline || task.statusLabel === "completed") {
    return false;
  }
  const deadline = new Date(task.deadline).getTime();
  return Number.isFinite(deadline) && deadline < Date.now();
}

function dedupeTasks(tasks) {
  const seen = new Set();
  const result = [];
  for (const task of tasks) {
    const key = task.id || `${task.title}:${task.deadline}:${task.responsibleId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(task);
  }
  return result;
}

function normalizeLimit(value) {
  if (value === undefined || value === null) {
    return 20;
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
