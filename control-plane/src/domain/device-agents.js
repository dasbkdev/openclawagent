import crypto from "node:crypto";
import { validation } from "./errors.js";
import { hashInviteCode, normalizeInviteCode } from "./invite-codes.js";
import { getUserById, listAccessibleUserIds, assertCanAccessUser } from "./policy.js";
import { resolveOpenAppTarget } from "./app-aliases.js";

const MAX_STRING = 240;
const DEVICE_TOKEN_BYTES = 32;
const MAX_COMMANDS = 1000;
const CLAIM_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_COMMAND_TTL_SECONDS = 5 * 60;
const MAX_RESULT_STRING = 2_500_000;
export const DEVICE_ACTION_TYPES = Object.freeze([
  "open_app",
  "close_app",
  "open_url",
  "open_file",
  "list_running_apps",
  "active_window",
  "screenshot",
  "clipboard_get",
  "clipboard_set",
  "keyboard_type",
  "hotkey",
  "mouse_click",
  "ocr_screen",
  "play_youtube",
  "openclaw_prompt",
  // Extended desktop toolset (level 2). run_script is the powerful catch-all
  // (PowerShell on Windows, AppleScript/shell on macOS, shell on Linux) and
  // is gated by the run_script capability plus the device-side confirm guard.
  "run_script",
  "notify",
  "read_file",
  "write_file",
  "list_dir",
  "search_files",
  "move_path",
  "delete_path",
  "make_dir",
  "media_control",
  "set_volume",
  "system_info",
  "minimize_window",
  "minimize_all",
]);

// Actions that can mutate or exfiltrate the user's machine. The device-side
// executor must require explicit confirmation (or an allowlist) before
// running these; the server marks them so the planner/agent loop can ask.
export const SENSITIVE_DEVICE_ACTION_TYPES = Object.freeze([
  "run_script",
  "write_file",
  "move_path",
  "delete_path",
  "keyboard_type",
  "hotkey",
  "mouse_click",
]);

export function isSensitiveDeviceAction(type) {
  return SENSITIVE_DEVICE_ACTION_TYPES.includes(type);
}

export function activateDeviceAgent(state, payload, { remoteAddress, now = new Date() } = {}) {
  if (!Array.isArray(state.deviceAgents)) {
    state.deviceAgents = [];
  }

  const normalizedCode = normalizeInviteCode(payload.registrationCode || payload.code);
  const invite = state.inviteCodes.find((item) => item.codeHash === hashInviteCode(normalizedCode));
  if (!invite) {
    throw validation("Registration code is invalid");
  }
  if (invite.revokedAt) {
    throw validation("Registration code has been revoked");
  }
  if (new Date(invite.expiresAt).getTime() < now.getTime()) {
    throw validation("Registration code has expired");
  }

  const user = getUserById(state, invite.userId);
  const hostname = normalizeOptionalString(payload.hostname);
  const platform = normalizeOptionalString(payload.platform);
  const deviceId =
    normalizeOptionalString(payload.deviceId) ||
    `${user.id}-${hostname || "device"}`.toLowerCase().replace(/[^a-z0-9._-]+/giu, "-");
  const existing = state.deviceAgents.find((agent) => agent.deviceId === deviceId);
  const rawToken = crypto.randomBytes(DEVICE_TOKEN_BYTES).toString("base64url");
  const nowIso = now.toISOString();

  const record = {
    id: existing?.id || `device-${deviceId}`,
    deviceId,
    userId: user.id,
    displayName: normalizeOptionalString(payload.displayName) || existing?.displayName || `${user.displayName} device`,
    hostname: hostname || existing?.hostname || null,
    platform: platform || existing?.platform || null,
    arch: normalizeOptionalString(payload.arch) || existing?.arch || null,
    osRelease: normalizeOptionalString(payload.osRelease) || existing?.osRelease || null,
    agentVersion: normalizeOptionalString(payload.agentVersion) || existing?.agentVersion || null,
    status: "activated",
    firstSeenAt: existing?.firstSeenAt || nowIso,
    lastSeenAt: existing?.lastSeenAt || nowIso,
    activatedAt: existing?.activatedAt || nowIso,
    lastRemoteAddress: normalizeOptionalString(remoteAddress) || existing?.lastRemoteAddress || null,
    heartbeatCount: Number(existing?.heartbeatCount || 0),
    capabilities: normalizeStringArray(payload.capabilities || ["heartbeat", "local-app"]),
    labels: normalizeLabels(payload.labels),
    tokenHash: hashDeviceAgentToken(rawToken),
    inviteCodeLast4: invite.codeLast4,
  };

  if (existing) {
    Object.assign(existing, record);
  } else {
    state.deviceAgents.push(record);
  }

  return {
    agent: publicDeviceAgent(record, user),
    user: {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
      employeeId: user.employeeId,
    },
    deviceToken: rawToken,
  };
}

