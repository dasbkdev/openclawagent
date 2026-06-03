import assert from "node:assert/strict";
import test from "node:test";
import { createInviteCode, redeemInviteCode } from "../src/domain/invite-codes.js";
import { getUserById } from "../src/domain/policy.js";
import { createInitialState } from "../src/infra/seed.js";

test("OWNER can create and redeem one-time invite code", () => {
  const state = createInitialState();
  const owner = getUserById(state, "u-nikolay");
  const { code, invite } = createInviteCode(state, {
    issuer: owner,
    userId: "u-maksat",
    code: "ABCD2345",
  });

  assert.equal(code, "ABCD2345");
  assert.equal(invite.userId, "u-maksat");
  assert.equal(invite.usedAt, null);

  const redeemed = redeemInviteCode(state, {
    code: "abcd2345",
    telegramUserId: "tg-maksat",
    username: "maksat",
  });

  assert.equal(redeemed.user.telegram.telegramUserId, "tg-maksat");
  assert.ok(redeemed.invite.usedAt);
  assert.throws(() => redeemInviteCode(state, { code, telegramUserId: "tg-again" }), /already been used/);
});

test("SENIOR_PM cannot create invite code", () => {
  const state = createInitialState();
  const maksat = getUserById(state, "u-maksat");
  assert.throws(
    () => createInviteCode(state, { issuer: maksat, userId: "u-pm-1" }),
    /Only OWNER can issue/,
  );
});

test("invite code cannot be duplicated", () => {
  const state = createInitialState();
  const owner = getUserById(state, "u-nikolay");
  createInviteCode(state, { issuer: owner, userId: "u-pm-1", code: "SAME2222" });
  assert.throws(
    () => createInviteCode(state, { issuer: owner, userId: "u-pm-2", code: "SAME2222" }),
    /already exists/,
  );
});
