import test from "node:test";
import assert from "node:assert/strict";
import { requireActor } from "../src/api/router.js";

const state = { users: [{ id: "u1", telegram: { telegramUserId: "777" } }] };
const req = (headers) => ({ headers });

test("requireActor: internal token disabled by default (backward compatible)", () => {
  const actor = requireActor(state, req({ "x-actor-telegram-id": "777" }), {});
  assert.equal(actor.id, "u1");
});

test("requireActor: enforces X-Internal-Token when CONTROL_PLANE_INTERNAL_TOKEN is set", () => {
  const env = { CONTROL_PLANE_INTERNAL_TOKEN: "s3cret" };
  // missing token -> rejected
  assert.throws(() => requireActor(state, req({ "x-actor-telegram-id": "777" }), env), /X-Internal-Token/);
  // wrong token -> rejected
  assert.throws(
    () => requireActor(state, req({ "x-actor-telegram-id": "777", "x-internal-token": "nope" }), env),
    /X-Internal-Token/,
  );
  // correct token -> allowed
  const actor = requireActor(state, req({ "x-actor-telegram-id": "777", "x-internal-token": "s3cret" }), env);
  assert.equal(actor.id, "u1");
});
