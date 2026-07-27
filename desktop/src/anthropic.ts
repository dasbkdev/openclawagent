// Direct Anthropic (Claude) provider — SAI talks to the Messages API itself, with native
// streaming, tool-calling and vision. This makes SAI a self-contained local agent that does
// not depend on the brain bridge. The webview is allowed to call the API directly via the
// `anthropic-dangerous-direct-browser-access` header.

import { invoke } from "@tauri-apps/api/core";
import { type AgentMessage, type BrainSettings, type ToolDef } from "./api";
import { type AgentCallbacks, DESTRUCTIVE, TOOLS, describeCall, executeTool } from "./agent";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const MAX_STEPS = 16;
const MAX_TOKENS = 8192;

export type ImageInput = { mediaType: string; dataB64: string };

type AnthropicTool = { name: string; description: string; input_schema: Record<string, unknown> };
type TextBlock = { type: "text"; text: string };
type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
// tool_result content is a plain string, except for see_screen which returns image blocks
// so Claude actually sees the pixels (native vision over a tool result).
type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<TextBlock | ImageBlock>;
};
type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;
type Msg = { role: "user" | "assistant"; content: ContentBlock[] };

/** OpenAI-shaped tool defs -> Anthropic tool defs. */
export function toAnthropicTools(tools: ToolDef[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

/** Split the bridge-style history into a system string + Anthropic messages. */
function buildMessages(history: AgentMessage[], images?: ImageInput[]): { system: string; messages: Msg[] } {
  let system = "";
  const messages: Msg[] = [];
  for (const m of history) {
    if (m.role === "system") {
      system += (system ? "\n\n" : "") + (m.content ?? "");
      continue;
    }
    if (m.role === "tool") continue; // tool turns are managed inside the loop, not replayed
    const role = m.role === "assistant" ? "assistant" : "user";
    messages.push({ role, content: [{ type: "text", text: m.content ?? "" }] });
  }
  // Attach images to the final user turn (vision).
  if (images && images.length) {
    const last = [...messages].reverse().find((m) => m.role === "user");
    if (last) {
      for (const img of images) {
        last.content.unshift({
          type: "image",
          source: { type: "base64", media_type: img.mediaType, data: img.dataB64 },
        });
      }
    }
  }
  return { system, messages };
}

type StreamOut = { text: string; toolUses: { id: string; name: string; input: string }[]; stopReason: string };

/** One streamed request. Emits text via onText; accumulates any tool_use blocks. */
async function streamOnce(
  settings: BrainSettings,
  system: string,
  messages: Msg[],
  tools: AnthropicTool[],
  onText: (t: string) => void,
  signal?: AbortSignal,
): Promise<StreamOut> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": API_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: MAX_TOKENS,
      stream: true,
      system,
      messages,
      ...(tools.length ? { tools } : {}),
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const blocks: { type: string; name?: string; id?: string; json: string }[] = [];
  let stopReason = "";

  const handle = (evt: string, data: Record<string, unknown>) => {
    if (evt === "content_block_start") {
      const cb = data.content_block as Record<string, unknown>;
      const i = data.index as number;
      blocks[i] = { type: String(cb.type), name: cb.name as string, id: cb.id as string, json: "" };
    } else if (evt === "content_block_delta") {
      const d = data.delta as Record<string, unknown>;
      const i = data.index as number;
      if (d.type === "text_delta") onText(String(d.text ?? ""));
      else if (d.type === "input_json_delta" && blocks[i]) blocks[i].json += String(d.partial_json ?? "");
    } else if (evt === "message_delta") {
      const d = data.delta as Record<string, unknown>;
      if (d.stop_reason) stopReason = String(d.stop_reason);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      let evt = "";
      let dataLine = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) evt = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
      }
      if (!dataLine) continue;
      try {
        handle(evt, JSON.parse(dataLine));
      } catch {
        // partial/keepalive — ignore
      }
    }
  }

  const toolUses = blocks
    .filter((b) => b && b.type === "tool_use")
    .map((b) => ({ id: b.id ?? "", name: b.name ?? "", input: b.json || "{}" }));
  const text = ""; // text was streamed live; not needed for the transcript
  return { text, toolUses, stopReason };
}

/** Run the agent against Claude directly until it answers. Mirrors runAgent's callbacks. */
export async function runAnthropicAgent(
  settings: BrainSettings,
  history: AgentMessage[],
  cb: AgentCallbacks,
  images?: ImageInput[],
): Promise<void> {
  if (!settings.apiKey) {
    cb.onText("⚠️ Не задан Anthropic API-ключ. Открой ⚙ и вставь ключ.");
    return;
  }
  const tools = toAnthropicTools(TOOLS);
  const { system, messages } = buildMessages(history, images);

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (cb.signal?.aborted) return;
    const out = await streamOnce(settings, system, messages, tools, cb.onText, cb.signal);

    if (out.stopReason !== "tool_use" || out.toolUses.length === 0) return;

    // Record the assistant's tool_use blocks, then execute and answer each.
    const assistantBlocks: ContentBlock[] = out.toolUses.map((t) => ({
      type: "tool_use",
      id: t.id,
      name: t.name,
      input: safeParse(t.input),
    }));
    messages.push({ role: "assistant", content: assistantBlocks });

    const results: ContentBlock[] = [];
    for (const call of out.toolUses) {
      const args = safeParse(call.input) as Record<string, unknown>;
      // see_screen: capture the screen and hand the actual image back to the model (vision),
      // not a file path. Read-only, so it never needs approval.
      if (call.name === "see_screen") {
        cb.onStep("🛠 see_screen()");
        try {
          const content = await captureScreenBlocks();
          results.push({ type: "tool_result", tool_use_id: call.id, content });
          cb.onStep("↳ 👁 экран передан на анализ");
        } catch (e) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: `не удалось захватить экран: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
        continue;
      }
      cb.onStep(`🛠 ${call.name}(${short(call.input)})`);
      if (DESTRUCTIVE.has(call.name) && cb.onApprove) {
        const ok = await cb.onApprove(describeCall(call.name, args));
        if (!ok) {
          cb.onStep("↳ ⛔ отклонено пользователем");
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: "Пользователь отклонил выполнение этого действия.",
          });
          continue;
        }
      }
      const result = await executeTool(call.name, args);
      cb.onStep(`↳ ${short(result, 300)}`);
      results.push({ type: "tool_result", tool_use_id: call.id, content: result });
    }
    messages.push({ role: "user", content: results });
  }
  cb.onText("\n⚠️ Достигнут лимит шагов агента.");
}

/** Plain (non-agent) streamed chat against Claude. */
export async function streamAnthropicChat(
  settings: BrainSettings,
  history: AgentMessage[],
  onText: (t: string) => void,
  signal?: AbortSignal,
  images?: ImageInput[],
): Promise<void> {
  if (!settings.apiKey) {
    onText("⚠️ Не задан Anthropic API-ключ. Открой ⚙ и вставь ключ.");
    return;
  }
  const { system, messages } = buildMessages(history, images);
  await streamOnce(settings, system, messages, [], onText, signal);
}

/** Capture the screen and return it as vision blocks for a tool_result (see_screen). */
async function captureScreenBlocks(): Promise<Array<TextBlock | ImageBlock>> {
  const path = await invoke<string>("screenshot");
  const dataB64 = await invoke<string>("read_file_base64", { path });
  return [
    { type: "text", text: "Текущий экран:" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: dataB64 } },
  ];
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

function short(text: string, cap = 120): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  return s.length > cap ? s.slice(0, cap) + "…" : s;
}
