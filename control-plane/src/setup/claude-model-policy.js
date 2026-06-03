export const CLAUDE_LATEST_SONNET_MODEL = "claude-sonnet-4-6";
export const OPENCLAW_LATEST_SONNET_MODEL = `anthropic/${CLAUDE_LATEST_SONNET_MODEL}`;

export function buildClaudeModelPolicy() {
  return {
    enforced: true,
    family: "sonnet",
    sourceCheckedAt: "2026-06-02",
    claudeModel: CLAUDE_LATEST_SONNET_MODEL,
    openClawModel: OPENCLAW_LATEST_SONNET_MODEL,
    env: {
      ANTHROPIC_MODEL: CLAUDE_LATEST_SONNET_MODEL,
      ANTHROPIC_DEFAULT_SONNET_MODEL: CLAUDE_LATEST_SONNET_MODEL,
      CLAUDE_MODEL: CLAUDE_LATEST_SONNET_MODEL,
      OPENCLAW_DEFAULT_MODEL: OPENCLAW_LATEST_SONNET_MODEL,
    },
    openClawConfig: {
      agents: {
        defaults: {
          model: {
            primary: OPENCLAW_LATEST_SONNET_MODEL,
            fallbacks: [],
          },
          models: {
            [OPENCLAW_LATEST_SONNET_MODEL]: {
              alias: "Sonnet",
            },
          },
        },
      },
    },
  };
}

export function applyClaudeModelPolicyToEnv(env = process.env) {
  const policy = buildClaudeModelPolicy();
  for (const [key, value] of Object.entries(policy.env)) {
    env[key] = value;
  }
  return policy;
}
