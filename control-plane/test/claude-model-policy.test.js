import assert from "node:assert/strict";
import test from "node:test";
import {
  applyClaudeModelPolicyToEnv,
  buildClaudeModelPolicy,
} from "../src/setup/claude-model-policy.js";

test("Claude model policy puts the assistant on Opus, memory on Sonnet, OpenClaw on Sonnet", () => {
  const policy = buildClaudeModelPolicy();

  assert.equal(policy.enforced, true);
  assert.equal(policy.claudeModel, "claude-opus-4-8");
  assert.equal(policy.assistantModel, "claude-opus-4-8");
  assert.equal(policy.memoryModel, "claude-sonnet-4-6");
  assert.equal(policy.openClawModel, "anthropic/claude-sonnet-4-6");
  assert.equal(
    policy.openClawConfig.agents.defaults.model.primary,
    "anthropic/claude-sonnet-4-6",
  );
  assert.deepEqual(policy.openClawConfig.agents.defaults.model.fallbacks, []);
});

test("Claude model policy applies assistant + memory env and keeps OpenClaw on Sonnet", () => {
  const env = {
    ANTHROPIC_MODEL: "claude-3-5-sonnet-20241022",
    OPENCLAW_DEFAULT_MODEL: "anthropic/claude-3-5-sonnet-20241022",
  };

  applyClaudeModelPolicyToEnv(env);

  assert.equal(env.CLAUDE_MODEL, "claude-opus-4-8");
  assert.equal(env.CLAUDE_MEMORY_MODEL, "claude-sonnet-4-6");
  assert.equal(env.ANTHROPIC_MODEL, "claude-sonnet-4-6");
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, "claude-sonnet-4-6");
  assert.equal(env.OPENCLAW_DEFAULT_MODEL, "anthropic/claude-sonnet-4-6");
});