export function upsertDeviceAgentHeartbeat(state, payload, { remoteAddress, now = new Date() } = {}) {
  if (!Array.isArray(state.deviceAgents)) {
    state.deviceAgents = [];
  }

  const userId = normalizeRequiredString(payload.userId, "userId");
  const deviceId = normalizeRequiredString(payload.deviceId, "deviceId");
  const user = getUserById(state, userId);
  const nowIso = now.toISOString();
  const existing = state.deviceAgents.find((agent) => agent.deviceId === deviceId);
  const heartbeatCount = Number(existing?.heartbeatCount || 0) + 1;

  const record = {
    id: existing?.id || `device-${deviceId}`,
    deviceId,
    userId,
    displayName: normalizeOptionalString(payload.displayName) || existing?.displayName || user.displayName,
    hostname: normalizeOptionalString(payload.hostname) || existing?.hostname || null,
    platform: normalizeOptionalString(payload.platform) || existing?.platform || null,
    arch: normalizeOptionalString(payload.arch) || existing?.arch || null,
    osRelease: normalizeOptionalString(payload.osRelease) || existing?.osRelease || null,
    agentVersion: normalizeOptionalString(payload.agentVersion) || existing?.agentVersion || null,
    status: "online",
    firstSeenAt: existing?.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    lastRemoteAddress: normalizeOptionalString(remoteAddress) || existing?.lastRemoteAddress || null,
    heartbeatCount,
    capabilities: normalizeStringArray(payload.capabilities),
    labels: normalizeLabels(payload.labels),
  };

  if (existing) {
    Object.assign(existing, record);
    return { agent: publicDeviceAgent(existing, user), created: false };
  }

  state.deviceAgents.push(record);
  return { agent: publicDeviceAgent(record, user), created: true };
}

export function createDeviceCommand(state, payload, { actor, now = new Date() } = {}) {
  if (!actor) {
    throw validation("Actor is required");
  }
  ensureDeviceCommands(state);
  expireDeviceCommands(state, { now });

  const type = normalizeRequiredString(payload.type || payload.action?.type, "type");
  if (!DEVICE_ACTION_TYPES.includes(type)) {
    throw validation("Unsupported device command type", { type, supportedTypes: DEVICE_ACTION_TYPES });
  }

  const agent = resolveCommandTargetAgent(state, payload, actor, type);
  assertAgentCanExecuteCommand(agent, type);
  const nowIso = now.toISOString();
  const ttlSeconds = normalizeTtlSeconds(payload.ttlSeconds);
  const args = normalizeCommandArgs(payload.args || payload.action?.args || {});
  // Resolve human app names ("Visual Studio Code") to a launch target the
  // target device's OS can actually open. Works for already-installed agents.
  if (type === "open_app") {
    const appName = args.app || args.name || args.path;
    if (appName) {
      const resolved = resolveOpenAppTarget(appName, agent.platform);
      if (resolved !== appName) {
        args.app = resolved;
        args.appLabel = String(appName);
      }
    }
  }
  const command = {
    id: `cmd-${crypto.randomUUID()}`,
    deviceId: agent.deviceId,
    userId: agent.userId,
    actorUserId: actor.id,
    source: normalizeOptionalString(payload.source) || "api",
    type,
    args,
    status: "queued",
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    claimedAt: null,
    completedAt: null,
    attempts: 0,
    result: null,
    error: null,
  };

  state.deviceCommands.push(command);
  pruneDeviceCommands(state);
  return publicDeviceCommand(command, agent, getUserById(state, agent.userId));
}

