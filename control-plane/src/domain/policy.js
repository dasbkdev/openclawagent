import { forbidden, notFound } from "./errors.js";
import { Roles } from "./roles.js";

export function getUserById(state, userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) {
    throw notFound(`User not found: ${userId}`);
  }
  return user;
}

export function getProjectById(state, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) {
    throw notFound(`Project not found: ${projectId}`);
  }
  return project;
}

export function getRecursiveSubordinateIds(state, managerId) {
  const direct = state.users.filter((user) => user.managerId === managerId).map((user) => user.id);
  const nested = direct.flatMap((userId) => getRecursiveSubordinateIds(state, userId));
  return [...new Set([...direct, ...nested])];
}

export function listAccessibleUserIds(state, actor) {
  if (actor.role === Roles.OWNER) {
    return state.users.map((user) => user.id);
  }

  if (actor.role === Roles.SENIOR_PM) {
    return [actor.id, ...getRecursiveSubordinateIds(state, actor.id)];
  }

  return [actor.id];
}

export function canAccessUser(state, actor, targetUserId) {
  return listAccessibleUserIds(state, actor).includes(targetUserId);
}

export function assertCanAccessUser(state, actor, targetUserId) {
  if (!canAccessUser(state, actor, targetUserId)) {
    throw forbidden("Actor cannot access requested user", {
      actorUserId: actor.id,
      targetUserId,
    });
  }
}

export function canAccessProject(state, actor, project) {
  if (actor.role === Roles.OWNER) {
    return true;
  }

  const accessibleUserIds = new Set(listAccessibleUserIds(state, actor));
  if (actor.role === Roles.SENIOR_PM) {
    return project.managerUserId === actor.id || project.memberUserIds.some((id) => accessibleUserIds.has(id));
  }

  return project.ownerUserId === actor.id || project.memberUserIds.includes(actor.id);
}

export function assertCanAccessProject(state, actor, projectId) {
  const project = getProjectById(state, projectId);
  if (!canAccessProject(state, actor, project)) {
    throw forbidden("Actor cannot access requested project", {
      actorUserId: actor.id,
      projectId,
    });
  }
  return project;
}

export function assertCanIssueInvite(actor) {
  if (actor.role !== Roles.OWNER) {
    throw forbidden("Only OWNER can issue invite codes");
  }
}

export function publicUser(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    role: user.role,
    managerId: user.managerId,
    employeeId: user.employeeId,
    kickidlerEmployeeId: user.kickidlerEmployeeId,
    bitrixUserId: user.bitrixUserId ?? null,
    platrumUserId: user.platrumUserId ?? null,
    platrumUsername: user.platrumUsername ?? null,
    telegramLinked: Boolean(user.telegram?.telegramUserId),
  };
}

export function publicProject(project) {
  return {
    id: project.id,
    name: project.name,
    bitrixGroupId: project.bitrixGroupId ?? null,
    platrumProjectId: project.platrumProjectId ?? null,
    ownerUserId: project.ownerUserId,
    managerUserId: project.managerUserId,
    memberUserIds: project.memberUserIds,
  };
}
