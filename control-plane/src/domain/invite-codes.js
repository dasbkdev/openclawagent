import crypto from "node:crypto";
import { validation } from "./errors.js";
import { assertCanIssueInvite, getUserById } from "./policy.js";
import { isKnownRole } from "./roles.js";

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateInviteCode(length = 8) {
  let code = "";
  const bytes = crypto.randomBytes(length);
  for (const byte of bytes) {
    code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
  }
  return code;
}

export function hashInviteCode(code) {
  return crypto.createHash("sha256").update(normalizeInviteCode(code)).digest("hex");
}

export function normalizeInviteCode(code) {
  if (typeof code !== "string" || !code.trim()) {
    throw validation("Invite code is required");
  }
  return code.trim().toUpperCase();
}

export function createInviteCode(state, { issuer, userId, ttlMinutes = 60, code = undefined }) {
  assertCanIssueInvite(issuer);

  const targetUser = getUserById(state, userId);
  if (!isKnownRole(targetUser.role)) {
    throw validation("Target user has unknown role", { userId, role: targetUser.role });
  }

  const normalizedTtl = Number(ttlMinutes);
  if (!Number.isInteger(normalizedTtl) || normalizedTtl < 1 || normalizedTtl > 24 * 60) {
    throw validation("ttlMinutes must be an integer between 1 and 1440");
  }

  const rawCode = resolveUniqueInviteCode(state, code);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + normalizedTtl * 60 * 1000).toISOString();
  const invite = {
    id: crypto.randomUUID(),
    codeHash: hashInviteCode(rawCode),
    codeLast4: rawCode.slice(-4),
    userId: targetUser.id,
    role: targetUser.role,
    displayName: targetUser.displayName,
    issuedByUserId: issuer.id,
    issuedAt: now.toISOString(),
    expiresAt,
    usedAt: null,
    usedByTelegramUserId: null,
    revokedAt: null,
  };

  state.inviteCodes.push(invite);
  return { invite, code: rawCode };
}

export function reissueInviteCode(state, { issuer, userId, ttlMinutes = 1440, code = undefined, now = new Date() }) {
  assertCanIssueInvite(issuer);

  const targetUser = getUserById(state, userId);
  const revokedInvites = revokeActiveInviteCodesForUser(state, {
    issuer,
    userId: targetUser.id,
    reason: "reissued",
    now,
  });
  const created = createInviteCode(state, {
    issuer,
    userId: targetUser.id,
    ttlMinutes,
    code,
  });

  return {
    ...created,
    targetUser,
    revokedInvites,
    revokedCount: revokedInvites.length,
  };
}

export function revokeActiveInviteCodesForUser(state, { issuer, userId, reason = "revoked", now = new Date() }) {
  assertCanIssueInvite(issuer);

  const targetUser = getUserById(state, userId);
  const nowTime = now.getTime();
  const nowIso = now.toISOString();
  const revoked = [];

  for (const invite of state.inviteCodes) {
    if (invite.userId !== targetUser.id || invite.revokedAt) {
      continue;
    }
    if (new Date(invite.expiresAt).getTime() < nowTime) {
      continue;
    }

    invite.revokedAt = nowIso;
    invite.revokedByUserId = issuer.id;
    invite.revokedReason = reason;
    revoked.push(invite);
  }

  return revoked;
}

function resolveUniqueInviteCode(state, requestedCode) {
  if (requestedCode) {
    const normalized = normalizeInviteCode(requestedCode);
    if (state.inviteCodes.some((invite) => invite.codeHash === hashInviteCode(normalized))) {
      throw validation("Invite code already exists");
    }
    return normalized;
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const generated = generateInviteCode();
    if (!state.inviteCodes.some((invite) => invite.codeHash === hashInviteCode(generated))) {
      return generated;
    }
  }

  throw validation("Could not generate unique invite code");
}

export function redeemInviteCode(state, { code, telegramUserId, username = undefined }) {
  const normalizedCode = normalizeInviteCode(code);
  const normalizedTelegramId = normalizeTelegramUserId(telegramUserId);
  const codeHash = hashInviteCode(normalizedCode);
  const now = new Date();

  const invite = state.inviteCodes.find((item) => item.codeHash === codeHash);
  if (!invite) {
    throw validation("Invite code is invalid");
  }
  if (invite.revokedAt) {
    throw validation("Invite code has been revoked");
  }
  if (invite.usedAt) {
    throw validation("Invite code has already been used");
  }
  if (new Date(invite.expiresAt).getTime() < now.getTime()) {
    throw validation("Invite code has expired");
  }

  const linkedUser = state.users.find((user) => user.telegram?.telegramUserId === normalizedTelegramId);
  if (linkedUser && linkedUser.id !== invite.userId) {
    throw validation("Telegram account is already linked to another user");
  }

  const user = getUserById(state, invite.userId);
  if (user.telegram?.telegramUserId && user.telegram.telegramUserId !== normalizedTelegramId) {
    throw validation("User is already linked to another Telegram account");
  }

  user.telegram = {
    telegramUserId: normalizedTelegramId,
    username: typeof username === "string" && username.trim() ? username.trim() : null,
    linkedAt: now.toISOString(),
  };

  invite.usedAt = now.toISOString();
  invite.usedByTelegramUserId = normalizedTelegramId;

  return { invite, user };
}

function normalizeTelegramUserId(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw validation("telegramUserId is required");
  }
  const normalized = String(value).trim();
  if (!normalized) {
    throw validation("telegramUserId is required");
  }
  return normalized;
}