export function claimDeviceCommands(state, payload, { now = new Date() } = {}) {
  ensureDeviceCommands(state);
  expireDeviceCommands(state, { now });
  const deviceId = normalizeRequiredString(payload.deviceId, "deviceId");
  const agent = (state.deviceAgents || []).find((item) => item.deviceId === deviceId);
  if (!agent) {
    throw validation("Device agent is not registered", { deviceId });
  }

  const limit = Math.min(Math.max(Number(payload.limit || 5), 1), 20);
  const nowIso = now.toISOString();
  const commands = state.deviceCommands
    .filter((command) => command.deviceId === deviceId && command.status === "queued")
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, limit);

  for (const command of commands) {
    command.status = "claimed";
    command.claimedAt = nowIso;
    command.updatedAt = nowIso;
    command.attempts = Number(command.attempts || 0) + 1;
  }

  return {
    commands: commands.map((command) => publicDeviceCommand(command, agent, getUserById(state, agent.userId))),
  };
}

export function completeDeviceCommand(state, payload, { now = new Date() } = {}) {
  ensureDeviceCommands(state);
  const deviceId = normalizeRequiredString(payload.deviceId, "deviceId");
  const commandId = normalizeRequiredString(payload.commandId || payload.id, "commandId");
  const command = state.deviceCommands.find((item) => item.id === commandId && item.deviceId === deviceId);
  if (!command) {
    throw validation("Device command not found", { commandId, deviceId });
  }

  const status = normalizeRequiredString(payload.status, "status");
  if (!["succeeded", "failed", "rejected", "unsupported"].includes(status)) {
    throw validation("Invalid device command result status", { status });
  }

  command.status = status;
  command.updatedAt = now.toISOString();
  command.completedAt = command.updatedAt;
  command.result = normalizeCommandResult(payload.result || null);
  command.error = normalizeOptionalString(payload.error) || null;

  const agent = (state.deviceAgents || []).find((item) => item.deviceId === deviceId);
  return publicDeviceCommand(command, agent, agent ? getUserById(state, agent.userId) : null);
}

export function listVisibleDeviceCommands(state, actor, { deviceId, userId, limit = 50 } = {}) {
  ensureDeviceCommands(state);
  const accessibleUserIds = new Set(listAccessibleUserIds(state, actor));
  return state.deviceCommands
    .filter((command) => accessibleUserIds.has(command.userId))
    .filter((command) => !deviceId || command.deviceId === deviceId)
    .filter((command) => !userId || command.userId === userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Math.min(Math.max(Number(limit || 50), 1), 200))
    .map((command) => {
      const agent = (state.deviceAgents || []).find((item) => item.deviceId === command.deviceId);
      const user = agent ? getUserById(state, agent.userId) : getUserById(state, command.userId);
      return publicDeviceCommand(command, agent, user);
    });
}

export function isValidDeviceAgentToken(state, { deviceId, token }) {
  const normalizedDeviceId = normalizeOptionalString(deviceId);
  const normalizedToken = normalizeOptionalString(token);
  if (!normalizedDeviceId || !normalizedToken) {
    return false;
  }
  const agent = (state.deviceAgents || []).find((item) => item.deviceId === normalizedDeviceId);
  if (!agent?.tokenHash) {
    return false;
  }
  return agent.tokenHash === hashDeviceAgentToken(normalizedToken);
}

/**
 * Resolve a device agent from a bare token (no deviceId) by matching its hash —
 * used by the OpenAI-compatible endpoint where clients send only a Bearer token.
 */
export function findDeviceAgentByToken(state, token) {
  const normalizedToken = normalizeOptionalString(token);
  if (!normalizedToken) {
    return null;
  }
  const hash = hashDeviceAgentToken(normalizedToken);
  return (state.deviceAgents || []).find((item) => item.tokenHash === hash) || null;
}

export function listVisibleDeviceAgents(state, actor) {
  const accessibleUserIds = new Set(listAccessibleUserIds(state, actor));
  return (state.deviceAgents || [])
    .filter((agent) => accessibleUserIds.has(agent.userId))
    .map((agent) => publicDeviceAgent(agent, getUserById(state, agent.userId)));
}

export function publicDeviceAgent(agent, user) {
  return {
    id: agent.id,
    deviceId: agent.deviceId,
    userId: agent.userId,
    userDisplayName: user.displayName,
    userRole: user.role,
    displayName: agent.displayName,
    hostname: agent.hostname,
    platform: agent.platform,
    arch: agent.arch,
    osRelease: agent.osRelease,
    agentVersion: agent.agentVersion,
    status: agent.status,
    firstSeenAt: agent.firstSeenAt,
    lastSeenAt: agent.lastSeenAt,
    heartbeatCount: agent.heartbeatCount,
    capabilities: agent.capabilities || [],
    labels: agent.labels || {},
  };
}

