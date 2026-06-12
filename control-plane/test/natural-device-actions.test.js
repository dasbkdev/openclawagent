import assert from "node:assert/strict";
import test from "node:test";
import {
  parseNaturalDeviceAction,
  tryCreateNaturalDeviceCommand,
} from "../src/domain/natural-device-actions.js";
import { getUserById } from "../src/domain/policy.js";
import { createInitialState } from "../src/infra/seed.js";

test("natural device action parses generic YouTube music as open_url fallback", () => {
  const intent = parseNaturalDeviceAction("открой youtube и запусти любую песню");

  assert.equal(intent.type, "open_url");
  assert.equal(intent.args.url, "https://www.youtube.com/results?search_query=music");
});

test("natural device action parses a specific YouTube song as play_youtube", () => {
  const intent = parseNaturalDeviceAction("открой на маке хром и запусти песню XXXTENTACION - Moonlight");

  assert.equal(intent.type, "play_youtube");
  assert.equal(intent.args.query, "XXXTENTACION - Moonlight");
  assert.equal(intent.args.provider, "youtube");
});

test("natural device action creates command for the current local device", () => {
  const state = createInitialState();
  state.deviceAgents.push({
    id: "device-asik-mac-mini.local",
    deviceId: "asik-mac-mini.local",
    userId: "u-maksat",
    displayName: "asik on Mac mini",
    hostname: "Mac mini",
    platform: "darwin",
    arch: "arm64",
    status: "online",
    firstSeenAt: "2026-06-10T10:00:00.000Z",
    lastSeenAt: "2026-06-10T10:01:00.000Z",
    heartbeatCount: 5,
    capabilities: ["heartbeat", "command-polling", "open_url"],
    labels: {},
  });
  const actor = getUserById(state, "u-maksat");

  const result = tryCreateNaturalDeviceCommand(state, {
    actor,
    text: "запусти любую песню",
    currentDeviceId: "asik-mac-mini.local",
    source: "local-agent-chat",
    now: new Date("2026-06-10T10:02:00.000Z"),
  });

  assert.equal(result.command.deviceId, "asik-mac-mini.local");
  assert.equal(result.command.type, "open_url");
  assert.equal(result.command.args.url, "https://www.youtube.com/results?search_query=music");
});

test("natural device action creates play_youtube command for a specific song", () => {
  const state = createInitialState();
  state.deviceAgents.push({
    id: "device-asik-mac-mini.local",
    deviceId: "asik-mac-mini.local",
    userId: "u-maksat",
    displayName: "asik on Mac mini",
    hostname: "Mac mini",
    platform: "darwin",
    arch: "arm64",
    status: "online",
    firstSeenAt: "2026-06-10T10:00:00.000Z",
    lastSeenAt: "2026-06-10T10:01:00.000Z",
    heartbeatCount: 5,
    capabilities: ["heartbeat", "command-polling", "play_youtube"],
    labels: {},
  });
  const actor = getUserById(state, "u-maksat");

  const result = tryCreateNaturalDeviceCommand(state, {
    actor,
    text: "открой на маке хром и запусти песню XXXTENTACION - Moonlight",
    currentDeviceId: "asik-mac-mini.local",
    source: "local-agent-chat",
    now: new Date("2026-06-10T10:02:00.000Z"),
  });

  assert.equal(result.command.deviceId, "asik-mac-mini.local");
  assert.equal(result.command.type, "play_youtube");
  assert.deepEqual(result.command.args, {
    query: "XXXTENTACION - Moonlight",
    provider: "youtube",
  });
});

test("natural device action falls back to exact YouTube search for older agents", () => {
  const state = createInitialState();
  state.deviceAgents.push({
    id: "device-asik-mac-mini.local",
    deviceId: "asik-mac-mini.local",
    userId: "u-maksat",
    displayName: "asik on Mac mini",
    hostname: "Mac mini",
    platform: "darwin",
    arch: "arm64",
    status: "online",
    firstSeenAt: "2026-06-10T10:00:00.000Z",
    lastSeenAt: "2026-06-10T10:01:00.000Z",
    heartbeatCount: 5,
    capabilities: ["heartbeat", "command-polling", "open_url"],
    labels: {},
  });
  const actor = getUserById(state, "u-maksat");

  const result = tryCreateNaturalDeviceCommand(state, {
    actor,
    text: "открой на маке хром и запусти песню XXXTENTACION - Moonlight",
    currentDeviceId: "asik-mac-mini.local",
    source: "local-agent-chat",
    now: new Date("2026-06-10T10:02:00.000Z"),
  });

  assert.equal(result.requestedIntent.type, "play_youtube");
  assert.equal(result.command.type, "open_url");
  assert.equal(
    result.command.args.url,
    "https://www.youtube.com/results?search_query=XXXTENTACION+-+Moonlight",
  );
});

