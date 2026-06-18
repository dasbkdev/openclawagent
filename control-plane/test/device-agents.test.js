import assert from "node:assert/strict";
import test from "node:test";
import {
  activateDeviceAgent,
  claimDeviceCommands,
  completeDeviceCommand,
  createDeviceCommand,
  describeDeviceLastSeen,
  isDeviceOnline,
  isValidDeviceAgentToken,
  listVisibleDeviceCommands,
  listVisibleDeviceAgents,
  upsertDeviceAgentHeartbeat,
} from "../src/domain/device-agents.js";

test("isDeviceOnline tracks heartbeat freshness, not the sticky status field", () => {
  const now = new Date("2026-06-18T12:00:00Z");
  const fresh = { lastSeenAt: "2026-06-18T11:59:00Z", status: "online" }; // 1 min ago
  const stale = { lastSeenAt: "2026-06-18T11:50:00Z", status: "online" }; // 10 min ago, app closed
  assert.equal(isDeviceOnline(fresh, now), true);
  assert.equal(isDeviceOnline(stale, now), false);
  assert.equal(isDeviceOnline({ lastSeenAt: null }, now), false);
  assert.match(describeDeviceLastSeen(stale, now), /мин назад/u);
});
import { createInviteCode } from "../src/domain/invite-codes.js";
import { getUserById } from "../src/domain/policy.js";
import { createInitialState } from "../src/infra/seed.js";

test("device agent heartbeat creates and updates a device record", () => {
  const state = createInitialState();
  const first = upsertDeviceAgentHeartbeat(
    state,
    {
      userId: "u-maksat",
      deviceId: "maksat-mac-mini",
      displayName: "Maksat Mac Mini",
      hostname: "Mac-mini.local",
      platform: "darwin",
      capabilities: ["heartbeat"],
    },
    { remoteAddress: "10.0.0.2", now: new Date("2026-06-03T10:00:00Z") },
  );

  assert.equal(first.created, true);
  assert.equal(first.agent.userDisplayName, "Maksat");
  assert.equal(first.agent.heartbeatCount, 1);

  const second = upsertDeviceAgentHeartbeat(
    state,
    {
      userId: "u-maksat",
      deviceId: "maksat-mac-mini",
      hostname: "Mac-mini.local",
      platform: "darwin",
      arch: "arm64",
    },
    { remoteAddress: "10.0.0.3", now: new Date("2026-06-03T10:01:00Z") },
  );

  assert.equal(second.created, false);
  assert.equal(second.agent.heartbeatCount, 2);
  assert.equal(second.agent.arch, "arm64");
  assert.equal(state.deviceAgents.length, 1);
});

test("device agent activation exchanges invite code for device token", () => {
  const state = createInitialState();
  const owner = getUserById(state, "u-nikolay");
  const created = createInviteCode(state, {
    issuer: owner,
    userId: "u-maksat",
    code: "WIOD23WED",
  });

  const activation = activateDeviceAgent(
    state,
    {
      registrationCode: created.code,
      deviceId: "maksat-local-app",
      displayName: "Maksat Local App",
      hostname: "Mac-mini.local",
      platform: "darwin",
      capabilities: ["heartbeat", "local-app"],
    },
    { remoteAddress: "10.0.0.9", now: new Date("2026-06-09T06:00:00Z") },
  );

  assert.equal(activation.user.id, "u-maksat");
  assert.equal(activation.agent.deviceId, "maksat-local-app");
  assert.equal(activation.agent.status, "activated");
  assert.equal(typeof activation.deviceToken, "string");
  assert.equal(activation.deviceToken.length > 20, true);
  assert.equal(
    isValidDeviceAgentToken(state, {
      deviceId: "maksat-local-app",
      token: activation.deviceToken,
    }),
    true,
  );
  assert.equal(
    isValidDeviceAgentToken(state, {
      deviceId: "maksat-local-app",
      token: "wrong-token",
    }),
    false,
  );
});

test("device agent visibility follows hierarchy", () => {
  const state = createInitialState();
  upsertDeviceAgentHeartbeat(state, { userId: "u-nikolay", deviceId: "nikolay-pc" });
  upsertDeviceAgentHeartbeat(state, { userId: "u-maksat", deviceId: "maksat-mac" });
  upsertDeviceAgentHeartbeat(state, {
    userId: "u-pm-1",
    deviceId: "pm-1-laptop",
    capabilities: ["heartbeat", "command-polling", "open_url"],
  });
  upsertDeviceAgentHeartbeat(state, { userId: "u-pm-2", deviceId: "pm-2-laptop" });

  const owner = getUserById(state, "u-nikolay");
  const maksat = getUserById(state, "u-maksat");
  const pm1 = getUserById(state, "u-pm-1");

  assert.deepEqual(
    listVisibleDeviceAgents(state, owner).map((agent) => agent.deviceId).sort(),
    ["maksat-mac", "nikolay-pc", "pm-1-laptop", "pm-2-laptop"],
  );
  assert.deepEqual(
    listVisibleDeviceAgents(state, maksat).map((agent) => agent.deviceId).sort(),
    ["maksat-mac", "pm-1-laptop", "pm-2-laptop"],
  );
  assert.deepEqual(
    listVisibleDeviceAgents(state, pm1).map((agent) => agent.deviceId),
    ["pm-1-laptop"],
  );
});

