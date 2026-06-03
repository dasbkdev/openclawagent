import assert from "node:assert/strict";
import test from "node:test";
import { buildKickidlerActivitySummary } from "../src/domain/reports.js";
import { getUserById } from "../src/domain/policy.js";
import { createInitialState } from "../src/infra/seed.js";

const mockKickidlerClient = {
  source: "test",
  configured: true,
  async getActivitySummary({ employeeIds, from, to }) {
    return {
      source: "test",
      configured: true,
      from,
      to,
      employees: employeeIds.map((id) => ({
        kickidlerEmployeeId: id,
        activeSeconds: 100,
        idleSeconds: 10,
      })),
    };
  },
};

test("OWNER report without target includes all seeded users", async () => {
  const state = createInitialState();
  const owner = getUserById(state, "u-nikolay");
  const report = await buildKickidlerActivitySummary(state, {
    actor: owner,
    request: {
      from: "2026-06-02T00:00:00Z",
      to: "2026-06-02T23:59:59Z",
    },
    kickidlerClient: mockKickidlerClient,
  });

  assert.equal(report.employees.length, 5);
  assert.equal(state.auditLog.length, 1);
});

test("SENIOR_PM cannot request owner report", async () => {
  const state = createInitialState();
  const maksat = getUserById(state, "u-maksat");
  await assert.rejects(
    () =>
      buildKickidlerActivitySummary(state, {
        actor: maksat,
        request: {
          targetUserId: "u-nikolay",
          from: "2026-06-02T00:00:00Z",
          to: "2026-06-02T23:59:59Z",
        },
        kickidlerClient: mockKickidlerClient,
      }),
    /Actor cannot access/,
  );
});

test("PM project report is limited to own project members", async () => {
  const state = createInitialState();
  const pm1 = getUserById(state, "u-pm-1");
  const report = await buildKickidlerActivitySummary(state, {
    actor: pm1,
    request: {
      projectId: "project-alpha",
      from: "2026-06-02T00:00:00Z",
      to: "2026-06-02T23:59:59Z",
    },
    kickidlerClient: mockKickidlerClient,
  });

  assert.deepEqual(report.employees.map((item) => item.user.id), ["u-pm-1"]);
});

test("report rejects ambiguous user and project targets", async () => {
  const state = createInitialState();
  const owner = getUserById(state, "u-nikolay");
  await assert.rejects(
    () =>
      buildKickidlerActivitySummary(state, {
        actor: owner,
        request: {
          targetUserId: "u-pm-1",
          projectId: "project-alpha",
          from: "2026-06-02T00:00:00Z",
          to: "2026-06-02T23:59:59Z",
        },
        kickidlerClient: mockKickidlerClient,
      }),
    /either targetUserId or projectId/,
  );
});
