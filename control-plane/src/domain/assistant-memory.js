const MAX_MEMORY_EVENTS = 10000;
const DEFAULT_CONTEXT_LIMIT = 24;

export function ensureAssistantMemoryState(state) {
  state.assistantMemory ??= [];
  return state.assistantMemory;
}

export function recordAssistantMemoryEvent(
  state,
  {
    userId,
    channel,
    role,
    text,
    kind = "message",
    target = null,
    metadata = {},
    now = new Date(),
  },
) {
  ensureAssistantMemoryState(state);
  const event = {
    id: `memory-${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`,
    userId: userId || null,
    channel: channel || "unknown",
    role: role || "system",
    kind,
    text: normalizeMemoryText(text),
    target,
    metadata,
    createdAt: now.toISOString(),
  };
  state.assistantMemory.push(event);
  pruneAssistantMemory(state);
  return event;
}

export function buildAssistantMemoryContext(
  state,
  {
    actor,
    targetUsers = [],
    limit = DEFAULT_CONTEXT_LIMIT,
  },
) {
  const memory = ensureAssistantMemoryState(state);
  const relevantUserIds = new Set([
    actor?.id,
    ...targetUsers.map((user) => user.id),
  ].filter(Boolean));

  return memory
    .filter((event) => relevantUserIds.has(event.userId) || relevantTargetMatches(event, relevantUserIds))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Math.min(Math.max(Number(limit || DEFAULT_CONTEXT_LIMIT), 1), 80))
    .reverse()
    .map((event) => ({
      createdAt: event.createdAt,
      userId: event.userId,
      channel: event.channel,
      role: event.role,
      kind: event.kind,
      text: event.text,
      target: event.target,
      metadata: event.metadata,
    }));
}

export function buildRecentDeviceCommandMemory(state, { actor, targetUsers = [], limit = 12 }) {
  const relevantUserIds = new Set([
    actor?.id,
    ...targetUsers.map((user) => user.id),
  ].filter(Boolean));
  return (state.deviceCommands || [])
    .filter((command) => relevantUserIds.has(command.actorUserId) || relevantUserIds.has(command.userId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Math.min(Math.max(Number(limit || 12), 1), 50))
    .reverse()
    .map((command) => ({
      id: command.id,
      actorUserId: command.actorUserId,
      userId: command.userId,
      deviceId: command.deviceId,
      type: command.type,
      args: command.args || {},
      status: command.status,
      createdAt: command.createdAt,
      claimedAt: command.claimedAt,
      completedAt: command.completedAt,
      error: command.error || null,
    }));
}

function relevantTargetMatches(event, userIds) {
  const target = event.target || {};
  if (target.userId && userIds.has(target.userId)) {
    return true;
  }
  if (Array.isArray(target.userIds) && target.userIds.some((userId) => userIds.has(userId))) {
    return true;
  }
  return false;
}

function pruneAssistantMemory(state) {
  if (state.assistantMemory.length <= MAX_MEMORY_EVENTS) {
    return;
  }
  state.assistantMemory = state.assistantMemory
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, MAX_MEMORY_EVENTS)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function normalizeMemoryText(text) {
  return String(text || "").trim().slice(0, 4000);
}
