/**
 * Compact per-employee profile assembled from durable, subject-attributed facts
 * (Memory v3) plus structural info (role, manager). Fed to the assistant so it
 * "knows" each employee — their commitments, preferences, habits, projects —
 * instead of re-deriving everything each time.
 */
import { listAssistantFacts } from "./assistant-facts.js";

const CATEGORY_LABEL = {
  commitment: "Обязательства",
  preference: "Предпочтения",
  habit: "Привычки",
  project: "Проекты",
  other: "Прочее",
};

export function buildEmployeeProfile(state, user, { maxPerCategory = 4, maxFacts = 16 } = {}) {
  if (!user?.id) {
    return null;
  }
  const manager = (state.users || []).find((u) => u.id === user.managerId) || null;
  const facts = listAssistantFacts(state, { userIds: [user.id], limit: 200 });

  const byCategory = {};
  for (const fact of facts) {
    const cat = CATEGORY_LABEL[fact.category] ? fact.category : "other";
    (byCategory[cat] ||= []).push(String(fact.text || "").trim());
  }

  const sections = [];
  let total = 0;
  for (const cat of ["commitment", "project", "habit", "preference", "other"]) {
    const items = (byCategory[cat] || []).filter(Boolean).slice(0, maxPerCategory);
    if (!items.length || total >= maxFacts) {
      continue;
    }
    const capped = items.slice(0, Math.max(0, maxFacts - total));
    total += capped.length;
    sections.push({ category: cat, label: CATEGORY_LABEL[cat], items: capped });
  }

  return {
    userId: user.id,
    displayName: user.displayName || user.id,
    role: user.role || null,
    managerName: manager?.displayName || null,
    factCount: facts.length,
    sections,
  };
}

export function buildEmployeeProfiles(state, users, options = {}) {
  return (users || [])
    .map((user) => buildEmployeeProfile(state, user, options))
    .filter((profile) => profile && (profile.sections.length > 0 || profile.role));
}
