import { appendAuditEvent } from "../infra/audit.js";
import { validation } from "./errors.js";
import { assertCanAccessProject, publicProject, publicUser } from "./policy.js";

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

export function summarizeTasks(tasks) {
  const statusCounts = {};
  for (const task of tasks) {
    statusCounts[task.statusLabel] = (statusCounts[task.statusLabel] ?? 0) + 1;
  }

  return {
    total: tasks.length,
    overdue: tasks.filter((task) => task.overdue).length,
    open: tasks.filter((task) => task.statusLabel !== "completed").length,
    completed: tasks.filter((task) => task.statusLabel === "completed").length,
    statusCounts,
  };
}

function isTaskOverdue(task) {
  if (!task.deadline || task.statusLabel === "completed") {
    return false;
  }
  const deadline = new Date(task.deadline).getTime();
  return Number.isFinite(deadline) && deadline < Date.now();
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
