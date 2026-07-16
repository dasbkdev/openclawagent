// Streaming client for our brain's OpenAI-compatible bridge (control-plane / nikolay_ai).
// The desktop app is a face over the existing brain: it POSTs to /v1/chat/completions with
// stream:true and yields deltas as they arrive (Server-Sent Events).

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type BrainSettings = {
  endpoint: string; // e.g. http://127.0.0.1:3099 or the LAN/VPS bridge URL
  apiKey: string;
  model: string;
  systemPrompt: string;
};

export const DEFAULT_SYSTEM_PROMPT =
  "Ты — персональный ассистент Starlab. Отвечай кратко и по делу, на русском.";

const SETTINGS_KEY = "starlab.brain.settings";

export const DEFAULT_SETTINGS: BrainSettings = {
  // control-plane OpenAI bridge (see control-plane/src/api/router.js, /v1/chat/completions).
  endpoint: "http://127.0.0.1:3099",
  apiKey: "", // personal/device bearer token issued by the control-plane
  model: "starlab-personal", // the bridge advertises this via /v1/models; it routes by token
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

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

/** List models the bridge advertises (GET /v1/models). Empty list on any failure. */
export async function fetchModels(settings: BrainSettings): Promise<string[]> {
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

/** True if the bridge is reachable (used for the connection dot). */
export async function ping(settings: BrainSettings): Promise<boolean> {
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
): Promise<void> {
  const url = settings.endpoint.replace(/\/+$/, "") + "/v1/chat/completions";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: settings.model, messages, stream: true }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Мозг ответил ${response.status}: ${detail.slice(0, 200)}`);
  }

  // The Starlab bridge currently answers with a single JSON completion (non-streaming) and
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
