import { useEffect, useRef, useState } from "react";
import {
  type BrainSettings,
  type ChatMessage,
  loadSettings,
  saveSettings,
  streamChat,
} from "./api";

type UiMessage = ChatMessage & { id: number };

const SYSTEM_PROMPT: ChatMessage = {
  role: "system",
  content: "Ты — персональный ассистент Starlab. Отвечай кратко и по делу, на русском.",
};

export function App() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<BrainSettings>(loadSettings);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");

    const userMsg: UiMessage = { id: Date.now(), role: "user", content: text };
    const assistantMsg: UiMessage = { id: Date.now() + 1, role: "assistant", content: "" };
    const history = [...messages, userMsg];
    setMessages([...history, assistantMsg]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const payload: ChatMessage[] = [
      SYSTEM_PROMPT,
      ...history.map(({ role, content }) => ({ role, content })),
    ];

    try {
      await streamChat(
        settings,
        payload,
        (delta) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + delta } : m)),
          );
        },
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
  }

  function persistSettings(next: BrainSettings) {
    setSettings(next);
    saveSettings(next);
  }

  return (
    <div className="app">
      <header className="titlebar" data-tauri-drag-region>
        <span className="brand">✦ Starlab</span>
        <div className="spacer" />
        <button className="icon-btn" title="Настройки" onClick={() => setShowSettings((s) => !s)}>
          ⚙
        </button>
      </header>

      {showSettings && (
        <SettingsPanel settings={settings} onSave={persistSettings} onClose={() => setShowSettings(false)} />
      )}

      <div className="messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="empty">Спроси что угодно — я подключён к твоему мозгу Starlab.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="bubble">{m.content || (m.role === "assistant" && busy ? "…" : "")}</div>
          </div>
        ))}
      </div>

      {error && <div className="error">⚠ {error}</div>}

      <div className="composer">
        <textarea
          value={input}
          placeholder="Сообщение…  (Enter — отправить, Shift+Enter — перенос)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
        />
        {busy ? (
          <button className="send stop" onClick={stop}>
            Стоп
          </button>
        ) : (
          <button className="send" onClick={() => void send()}>
            ➤
          </button>
        )}
      </div>
    </div>
  );
}

function SettingsPanel(props: {
  settings: BrainSettings;
  onSave: (s: BrainSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(props.settings);
  return (
    <div className="settings">
      <label>
        Адрес мозга
        <input
          value={draft.endpoint}
          onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })}
          placeholder="http://127.0.0.1:3099"
        />
      </label>
      <label>
        Модель
        <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
      </label>
      <label>
        API-ключ
        <input
          type="password"
          value={draft.apiKey}
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          placeholder="Bearer-токен моста (если задан)"
        />
      </label>
      <div className="settings-actions">
        <button onClick={props.onClose}>Отмена</button>
        <button
          className="primary"
          onClick={() => {
            props.onSave(draft);
            props.onClose();
          }}
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}
