import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { autoResolveUserMappings, matchMetriconEmployee } from "../src/domain/external-mapping.js";
import { userTokenMatchesValue } from "../src/connectors/platrum-client.js";
import { HttpBitrixClient } from "../src/connectors/bitrix-client.js";
import { redeemInviteCode, createInviteCode } from "../src/domain/invite-codes.js";
import { createInitialState } from "../src/infra/seed.js";
import { JsonStore } from "../src/infra/json-store.js";

function tempStore(state) {
  const file = path.join(os.tmpdir(), `external-mapping-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const store = new JsonStore(file, () => state);
  return { store, cleanup: () => fs.rm(file, { force: true }) };
}

test("userTokenMatchesValue matches whole values and words", () => {
  assert.equal(userTokenMatchesValue("перизат", "Усенкулова Перизат"), true);
  assert.equal(userTokenMatchesValue("перизат усенкулова", "перизат усенкулова"), true);
  assert.equal(userTokenMatchesValue("пер", "Усенкулова Перизат"), false);
  assert.equal(userTokenMatchesValue("иван", "Усенкулова Перизат"), false);
});

test("matchMetriconEmployee requires unambiguous match and skips placeholders", () => {
  const employees = [
    { id: 76, name: "Перизат Усенкулова" },
    { id: 29, name: "Айзирек пм" },
  ];
  const user = { displayName: "Перизат Усенкулова", telegram: {} };
  assert.equal(matchMetriconEmployee(user, employees)?.id, 76);

  const placeholder = { displayName: "Project Manager 3", telegram: {} };
  assert.equal(matchMetriconEmployee(placeholder, employees), null);

  const ambiguous = matchMetriconEmployee(
    { displayName: "Перизат", telegram: {} },
    [...employees, { id: 99, name: "Перизат Другая" }],
  );
  assert.equal(ambiguous, null);
});

test("autoResolveUserMappings persists discovered IDs without overwriting", async () => {
  const state = createInitialState();
  const target = state.users.find((u) => u.id === "u-pm-3");
  target.displayName = "Перизат Усенкулова";
  // Seed ships mock Metricon IDs; clear to exercise resolution.
  target.kickidlerEmployeeId = null;
  const { store, cleanup } = tempStore(state);
  try {
    const result = await autoResolveUserMappings({
      store,
      userId: "u-pm-3",
      platrumClient: {
        async resolvePlatrumUser() {
          return { id: 19, username: "jesus" };
        },
      },
      bitrixClient: {
        async resolveBitrixUser() {
          return { id: 15, resolvedByName: true };
        },
      },
      kickidlerClient: {
        async listEmployees() {
          return [{ id: 76, name: "Перизат Усенкулова" }];
        },
      },
    });
    assert.deepEqual(result.updated, {
      platrumUserId: 19,
      platrumUsername: "jesus",
      bitrixUserId: 15,
      kickidlerEmployeeId: 76,
    });
    const saved = await store.load();
    const user = saved.users.find((u) => u.id === "u-pm-3");
    assert.equal(user.platrumUserId, 19);
    assert.equal(user.bitrixUserId, 15);
    assert.equal(user.kickidlerEmployeeId, 76);
    assert.equal(saved.auditLog.at(-1).action, "user.mapping.autoresolved");
  } finally {
    await cleanup();
  }
});

test("autoResolveUserMappings tolerates connector failures", async () => {
  const state = createInitialState();
  const { store, cleanup } = tempStore(state);
  try {
    const result = await autoResolveUserMappings({
      store,
      userId: "u-pm-3",
      platrumClient: {
        async resolvePlatrumUser() {
          throw new Error("network down");
        },
      },
      bitrixClient: null,
      kickidlerClient: undefined,
    });
    assert.deepEqual(result.updated, {});
  } finally {
    await cleanup();
  }
});

test("Bitrix resolveBitrixUser finds a unique user by name and skips ambiguous", async () => {
  const client = new HttpBitrixClient({ webhookUrl: "https://bitrix.example/rest/1/token" });
  client.callMethod = async (method, params) => {
    assert.equal(method, "user.search");
    if (params.FILTER.FIND === "Перизат Усенкулова") {
      return { result: [{ ID: "15", NAME: "Перизат", LAST_NAME: "Усенкулова" }] };
    }
    return { result: [{ ID: "1" }, { ID: "2" }] };
  };

  const resolved = await client.resolveBitrixUser({
    displayName: "Перизат Усенкулова",
    telegram: {},
  });
  assert.equal(resolved.id, 15);
  assert.equal(resolved.resolvedByName, true);

  const ambiguous = await client.resolveBitrixUser({
    displayName: "Иван Иванов",
    telegram: {},
  });
  assert.equal(ambiguous, null);

  const mapped = await client.resolveBitrixUser({ bitrixUserId: 7 });
  assert.deepEqual(mapped, { id: 7, resolvedByName: false });
});

test("redeemInviteCode stores telegram names and replaces placeholder displayName", () => {
  const state = createInitialState();
  const issuer = state.users.find((u) => u.id === "u-nikolay");
  const { code } = createInviteCode(state, { issuer, userId: "u-pm-3", ttlMinutes: 60 });
  const { user } = redeemInviteCode(state, {
    code,
    telegramUserId: "555001",
    username: "usenperi",
    firstName: "Перизат",
    lastName: "Усенкулова",
  });
  assert.equal(user.telegram.firstName, "Перизат");
  assert.equal(user.telegram.lastName, "Усенкулова");
  assert.equal(user.displayName, "Перизат Усенкулова");

  const state2 = createInitialState();
  const issuer2 = state2.users.find((u) => u.id === "u-nikolay");
  const invite2 = createInviteCode(state2, { issuer: issuer2, userId: "u-maksat", ttlMinutes: 60 });
  const result2 = redeemInviteCode(state2, {
    code: invite2.code,
    telegramUserId: "555002",
    firstName: "Max",
  });
  // Real (non-placeholder) names are kept.
  assert.equal(result2.user.displayName, "Maksat");
});
