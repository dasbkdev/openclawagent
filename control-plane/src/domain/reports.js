import { appendAuditEvent } from "../infra/audit.js";
import { validation } from "./errors.js";
import {
  assertCanAccessProject,
  assertCanAccessUser,
  getUserById,
  listAccessibleUserIds,
  publicUser,
} from "./policy.js";

export async function buildKickidlerActivitySummary(state, { actor, request, kickidlerClient }) {
  const from = requireString(request.from, "from");
  const to = requireString(request.to, "to");
  const targetUsers = resolveTargetUsers(state, actor, request);
  const usersWithKickidlerIds = targetUsers.filter((user) => user.kickidlerEmployeeId !== null);
  const employeeIds = usersWithKickidlerIds.map((user) => user.kickidlerEmployeeId);

  const summary = await kickidlerClient.getActivitySummary({ employeeIds, from, to });
  appendAuditEvent(state, {
    actorUserId: actor.id,
    actorTelegramUserId: actor.telegram?.telegramUserId,
    action: "metricon.activity_summary.read",
    target: {
      userIds: usersWithKickidlerIds.map((user) => user.id),
      projectId: request.projectId ?? null,
    },
    metadata: {
      from,
      to,
      source: summary.source,
      configured: summary.configured,
    },
  });

  return {
    from,
    to,
    source: summary.source,
    configured: summary.configured,
    requestedBy: publicUser(actor),
    employees: usersWithKickidlerIds.map((user) => {
      const metrics = summary.employees.find(
        (item) => String(item.kickidlerEmployeeId) === String(user.kickidlerEmployeeId),
      );
      return {
        user: publicUser(user),
        metrics: metrics ?? null,
      };
    }),
  };
}

function resolveTargetUsers(state, actor, request) {
  if (request.targetUserId && request.projectId) {
    throw validation("Provide either targetUserId or projectId, not both");
  }

  if (request.targetUserId) {
    assertCanAccessUser(state, actor, request.targetUserId);
    return [getUserById(state, request.targetUserId)];
  }

  if (request.projectId) {
    const project = assertCanAccessProject(state, actor, request.projectId);
    return project.memberUserIds.map((userId) => getUserById(state, userId));
  }

  return listAccessibleUserIds(state, actor).map((userId) => getUserById(state, userId));
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw validation(`${field} is required`);
  }
  return value.trim();
}
