import assert from "node:assert/strict";
import test from "node:test";
import {
  applyClaudeModelPolicyToEnv,
  buildClaudeModelPolicy,
} from "../src/setup/claude-model-policy.js";

test("Claude model policy pins latest Sonnet for Claude env and OpenClaw config", () => {
  const policy = buildClaudeModelPolicy();

  assert.equal(policy.enforced, true);
  assert.equal(policy.claudeModel, "claude-sonnet-4-6");
  assert.equal(policy.openClawModel, "anthropic/claude-sonnet-4-6");
  assert.equal(
    policy.openClawConfig.agents.defaults.model.primary,
    "anthropic/claude-sonnet-4-6",
  );
  assert.deepEqual(policy.openClawConfig.agents.defaults.model.fallbacks, []);
});

test("Claude model policy overwrites stale model environment values", () => {
  const env = {
    ANTHROPIC_MODEL: "claude-3-5-sonnet-20241022",
    OPENCLAW_DEFAULT_MODEL: "anthropic/claude-3-5-sonnet-20241022",
  };

  applyClaudeModelPolicyToEnv(env);

  assert.equal(env.ANTHROPIC_MODEL, "claude-sonnet-4-6");
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, "claude-sonnet-4-6");
  assert.equal(env.OPENCLAW_DEFAULT_MODEL, "anthropic/claude-sonnet-4-6");
});
