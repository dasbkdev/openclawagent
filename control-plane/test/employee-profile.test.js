import test from "node:test";
import assert from "node:assert/strict";
import { buildEmployeeProfile, buildEmployeeProfiles } from "../src/domain/employee-profile.js";

function stateWith(facts) {
  return {
    users: [
      { id: "u-nikolay", displayName: "Николай", role: "OWNER" },
      { id: "u-pm-1", displayName: "Бегайым", role: "PM", managerId: "u-maksat" },
      { id: "u-maksat", displayName: "Максат", role: "SENIOR_PM" },
    ],
    assistantFacts: facts,
  };
}

test("buildEmployeeProfile groups subject-attributed facts by category + role/manager", () => {
  const state = stateWith([
    { id: "f1", userId: "u-pm-1", category: "commitment", text: "обещала отчёт по Metricon", createdAt: "2026-06-20T10:00:00Z" },
    { id: "f2", userId: "u-pm-1", category: "habit", text: "часто опаздывает по будильнику", createdAt: "2026-06-20T10:00:00Z" },
    { id: "f3", userId: "u-pm-1", category: "project", text: "ведёт проект ИИ-агенты", createdAt: "2026-06-20T10:00:00Z" },
    { id: "f4", userId: "u-maksat", category: "other", text: "чужой факт", createdAt: "2026-06-20T10:00:00Z" },
  ]);
  const p = buildEmployeeProfile(state, state.users[1]);
  assert.equal(p.displayName, "Бегайым");
  assert.equal(p.role, "PM");
  assert.equal(p.managerName, "Максат");
  assert.equal(p.factCount, 3); // only her facts
  const cats = p.sections.map((s) => s.category);
  assert.ok(cats.includes("commitment") && cats.includes("project") && cats.includes("habit"));
  const commitment = p.sections.find((s) => s.category === "commitment");
  assert.ok(commitment.items.some((t) => /Metricon/u.test(t)));
});

test("buildEmployeeProfiles returns a profile per user", () => {
  const state = stateWith([
    { id: "f1", userId: "u-pm-1", category: "project", text: "проект X", createdAt: "2026-06-20T10:00:00Z" },
  ]);
  const profiles = buildEmployeeProfiles(state, [state.users[1], state.users[2]]);
  assert.equal(profiles.length, 2); // both have a role even if Maksat has no facts
  assert.equal(profiles[0].userId, "u-pm-1");
});
