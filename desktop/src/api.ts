// Streaming client for our brain's OpenAI-compatible bridge (control-plane / nikolay_ai).
// The desktop app is a face over the existing brain: it POSTs to /v1/chat/completions with
// stream:true and yields deltas as they arrive (Server-Sent Events).

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

// A message in an agent conversation (adds tool-calling roles/fields over ChatMessage).
export type AgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

// "bridge" = our brain's OpenAI-compatible endpoint (control-plane / nikolay_ai).
// "anthropic" = talk to Claude directly with an Anthropic API key (self-contained).
export type Provider = "bridge" | "anthropic";

export type Theme = "dark" | "light" | "system";

export type BrainSettings = {
  provider: Provider;
  endpoint: string; // bridge only — e.g. http://127.0.0.1:3099 or the LAN/VPS URL
  apiKey: string; // bridge bearer token OR Anthropic API key, depending on provider
  model: string;
  systemPrompt: string;
  theme: Theme;
  dangerMode: boolean; // when true, agent runs destructive tools without asking
  elevenKey?: string; // ElevenLabs API key for voice (STT/TTS); empty = voice off
  elevenVoice?: string; // ElevenLabs voice id
  speakReplies?: boolean; // in text mode, also read replies aloud (voice mode always speaks)
  voiceVolume?: number; // TTS playback gain (1 = normal, up to ~4 = much louder)
  voiceSensitivity?: number; // hands-free mic threshold (RMS); lower = more sensitive
};

export const DEFAULT_SYSTEM_PROMPT =
  "Ты — SAI, десктопный ИИ-агент Николая, живущий на его компьютере (Windows). Ты — НЕ " +
  "телеграм-бот; телеграм-ассистент это отдельный «карманный» помощник. У тебя есть полный " +
  "доступ к машине: терминал, файлы, поиск, веб, скриншот, а также мышь, клавиатура, буфер " +
  "обмена, список окон/процессов и запуск/закрытие приложений. Действуй как агент — доводи " +
  "задачи до конца; разрушительные действия подтверждаются пользователем. Кратко, по-русски.";

// Known Claude models offered when the provider is Anthropic (newest first).
export const ANTHROPIC_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

const SETTINGS_KEY = "sai.brain.settings";

export const DEFAULT_SETTINGS: BrainSettings = {
  // Route through the nikolay_ai brain (memory + integrations) over Tailscale by default.
  provider: "bridge",
  endpoint: "https://main-server.taild4d010.ts.net",
  apiKey: "", // Bearer = brain_api_token; paste in ⚙
  model: "nikolay-assistant",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  theme: "dark",
  dangerMode: false,
  elevenKey: "",
  elevenVoice: "JBFqnCBsd6RMkjVDRZzb", // George (multilingual) — same voice as the Telegram bot
  speakReplies: false,
  voiceVolume: 2.4,
  voiceSensitivity: 0.06,
};

export type UsageToday = { calls: number; tokens: number; cost_usd: number };

/** Fetch the brain's last-24h cloud-LLM spend (bridge provider only). Null on any failure. */
export async function fetchUsage(settings: BrainSettings): Promise<UsageToday | null> {
  if (settings.provider !== "bridge") return null;
  try {
    const url = settings.endpoint.replace(/\/+$/, "") + "/v1/usage";
    const headers: Record<string, string> = {};
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const j = await res.json();
    return { calls: Number(j?.calls ?? 0), tokens: Number(j?.tokens ?? 0), cost_usd: Number(j?.cost_usd ?? 0) };
  } catch {
    return null;
  }
}

export function loadSettings(): BrainSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // ignore corrupt settings — fall back to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: BrainSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * One tool-calling turn: POST messages + tools, return the assistant message (which may
 * carry tool_calls). The control-plane bridge answers non-streaming with tool_calls when
 * the model wants a tool (see openai-tools-bridge.js).
 */
export async function chatWithTools(
  settings: BrainSettings,
  messages: AgentMessage[],
  tools: ToolDef[],
  signal?: AbortSignal,
): Promise<AgentMessage> {
  const url = settings.endpoint.replace(/\/+$/, "") + "/v1/chat/completions";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: settings.model, messages, tools, tool_choice: "auto" }),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Мозг ответил ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  const msg = json?.choices?.[0]?.message;
  return {
    role: "assistant",
    content: msg?.content ?? null,
    tool_calls: Array.isArray(msg?.tool_calls) ? msg.tool_calls : undefined,
  };
}