function publicDeviceCommand(command, agent, user) {
  return {
    id: command.id,
    deviceId: command.deviceId,
    userId: command.userId,
    userDisplayName: user?.displayName || null,
    actorUserId: command.actorUserId,
    source: command.source,
    type: command.type,
    args: command.args || {},
    status: command.status,
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
    expiresAt: command.expiresAt,
    claimedAt: command.claimedAt,
    completedAt: command.completedAt,
    attempts: command.attempts || 0,
    result: command.result || null,
    error: command.error || null,
    deviceDisplayName: agent?.displayName || command.deviceId,
    platform: agent?.platform || null,
  };
}

function resolveCommandTargetAgent(state, payload, actor, commandType) {
  const deviceId = normalizeOptionalString(payload.deviceId);
  const target = normalizeOptionalString(payload.target || payload.targetAlias);
  const targetUserId = normalizeOptionalString(payload.userId || payload.targetUserId);
  const accessibleUserIds = new Set(listAccessibleUserIds(state, actor));
  const agents = (state.deviceAgents || []).filter((agent) => accessibleUserIds.has(agent.userId));

  if (deviceId) {
    const agent = agents.find((item) => item.deviceId === deviceId);
    if (!agent) {
      throw validation("Device is not accessible or not registered", { deviceId });
    }
    return agent;
  }

  if (target) {
    const matchedAgents = agents.filter((item) =>
      deviceAgentAliases(item).some((alias) => normalizeSearchToken(alias) === normalizeSearchToken(target)),
    );
    const matchedUserId = resolveTargetUserId(state, actor, target);
    const candidates = matchedUserId
      ? uniqueAgents([...matchedAgents, ...agents.filter((item) => item.userId === matchedUserId)])
      : matchedAgents;
    const agent = sortCommandTargetAgents(candidates, commandType)[0];
    if (agent) {
      return agent;
    }
  }

  const userId = targetUserId || resolveTargetUserId(state, actor, target) || actor.id;
  assertCanAccessUser(state, actor, userId);
  const agent = agents
    .filter((item) => item.userId === userId)
    .sort((a, b) => compareCommandTargetAgents(a, b, commandType))[0];
  if (!agent) {
    throw validation("Target user has no registered device agents", { userId });
  }
  return agent;
}

