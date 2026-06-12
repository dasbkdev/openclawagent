const VALID_CATEGORIES = new Set([
  "commitment",
  "preference",
  "habit",
  "project",
  "other",
]);
const MAX_TEXT_LENGTH = 500;
const MAX_ACTIVE_FACTS_PER_USER = 200;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 200;

export function ensureAssistantFactsState(state) {
  state.assistantFacts ??= [];
  return state.assistantFacts;
}

export function upsertAssistantFact(
  state,
  {
    userId,
    category = "other",
    text,
    sourceEventIds = [],
    now = new Date(),
  },
) {
  ensureAssistantFactsState(state);
  const normalizedText = normalizeFactText(text);
  if (!normalizedText) {
    return null;
  }
  const normalizedKey = normalizeForDedup(normalizedText);
  const existing = state.assistantFacts.find(
    (fact) =>
      fact.userId === (userId || null) &&
      !fact.supersededBy &&
      normalizeForDedup(fact.text) === normalizedKey,
  );
  if (existing) {
    existing.updatedAt = now.toISOString();
    existing.category = VALID_CATEGORIES.has(category) ? category : existing.category;
    existing.sourceEventIds = mergeSourceEventIds(existing.sourceEventIds, sourceEventIds);
    return existing;
  }

  const fact = {
    id: `fact-${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`,
    userId: userId || null,
    category: VALID_CATEGORIES.has(category) ? category : "other",
    text: normalizedText,
    sourceEventIds: mergeSourceEventIds([], sourceEventIds),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    supersededBy: null,
  };
  state.assistantFacts.push(fact);
  enforceFactCap(state, userId || null, now);
  return fact;
}

export function supersedeAssistantFact(state, { id, supersededBy = null, now = new Date() }) {
  ensureAssistantFactsState(state);
  const fact = state.assistantFacts.find((item) => item.id === id);
  if (!fact || fact.supersededBy) {
    return null;
  }
  fact.supersededBy = supersededBy || true;
  fact.updatedAt = now.toISOString();
  return fact;
}

export function listAssistantFacts(state, { userIds = [], limit = DEFAULT_LIST_LIMIT } = {}) {
  ensureAssistantFactsState(state);
  const filterIds = new Set(userIds.filter(Boolean));
  return state.assistantFacts
    .filter((fact) => !fact.supersededBy)
    .filter((fact) => filterIds.size === 0 || filterIds.has(fact.userId))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, clampLimit(limit))
    .map((fact) => ({
      id: fact.id,
      userId: fact.userId,
      category: fact.category,
      text: fact.text,
      createdAt: fact.createdAt,
      updatedAt: fact.updatedAt,
    }));
}

function enforceFactCap(state, userId, now) {
  const active = state.assistantFacts.filter(
    (fact) => fact.userId === userId && !fact.supersededBy,
  );
  if (active.length <= MAX_ACTIVE_FACTS_PER_USER) {
    return;
  }
  const overflow = active.length - MAX_ACTIVE_FACTS_PER_USER;
  active
    .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))
    .slice(0, overflow)
    .forEach((fact) => {
      fact.supersededBy = true;
      fact.updatedAt = now.toISOString();
    });
}

function mergeSourceEventIds(existing, incoming) {
  const ids = new Set(
    [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );
  return [...ids].slice(0, 50);
}

function normalizeFactText(text) {
  return String(text || "").trim().slice(0, MAX_TEXT_LENGTH);
}

function normalizeForDedup(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
}

function clampLimit(limit) {
  return Math.min(Math.max(Number(limit || DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
}