// ---- Desktop task queue (brain <-> SAI). Bridge provider only. ----
export type DesktopTask = {
  id: number;
  source: string;
  instruction: string;
  status: string;
  result: string;
  origin_chat_id: string | null;
  run_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function taskUrl(settings: BrainSettings, path: string): string {
  return settings.endpoint.replace(/\/+$/, "") + path;
}
function taskHeaders(settings: BrainSettings): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) h.Authorization = `Bearer ${settings.apiKey}`;
  return h;
}

/** Queue a new desktop task. */
export async function createTask(
  settings: BrainSettings,
  instruction: string,
  opts: { source?: string; runAt?: string } = {},
): Promise<DesktopTask> {
  const res = await fetch(taskUrl(settings, "/desktop/tasks"), {
    method: "POST",
    headers: taskHeaders(settings),
    body: JSON.stringify({ instruction, source: opts.source ?? "sai", run_at: opts.runAt ?? null }),
  });
  if (!res.ok) throw new Error(`Очередь ответила ${res.status}`);
  return res.json();
}

/** Atomically claim the next due task (or null). */
export async function claimNextTask(settings: BrainSettings): Promise<DesktopTask | null> {
  const res = await fetch(taskUrl(settings, "/desktop/tasks/next"), { headers: taskHeaders(settings) });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  return json?.task ?? null;
}

/** Report a task's outcome. */
export async function reportTaskResult(
  settings: BrainSettings,
  id: number,
  status: "done" | "failed",
  result: string,
): Promise<void> {
  await fetch(taskUrl(settings, `/desktop/tasks/${id}/result`), {
    method: "POST",
    headers: taskHeaders(settings),
    body: JSON.stringify({ status, result: result.slice(0, 8000) }),
  }).catch(() => {});
}

/** List recent tasks (for the UI). */
export async function listTasks(settings: BrainSettings, limit = 50): Promise<DesktopTask[]> {
  try {
    const res = await fetch(taskUrl(settings, `/desktop/tasks?limit=${limit}`), {
      headers: taskHeaders(settings),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.tasks) ? json.tasks : [];
  } catch {
    return [];
  }
}

/** List models available for the current provider. */
export async function fetchModels(settings: BrainSettings): Promise<string[]> {
  if (settings.provider === "anthropic") return ANTHROPIC_MODELS;
  try {
    const url = settings.endpoint.replace(/\/+$/, "") + "/v1/models";
    const headers: Record<string, string> = {};
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const json = await res.json();
    const data: unknown = json?.data;
    if (!Array.isArray(data)) return [];
    return data.map((m) => String((m as { id?: unknown })?.id ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

/** True if the provider looks ready (used for the connection dot). */
export async function ping(settings: BrainSettings): Promise<boolean> {
  if (settings.provider === "anthropic") return settings.apiKey.trim().length > 0;
  try {
    const url = settings.endpoint.replace(/\/+$/, "") + "/v1/models";
    const headers: Record<string, string> = {};
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
    return res.ok || res.status === 401; // 401 still means the server is up
  } catch {
    return false;
  }
}

/**
 * Stream a chat completion. Calls `onDelta` with each text chunk as it arrives.
 * Aborts cleanly if `signal` fires. Throws on HTTP / network errors.
 */
export async function streamChat(
  settings: BrainSettings,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  images?: string[], // data URLs attached to the final user turn (OpenAI image_url parts)
): Promise<void> {
  const url = settings.endpoint.replace(/\/+$/, "") + "/v1/chat/completions";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  // If images are present, promote the last user message to OpenAI multimodal content parts.
  let outMessages: unknown[] = messages;
  if (images && images.length) {
    const lastUser = [...messages].map((m, i) => ({ m, i })).reverse().find((x) => x.m.role === "user");
    outMessages = messages.map((m, i) => {
      if (lastUser && i === lastUser.i) {
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content },
            ...images.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        };
      }
      return m;
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: settings.model, messages: outMessages, stream: true }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Мозг ответил ${response.status}: ${detail.slice(0, 200)}`);
  }

  // The SAI bridge currently answers with a single JSON completion (non-streaming) and
  // ignores stream:true. Detect that and emit the whole answer at once; still handle true
  // SSE for when/if the bridge starts streaming.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    const json = await response.json().catch(() => null);
    const content: string | undefined =
      json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.delta?.content;
    if (content) onDelta(content);
    else throw new Error("Пустой ответ от моста");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by blank lines; each carries one or more "data:" lines.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta: string | undefined = json?.choices?.[0]?.delta?.content;
          if (delta) onDelta(delta);
        } catch {
          // partial/keep-alive frame — ignore
        }
      }
    }
  }
}