function uniqueAgents(agents) {
  const seen = new Set();
  return agents.filter((agent) => {
    const key = agent.deviceId || agent.id;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// A device is "reachable" only while its OpenClaw app is running and sending
// heartbeats (every ~60s). The stored status field stays "online" even after the
// app is closed, so reachability is decided by lastSeenAt freshness instead.
export const DEVICE_ONLINE_MAX_STALE_MS = 3 * 60 * 1000;

export function isDeviceOnline(agent, now = new Date(), maxStaleMs = DEVICE_ONLINE_MAX_STALE_MS) {
  const last = new Date(agent?.lastSeenAt || 0).getTime();
  if (!Number.isFinite(last) || last === 0) {
    return false;
  }
  return now.getTime() - last <= maxStaleMs;
}

export function describeDeviceLastSeen(agent, now = new Date()) {
  const last = new Date(agent?.lastSeenAt || 0).getTime();
  if (!Number.isFinite(last) || last === 0) {
    return "сигналов ещё не было";
  }
  const sec = Math.max(0, Math.round((now.getTime() - last) / 1000));
  if (sec < 60) {
    return `${sec} сек назад`;
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min} мин назад`;
  }
  const hours = Math.round(min / 60);
  return `${hours} ч назад`;
}

function sortCommandTargetAgents(agents, commandType) {
  return [...agents].sort((a, b) => compareCommandTargetAgents(a, b, commandType));
}

function compareCommandTargetAgents(a, b, commandType) {
  const scoreDelta = commandTargetScore(b, commandType) - commandTargetScore(a, commandType);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  return String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""));
}

function commandTargetScore(agent, commandType) {
  let score = 0;
  if (agent.status === "online") {
    score += 100;
  }
  if (agentHasCapability(agent, "command-polling")) {
    score += 50;
  }
  if (commandType && agentHasCapability(agent, commandType)) {
    score += 25;
  }
  return score;
}

function assertAgentCanExecuteCommand(agent, commandType) {
  if (!agentHasCapability(agent, "command-polling") || !agentHasCapability(agent, commandType)) {
    throw validation("Target device cannot execute this command", {
      deviceId: agent.deviceId,
      commandType,
      capabilities: agent.capabilities || [],
    });
  }
}

function agentHasCapability(agent, capability) {
  return (agent.capabilities || []).includes(capability);
}

function resolveTargetUserId(state, actor, target) {
  const normalized = normalizeSearchToken(target);
  if (!normalized) {
    return null;
  }
  const accessibleUserIds = new Set(listAccessibleUserIds(state, actor));
  const user = (state.users || []).find((candidate) => {
    if (!accessibleUserIds.has(candidate.id)) {
      return false;
    }
    return userAliases(candidate).some((alias) => normalizeSearchToken(alias) === normalized);
  });
  return user?.id || null;
}

function userAliases(user) {
  return [
    user.id,
    user.employeeId,
    user.displayName,
    user.displayName?.replace(/\s+/gu, ""),
    user.id?.replace(/^u-/u, ""),
    user.employeeId?.replace(/-/gu, ""),
  ].filter(Boolean);
}

function deviceAgentAliases(agent) {
  return [
    agent.deviceId,
    agent.displayName,
    agent.hostname,
    agent.labels?.person,
    agent.labels?.role,
  ].filter(Boolean);
}

function normalizeSearchToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_@.]+/gu, "")
    .replace(/-/gu, "");
}

function ensureDeviceCommands(state) {
  if (!Array.isArray(state.deviceCommands)) {
    state.deviceCommands = [];
  }
}

function expireDeviceCommands(state, { now = new Date() } = {}) {
  const nowMs = now.getTime();
  for (const command of state.deviceCommands || []) {
    const expiresAt = new Date(command.expiresAt || 0).getTime();
    const claimedAt = new Date(command.claimedAt || 0).getTime();
    if (command.status === "queued" && Number.isFinite(expiresAt) && expiresAt < nowMs) {
      command.status = "expired";
      command.updatedAt = now.toISOString();
      command.error = "Command expired before a device claimed it";
    }
    if (command.status === "claimed" && Number.isFinite(claimedAt) && nowMs - claimedAt > CLAIM_TIMEOUT_MS) {
      command.status = "queued";
      command.claimedAt = null;
      command.updatedAt = now.toISOString();
    }
  }
}

function pruneDeviceCommands(state) {
  if (state.deviceCommands.length <= MAX_COMMANDS) {
    return;
  }
  state.deviceCommands = state.deviceCommands
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, MAX_COMMANDS);
}

function normalizeTtlSeconds(value) {
  const seconds = Number(value || DEFAULT_COMMAND_TTL_SECONDS);
  if (!Number.isFinite(seconds)) {
    return DEFAULT_COMMAND_TTL_SECONDS;
  }
  return Math.min(Math.max(Math.round(seconds), 30), 3600);
}

function normalizeCommandArgs(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return normalizeJsonObject(value, { depth: 0 });
}

function normalizeCommandResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value === null ? null : normalizeJsonScalar(value);
  }
  return normalizeJsonObject(value, { depth: 0, allowLargeStrings: true });
}

function normalizeJsonObject(value, { depth, allowLargeStrings = false }) {
  if (depth > 4) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [normalizeOptionalString(key), normalizeJsonValue(item, { depth: depth + 1, allowLargeStrings })])
      .filter(([key, item]) => key && item !== undefined)
      .slice(0, 80),
  );
}

function normalizeJsonValue(value, { depth, allowLargeStrings }) {
  if (value === null || value === undefined) {
    return value === null ? null : undefined;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((item) => normalizeJsonValue(item, { depth: depth + 1, allowLargeStrings }));
  }
  if (typeof value === "object") {
    return normalizeJsonObject(value, { depth, allowLargeStrings });
  }
  return normalizeJsonScalar(value, { allowLargeStrings });
}

function normalizeJsonScalar(value, { allowLargeStrings = false } = {}) {
  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  const limit = allowLargeStrings ? MAX_RESULT_STRING : MAX_STRING;
  return String(value).slice(0, limit);
}

function hashDeviceAgentToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeRequiredString(value, name) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw validation(`${name} is required`);
  }
  return normalized;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, MAX_STRING);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeOptionalString)
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeLabels(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, labelValue]) => [normalizeOptionalString(key), normalizeOptionalString(labelValue)])
      .filter(([key, labelValue]) => key && labelValue)
      .slice(0, 30),
  );
}
