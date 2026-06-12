const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

export function createClaudeClientFromEnv(env = process.env) {
  const apiKey = env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY;
  const model = env.CLAUDE_MODEL || "claude-sonnet-4-6";
  if (!apiKey) {
    return new MissingClaudeClient({ model });
  }
  return new HttpClaudeClient({ apiKey, model });
}

export class MissingClaudeClient {
  constructor({ model = "claude-sonnet-4-6" } = {}) {
    this.model = model;
    this.configured = false;
  }

  async complete() {
    return {
      text: [
        "Claude API key еще не настроен.",
        "Сохрани ключ Claude в мастере настройки, и после этого можно будет задавать обычные вопросы в Telegram.",
      ].join(" "),
      model: this.model,
      usage: null,
      configured: false,
    };
  }

  async healthCheck() {
    return {
      ok: false,
      configured: false,
      model: this.model,
      status: null,
      message: "Claude API key is not configured.",
    };
  }
}

export class HttpClaudeClient {
  constructor({
    apiKey,
    model = "claude-sonnet-4-6",
    endpoint = "https://api.anthropic.com/v1/messages",
    timeoutMs = 30000,
  }) {
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
    this.configured = true;
  }

  async complete({ system, user, maxTokens = 900, model }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const requestModel = model || this.model;
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: requestModel,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });

      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new ClaudeApiError({
          status: response.status,
          message: payload?.error?.message || `Claude API request failed: HTTP ${response.status}`,
          type: payload?.error?.type || null,
          requestId: response.headers.get("request-id") || response.headers.get("x-request-id") || null,
        });
      }

      return {
        text: readTextContent(payload),
        model: payload.model || requestModel,
        usage: normalizeUsage(payload.usage),
        stopReason: payload.stop_reason || null,
        configured: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck() {
    try {
      const completion = await this.complete({
        system: "Reply with exactly OK.",
        user: "ping",
        maxTokens: 8,
      });
      return {
        ok: true,
        configured: true,
        model: completion.model || this.model,
        status: 200,
        message: "Claude API is available.",
      };
    } catch (error) {
      if (error instanceof ClaudeApiError) {
        return {
          ok: false,
          configured: true,
          model: this.model,
          status: error.status,
          type: error.type,
          requestId: error.requestId,
          message: error.message,
        };
      }
      return {
        ok: false,
        configured: true,
        model: this.model,
        status: null,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class ClaudeApiError extends Error {
  constructor({ status, message, type = null, requestId = null }) {
    super(message);
    this.name = "ClaudeApiError";
    this.status = status;
    this.type = type;
    this.requestId = requestId;
  }
}

function readTextContent(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const text = blocks
    .filter((block) => block?.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text || "Claude returned an empty response.";
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return null;
  }
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    cacheReadTokens: Number(usage.cache_read_input_tokens || 0),
    cacheWriteTokens: Number(usage.cache_creation_input_tokens || 0),
  };
}