test("natural device action retries last failed-open follow-up", () => {
  const state = createInitialState();
  state.deviceAgents.push({
    id: "device-asik-mac-mini.local",
    deviceId: "asik-mac-mini.local",
    userId: "u-maksat",
    displayName: "asik on Mac mini",
    hostname: "Mac mini",
    platform: "darwin",
    arch: "arm64",
    status: "online",
    firstSeenAt: "2026-06-10T10:00:00.000Z",
    lastSeenAt: "2026-06-10T10:01:00.000Z",
    heartbeatCount: 5,
    capabilities: ["heartbeat", "command-polling", "open_app"],
    labels: {},
  });
  const actor = getUserById(state, "u-maksat");
  const first = tryCreateNaturalDeviceCommand(state, {
    actor,
    text: "открой chrome",
    currentDeviceId: "asik-mac-mini.local",
    source: "local-agent-chat",
    now: new Date("2026-06-10T10:02:00.000Z"),
  });

  const retry = tryCreateNaturalDeviceCommand(state, {
    actor,
    text: "не открылось",
    currentDeviceId: "asik-mac-mini.local",
    source: "local-agent-chat",
    now: new Date("2026-06-10T10:03:00.000Z"),
  });

  assert.equal(retry.previousCommand.id, first.command.id);
  assert.equal(retry.command.deviceId, "asik-mac-mini.local");
  assert.equal(retry.command.type, "open_app");
  assert.deepEqual(retry.command.args, { app: "Google Chrome" });
});

test("natural device action understands numeric retry choice from recent assistant prompt", () => {
  const state = createInitialState();
  state.deviceAgents.push({
    id: "device-nikolay-windows",
    deviceId: "nikolay-windows",
    userId: "u-nikolay",
    displayName: "Nikolay Windows",
    hostname: "Nikolay-PC",
    platform: "win32",
    arch: "x64",
    status: "online",
    firstSeenAt: "2026-06-11T05:00:00.000Z",
    lastSeenAt: "2026-06-11T05:01:00.000Z",
    heartbeatCount: 5,
    capabilities: ["heartbeat", "command-polling", "play_youtube"],
    labels: {},
  });
  const actor = getUserById(state, "u-nikolay");
  const first = tryCreateNaturalDeviceCommand(state, {
    actor,
    text: "запусти песню Raindance",
    currentDeviceId: "nikolay-windows",
    source: "telegram-natural-language",
    now: new Date("2026-06-11T05:02:00.000Z"),
  });
  state.assistantMemory.push({
    id: "memory-choice",
    userId: actor.id,
    channel: "telegram",
    role: "assistant",
    kind: "assistant_answer",
    text: "Скажи одно из двух:\n1. Поставь Raindance снова — отправлю play_youtube повторно.\n2. Нажми на первый результат.",
    target: null,
    metadata: {},
    createdAt: "2026-06-11T05:03:00.000Z",
  });

  const retry = tryCreateNaturalDeviceCommand(state, {
    actor,
    text: "1",
    currentDeviceId: "nikolay-windows",
    source: "telegram-natural-language",
    now: new Date("2026-06-11T05:04:00.000Z"),
  });

  assert.equal(retry.previousCommand.id, first.command.id);
  assert.equal(retry.command.type, "play_youtube");
  assert.equal(retry.command.deviceId, "nikolay-windows");
  assert.deepEqual(retry.command.args, {
    query: "Raindance",
    provider: "youtube",
  });
});

test("natural device action does not treat an isolated number as a retry", () => {
  const state = createInitialState();
  const actor = getUserById(state, "u-nikolay");

  const result = tryCreateNaturalDeviceCommand(state, {
    actor,
    text: "1",
    source: "telegram-natural-language",
    now: new Date("2026-06-11T05:04:00.000Z"),
  });

  assert.equal(result, null);
});
