import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCanAccessProject,
  assertCanAccessUser,
  canAccessProject,
  getProjectById,
  getUserById,
  listAccessibleUserIds,
} from "../src/domain/policy.js";
import { createInitialState } from "../src/infra/seed.js";

test("OWNER can access everyone", () => {
  const state = createInitialState();
  const owner = getUserById(state, "u-nikolay");
  assert.deepEqual(new Set(listAccessibleUserIds(state, owner)), new Set(state.users.map((user) => user.id)));
});

test("SENIOR_PM can access subordinate PMs but not owner", () => {
  const state = createInitialState();
  const maksat = getUserById(state, "u-maksat");
  assert.deepEqual(
    new Set(listAccessibleUserIds(state, maksat)),
    new Set(["u-maksat", "u-pm-1", "u-pm-2", "u-pm-3"]),
  );
  assert.throws(() => assertCanAccessUser(state, maksat, "u-nikolay"), /Actor cannot access/);
});

test("PM can access own project only", () => {
  const state = createInitialState();
  const pm1 = getUserById(state, "u-pm-1");
  const alpha = getProjectById(state, "project-alpha");
  const beta = getProjectById(state, "project-beta");
  assert.equal(canAccessProject(state, pm1, alpha), true);
  assert.equal(canAccessProject(state, pm1, beta), false);
  assert.throws(() => assertCanAccessProject(state, pm1, "project-beta"), /Actor cannot access/);
});
