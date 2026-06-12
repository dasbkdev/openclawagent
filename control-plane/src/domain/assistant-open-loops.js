const VALID_KINDS = new Set([
  "command_follow_up",
  "promise",
  "question",
  "task_progress",
  "other",
]);
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_MAX_AGE_DAYS = 14;

export function ensureAssistantOpenLoopsState(state) {
  state.assistantOpenLoops ??= [];
  return state.assistantOpenLoops;
}

export function openAssistantLoop(
  state,
  {
    userId,
    kind = "other",
    text,
    source = null,
    metadata = {},
    now = new Date(),
  },
) {
  ensureAssistantOpenLoopsState(state);
  const normalizedText = normalizeLoopText(text);
  if (!normalizedText) {
    return null;
  }
  const loop = {
    id: `loop-${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`,
    userId: userId || null,
    kind: VALID_KINDS.has(kind) ? kind : "other",
    text: normalizedText,
    status: "open",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    resolvedAt: null,
    resolution: null,
    source: normalizeSource(source),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };
  state.assistantOpenLoops.push(loop);
  return loop;
}

export function resolveAssistantLoop(
  state,
  { id, userId = null, resolution = null, status = "resolved", now = new Date() },
) {
  ensureAssistantOpenLoopsState(state);
  const loop = state.assistantOpenLoops.find((item) => item.id === id);
  if (!loop || loop.status !== "open") {
    return null;
  }
  if (userId && loop.userId && loop.userId !== userId) {
    return null;
  }
  loop.status = status === "expired" ? "expired" : "resolved";
  loop.resolvedAt = now.toISOString();
  loop.updatedAt = loop.resolvedAt;
  loop.resolution = resolution ? normalizeLoopText(resolution) : null;
  return loop;
}

export function listOpenAssistantLoops(state, { userIds = [], limit = DEFAULT_LIST_LIMIT } = {}) {
  ensureAssistantOpenLoopsState(state);
  const filterIds = new Set(userIds.filter(Boolean));
  return state.assistantOpenLoops
    .filter((loop) => loop.status === "open")
    .filter((loop) => filterIds.size === 0 || filterIds.has(loop.userId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, clampLimit(limit))
    .map((loop) => ({
      id: loop.id,
      userId: loop.userId,
      kind: loop.kind,
      text: loop.text,
      status: loop.status,
      createdAt: loop.createdAt,
      updatedAt: loop.updatedAt,
      source: loop.source,
      metadata: loop.metadata,
    }));
}

export function expireStaleAssistantLoops(state, { now = new Date(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  ensureAssistantOpenLoopsState(state);
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  let expired = 0;
  for (const loop of state.assistantOpenLoops) {
    if (loop.status !== "open") {
      continue;
    }
    const createdAt = new Date(loop.createdAt || 0).getTime();
    if (Number.isFinite(createdAt) && createdAt < cutoff) {
      loop.status = "expired";
      loop.resolvedAt = now.toISOString();
      loop.updatedAt = loop.resolvedAt;
      expired += 1;
    }
  }
  return expired;
}

export function findOpenLoopBySource(state, { userId, type, id }) {
  ensureAssistantOpenLoopsState(state);
  return state.assistantOpenLoops.find(
    (loop) =>
      loop.status === "open" &&
      loop.userId === userId &&
      loop.source?.type === type &&
      loop.source?.id === id,
  ) || null;
}

function normalizeSource(source) {
  if (!source || typeof source !== "object") {
    return { type: null, id: null };
  }
  return {
    type: source.type ? String(source.type) : null,
    id: source.id ? String(source.id) : null,
  };
}

function normalizeLoopText(text) {
  return String(text || "").trim().slice(0, 1000);
}

function clampLimit(limit) {
  return Math.min(Math.max(Number(limit || DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
}
