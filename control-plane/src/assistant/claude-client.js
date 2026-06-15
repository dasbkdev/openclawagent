const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

export function createClaudeClientFromEnv(env = process.env) {
  const apiKey = env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY;
  const model = env.CLAUDE_MODEL || "claude-sonnet-4-6";
  if (!apiKey) {
    return new MissingClaudeClient({ model });
  }
  // Long structured answers (maxTokens 3000) can take well over 30s to
  // generate; the old 30s default aborted them mid-flight.
  const timeoutMs = Number(env.CLAUDE_TIMEOUT_MS || 120000);
  return new HttpClaudeClient({ apiKey, model, timeoutMs });
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

  async sendMessages() {
    return {
      content: [{ type: "text", text: "Claude API key is not configured." }],
      stop_reason: "end_turn",
      model: this.model,
      usage: null,
    };
  }

  async researchWeb() {
    return { text: "", sources: [], model: this.model, usage: null, configured: false };
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
    const requestModel = model || this.model;
    const payload = await this.sendMessages({
      system,
      messages: [{ role: "user", content: user }],
      maxTokens,
      model: requestModel,
    });
    return {
      text: readTextContent(payload),
      model: payload.model || requestModel,
      usage: normalizeUsage(payload.usage),
      stopReason: payload.stop_reason || null,
      configured: true,
    };
  }

  /**
   * Research a question against the live web using Anthropic's server-side
   * web_search + web_fetch tools. Anthropic runs the search/fetch; we only
   * declare the tools and loop on `pause_turn` until the model is done.
   * Returns the answer text plus the source URLs it consulted.
   *
   * Web tools are billed per use — callers gate when to invoke this.
   */
  async researchWeb({ system, user, maxTokens = 2500, model, maxRounds = 4, timeoutMs }) {
    const requestModel = model || this.model;
    const previousTimeout = this.timeoutMs;
    if (timeoutMs) {
      this.timeoutMs = timeoutMs;
    }
    const tools = [
      { type: "web_search_20260209", name: "web_search" },
      { type: "web_fetch_20260209", name: "web_fetch" },
    ];
    const messages = [{ role: "user", content: user }];
    let payload = null;
    try {
      for (let round = 0; round < maxRounds; round += 1) {
        payload = await this.sendMessages({ system, messages, tools, maxTokens, model: requestModel });
        if (payload.stop_reason === "pause_turn") {
          // Server-side tool loop hit its limit; re-send to resume.
          messages.push({ role: "assistant", content: payload.content });
          continue;
        }
        break;
      }
    } finally {
      this.timeoutMs = previousTimeout;
    }
    return {
      text: readTextContent(payload),
      sources: extractWebSources(payload),
      model: payload?.model || requestModel,
      usage: normalizeUsage(payload?.usage),
      stopReason: payload?.stop_reason || null,
      configured: true,
    };
  }

  /**
   * Low-level Messages API call supporting multi-turn conversations and
   * tool use. Returns the raw payload so callers (the agent loop) can read
   * content blocks (text + tool_use) and stop_reason directly.
   */
  async sendMessages({ system, messages, tools, toolChoice, maxTokens = 1500, model }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const requestModel = model || this.model;
    try {
      const body = {
        model: requestModel,
        max_tokens: maxTokens,
        messages,
      };
      if (system) {
        body.system = system;
      }
      if (Array.isArray(tools) && tools.length > 0) {
        body.tools = tools;
      }
      if (toolChoice) {
        body.tool_choice = toolChoice;
      }
      const response = await fetch(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
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
      return payload;
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

/**
 * Pull the list of web sources (url + title) Claude consulted from a
 * web_search/web_fetch response — from web_search_tool_result blocks,
 * web_fetch_tool_result blocks, and text-block citations.
 */
export function extractWebSources(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const seen = new Set();
  const sources = [];
  const add = (url, title) => {
    const cleanUrl = typeof url === "string" ? url.trim() : "";
    if (!cleanUrl || seen.has(cleanUrl)) {
      return;
    }
    seen.add(cleanUrl);
    sources.push({ url: cleanUrl, title: typeof title === "string" ? title.trim() : "" });
  };
  for (const block of blocks) {
    if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const item of block.content) {
        add(item?.url, item?.title);
      }
    }
    if (block?.type === "web_fetch_tool_result") {
      const doc = block.content?.content ?? block.content;
      add(doc?.url || block.content?.url, doc?.title || block.content?.title);
    }
    if (block?.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) {
        add(c?.url, c?.title);
      }
    }
  }
  return sources.slice(0, 12);
}

export function extractToolUseBlocks(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  return blocks
    .filter((block) => block?.type === "tool_use")
    .map((block) => ({ id: block.id, name: block.name, input: block.input || {} }));
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