test("device commands follow hierarchy and move through queue lifecycle", () => {
  const state = createInitialState();
  upsertDeviceAgentHeartbeat(state, { userId: "u-nikolay", deviceId: "nikolay-pc" });
  upsertDeviceAgentHeartbeat(state, { userId: "u-maksat", deviceId: "maksat-mac" });
  upsertDeviceAgentHeartbeat(state, {
    userId: "u-pm-1",
    deviceId: "pm-1-laptop",
    capabilities: ["heartbeat", "command-polling", "open_url"],
  });

  const owner = getUserById(state, "u-nikolay");
  const maksat = getUserById(state, "u-maksat");
  const pm1 = getUserById(state, "u-pm-1");

  const command = createDeviceCommand(
    state,
    {
      target: "pm1",
      type: "open_url",
      args: { url: "https://starlabagent.pp.ua" },
    },
    { actor: owner, now: new Date("2026-06-10T10:00:00Z") },
  );

  assert.equal(command.status, "queued");
  assert.equal(command.userId, "u-pm-1");
  assert.equal(listVisibleDeviceCommands(state, maksat).length, 1);
  assert.equal(listVisibleDeviceCommands(state, pm1).length, 1);

  assert.throws(
    () =>
      createDeviceCommand(
        state,
        { deviceId: "maksat-mac", type: "screenshot" },
        { actor: pm1, now: new Date("2026-06-10T10:00:00Z") },
      ),
    /Device is not accessible/,
  );

  const claimed = claimDeviceCommands(
    state,
    { deviceId: "pm-1-laptop", limit: 5 },
    { now: new Date("2026-06-10T10:00:01Z") },
  );
  assert.equal(claimed.commands.length, 1);
  assert.equal(claimed.commands[0].status, "claimed");
  assert.equal(claimed.commands[0].attempts, 1);

  const completed = completeDeviceCommand(
    state,
    {
      deviceId: "pm-1-laptop",
      commandId: command.id,
      status: "succeeded",
      result: { opened: true },
    },
    { now: new Date("2026-06-10T10:00:03Z") },
  );
  assert.equal(completed.status, "succeeded");
  assert.deepEqual(completed.result, { opened: true });
});

test("device command aliases prefer command-capable agent for the target user", () => {
  const state = createInitialState();
  upsertDeviceAgentHeartbeat(
    state,
    {
      userId: "u-maksat",
      deviceId: "maksat-mac-mini",
      displayName: "Maksat Mac Mini",
      capabilities: ["heartbeat", "openclaw-client"],
      labels: { person: "Maksat" },
    },
    { now: new Date("2026-06-10T10:00:00Z") },
  );
  upsertDeviceAgentHeartbeat(
    state,
    {
      userId: "u-maksat",
      deviceId: "asik-mac-mini.local",
      displayName: "asik on Mac mini",
      capabilities: ["heartbeat", "command-polling", "active_window"],
    },
    { now: new Date("2026-06-10T09:59:00Z") },
  );

  const owner = getUserById(state, "u-nikolay");
  const command = createDeviceCommand(
    state,
    {
      target: "maksat",
      type: "active_window",
      args: {},
    },
    { actor: owner, now: new Date("2026-06-10T10:01:00Z") },
  );

  assert.equal(command.deviceId, "asik-mac-mini.local");
});

test("device commands reject heartbeat-only agents", () => {
  const state = createInitialState();
  upsertDeviceAgentHeartbeat(
    state,
    {
      userId: "u-maksat",
      deviceId: "maksat-mac-mini",
      displayName: "Maksat Mac Mini",
      capabilities: ["heartbeat", "openclaw-client"],
    },
    { now: new Date("2026-06-10T10:00:00Z") },
  );

  const owner = getUserById(state, "u-nikolay");
  assert.throws(
    () =>
      createDeviceCommand(
        state,
        {
          target: "maksat",
          type: "open_app",
          args: { app: "Google Chrome" },
        },
        { actor: owner, now: new Date("2026-06-10T10:01:00Z") },
      ),
    /cannot execute this command/,
  );
});
