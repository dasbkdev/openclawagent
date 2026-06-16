// The Telegram assistant runs on Opus (best reasoning + memory handling); the
// memory distiller runs on Sonnet (was Haiku); the vendored OpenClaw desktop
// agents stay on the latest Sonnet (separate product, untouched).
export const CLAUDE_ASSISTANT_MODEL = "claude-opus-4-8";
export const CLAUDE_MEMORY_MODEL = "claude-sonnet-4-6";
export const CLAUDE_LATEST_SONNET_MODEL = "claude-sonnet-4-6";
export const OPENCLAW_LATEST_SONNET_MODEL = `anthropic/${CLAUDE_LATEST_SONNET_MODEL}`;

export function buildClaudeModelPolicy() {
  return {
    enforced: true,
    family: "opus",
    sourceCheckedAt: "2026-06-16",
    claudeModel: CLAUDE_ASSISTANT_MODEL,
    assistantModel: CLAUDE_ASSISTANT_MODEL,
    memoryModel: CLAUDE_MEMORY_MODEL,
    openClawModel: OPENCLAW_LATEST_SONNET_MODEL,
    env: {
      // control-plane assistant (claude-client reads CLAUDE_MODEL)
      CLAUDE_MODEL: CLAUDE_ASSISTANT_MODEL,
      // memory distiller (memory-distiller reads CLAUDE_MEMORY_MODEL)
      CLAUDE_MEMORY_MODEL: CLAUDE_MEMORY_MODEL,
      // OpenClaw desktop agents stay on Sonnet
      ANTHROPIC_MODEL: CLAUDE_LATEST_SONNET_MODEL,
      ANTHROPIC_DEFAULT_SONNET_MODEL: CLAUDE_LATEST_SONNET_MODEL,
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
