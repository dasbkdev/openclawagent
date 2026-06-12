import { searchMemoryArchive } from "../infra/memory-archive.js";
import { listAssistantFacts } from "./assistant-facts.js";
import { listOpenAssistantLoops } from "./assistant-open-loops.js";
import { listAssistantDailySummaries } from "./assistant-summaries.js";

const MAX_MEMORY_EVENTS_PER_USER = 2000;
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
  const evicted = pruneAssistantMemory(state, event.userId);
  if (evicted.length) {
    state.assistantMemoryEvicted ??= [];
    state.assistantMemoryEvicted.push(...evicted);
  }
  return event;
}

/**
 * Drains events that were pruned out of the in-state journal so the caller can
 * forward them to the on-disk archive after the state is persisted. Returns the
 * drained events and clears the staging buffer.
 */
export function drainEvictedMemoryEvents(state) {
  const evicted = Array.isArray(state.assistantMemoryEvicted)
    ? state.assistantMemoryEvicted
    : [];
  state.assistantMemoryEvicted = [];
  return evicted;
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

export async function buildAssistantMemoryContextV2(
  state,
  {
    actor,
    targetUsers = [],
    question = "",
    dataFilePath = null,
    limits = {},
  } = {},
) {
  const memory = ensureAssistantMemoryState(state);
  const relevantUserIds = [actor?.id, ...targetUsers.map((user) => user.id)].filter(Boolean);
  const userIdSet = new Set(relevantUserIds);

  const recentLimit = clampInt(limits.recentEvents, 20, 1, 60);
  const relatedLimit = clampInt(limits.relatedEvents, 10, 1, 30);

  const relevantEvents = memory.filter(
    (event) => userIdSet.has(event.userId) || relevantTargetMatches(event, userIdSet),
  );

  const recentEvents = relevantEvents
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, recentLimit)
    .reverse()
    .map(toContextEvent);

  const recentIds = new Set(recentEvents.map((event) => event.id));
  const queryTerms = extractQueryTerms(question);

  let relatedEvents = [];
  if (queryTerms.length) {
    const scored = relevantEvents
      .filter((event) => !recentIds.has(event.id))
      .map((event) => ({ event, score: scoreEvent(event, queryTerms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || String(b.event.createdAt).localeCompare(String(a.event.createdAt)))
      .slice(0, relatedLimit)
      .map((item) => ({ ...toContextEvent(item.event), source: "journal" }));
    relatedEvents = scored;

    if (relatedEvents.length < relatedLimit && dataFilePath) {
      const remaining = relatedLimit - relatedEvents.length;
      const archivedAll = [];
      for (const userId of relevantUserIds) {
        const archived = await searchMemoryArchive({
          dataFilePath,
          userId,
          terms: queryTerms,
          limit: remaining,
        });
        archivedAll.push(...archived);
      }
      relatedEvents.push(
        ...archivedAll
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, remaining)
          .map((event) => ({ ...toContextEvent(event), source: "archive" })),
      );
    }
  }

  return {
    facts: listAssistantFacts(state, { userIds: relevantUserIds, limit: clampInt(limits.facts, 30, 1, 200) }),
    openLoops: listOpenAssistantLoops(state, {
      userIds: relevantUserIds,
      limit: clampInt(limits.openLoops, 20, 1, 100),
    }),
    dailySummaries: listAssistantDailySummaries(state, { userIds: relevantUserIds, limit: 3 }),
    recentEvents,
    relatedEvents,
  };
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

function pruneAssistantMemory(state, userId) {
  const userEvents = state.assistantMemory.filter((event) => event.userId === userId);
  if (userEvents.length <= MAX_MEMORY_EVENTS_PER_USER) {
    return [];
  }
  const sorted = userEvents
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const evicted = sorted.slice(0, userEvents.length - MAX_MEMORY_EVENTS_PER_USER);
  const evictedIds = new Set(evicted.map((event) => event.id));
  state.assistantMemory = state.assistantMemory.filter((event) => !evictedIds.has(event.id));
  return evicted;
}

function normalizeMemoryText(text) {
  return String(text || "").trim().slice(0, 4000);
}

function toContextEvent(event) {
  return {
    id: event.id,
    createdAt: event.createdAt,
    userId: event.userId,
    channel: event.channel,
    role: event.role,
    kind: event.kind,
    text: event.text,
    target: event.target,
    metadata: event.metadata,
  };
}

function extractQueryTerms(question) {
  return [
    ...new Set(
      String(question || "")
        .toLowerCase()
        .replace(/ё/gu, "е")
        .split(/[^a-zа-я0-9]+/iu)
        .filter((word) => word.length > 3),
    ),
  ];
}

function scoreEvent(event, queryTerms) {
  const haystack = String(event.text || "")
    .toLowerCase()
    .replace(/ё/gu, "е");
  let overlap = 0;
  for (const term of queryTerms) {
    if (haystack.includes(term)) {
      overlap += 1;
    }
  }
  if (overlap === 0) {
    return 0;
  }
  const ageMs = Date.now() - new Date(event.createdAt || 0).getTime();
  const ageDays = Number.isFinite(ageMs) ? Math.max(ageMs, 0) / (24 * 60 * 60 * 1000) : 999;
  const freshness = 1 / (1 + ageDays);
  return overlap + freshness;
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(number), min), max);
}
