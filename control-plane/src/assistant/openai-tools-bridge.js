// Translate between the OpenAI tool-calling wire format (what the desktop agent speaks) and
// Anthropic's messages/tools format (what claudeClient.sendMessages speaks). This lets the
// /v1/chat/completions endpoint act as a real tool-calling agent turn — the client runs the
// tools and sends results back — without touching the RAG assistant path.

/** OpenAI `tools` → Anthropic `tools`. */
export function toAnthropicTools(openaiTools) {
  if (!Array.isArray(openaiTools)) return [];
  const out = [];
  for (const t of openaiTools) {
    const fn = t?.function || t;
    if (!fn?.name) continue;
    out.push({
      name: String(fn.name),
      description: fn.description ? String(fn.description) : "",
      input_schema: fn.parameters && typeof fn.parameters === "object" ? fn.parameters : { type: "object", properties: {} },
    });
  }
  return out;
}

/** OpenAI `tool_choice` → Anthropic `tool_choice`. */
export function toAnthropicToolChoice(choice) {
  if (!choice || choice === "auto") return undefined;
  if (choice === "required") return { type: "any" };
  if (choice === "none") return undefined;
  if (typeof choice === "object" && choice.function?.name) {
    return { type: "tool", name: String(choice.function.name) };
  }
  return undefined;
}

/** OpenAI messages → { system, messages } in Anthropic shape (tool_calls / tool results mapped). */
export function toAnthropicMessages(openaiMessages) {
  const systemParts = [];
  const messages = [];

  const pushToolResult = (block) => {
    // tool results must ride in a user message; merge consecutive ones into the last user turn
    const last = messages[messages.length - 1];
    if (last && last.role === "user" && Array.isArray(last.content)) {
      last.content.push(block);
    } else {
      messages.push({ role: "user", content: [block] });
    }
  };

  for (const msg of Array.isArray(openaiMessages) ? openaiMessages : []) {
    const role = msg?.role;
    if (role === "system") {
      if (msg.content) systemParts.push(String(msg.content));
      continue;
    }
    if (role === "tool") {
      pushToolResult({
        type: "tool_result",
        tool_use_id: String(msg.tool_call_id || ""),
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? ""),
      });
      continue;
    }
    if (role === "assistant") {
      const content = [];
      if (msg.content) content.push({ type: "text", text: String(msg.content) });
      for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
        content.push({
          type: "tool_use",
          id: String(tc.id || ""),
          name: String(tc.function?.name || ""),
          input: safeParse(tc.function?.arguments),
        });
      }
      messages.push({ role: "assistant", content: content.length ? content : "" });
      continue;
    }
    // user (string or already-blocks)
    messages.push({ role: "user", content: typeof msg?.content === "string" ? msg.content : msg?.content ?? "" });
  }

  return { system: systemParts.join("\n\n") || undefined, messages };
}

/** Anthropic response payload → OpenAI chat.completion object. */
export function toOpenAiResponse(payload, model) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const text = blocks
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("");
  const toolCalls = blocks
    .filter((b) => b?.type === "tool_use")
    .map((b) => ({
      id: String(b.id || `call_${Math.random().toString(36).slice(2)}`),
      type: "function",
      function: { name: String(b.name || ""), arguments: JSON.stringify(b.input ?? {}) },
    }));

  const finish = payload?.stop_reason === "tool_use" ? "tool_calls" : payload?.stop_reason === "max_tokens" ? "length" : "stop";
  const message = { role: "assistant", content: text || null };
  if (toolCalls.length) message.tool_calls = toolCalls;

  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model || payload?.model || "starlab-agent",
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: {
      prompt_tokens: payload?.usage?.input_tokens ?? 0,
      completion_tokens: payload?.usage?.output_tokens ?? 0,
      total_tokens: (payload?.usage?.input_tokens ?? 0) + (payload?.usage?.output_tokens ?? 0),
    },
  };
}

/** Run one tool-calling turn: OpenAI body in → claudeClient.sendMessages → OpenAI response out. */
export async function runAgentTurn({ claudeClient, body }) {
  const { system, messages } = toAnthropicMessages(body?.messages);
  const tools = toAnthropicTools(body?.tools);
  const toolChoice = toAnthropicToolChoice(body?.tool_choice);
  const payload = await claudeClient.sendMessages({
    system,
    messages,
    tools,
    toolChoice,
    maxTokens: Number(body?.max_tokens) > 0 ? Number(body.max_tokens) : 2048,
  });
  return toOpenAiResponse(payload, typeof body?.model === "string" && body.model ? body.model : undefined);
}

function safeParse(value) {
  if (value == null) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}
