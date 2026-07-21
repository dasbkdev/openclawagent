import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CommandPalette, type Command } from "./CommandPalette";
import {
  type AgentMessage,
  type BrainSettings,
  type ChatMessage,
  fetchModels,
  loadSettings,
  ping,
  saveSettings,
  streamChat,
} from "./api";
import {
  type Conversation,
  type StoredMessage,
  loadConversations,
  newConversation,
  saveConversations,
  titleFrom,
} from "./store";
import { Markdown } from "./Markdown";
import { Terminal } from "./Terminal";
import { runAgent } from "./agent";
import { type ImageInput, runAnthropicAgent, streamAnthropicChat } from "./anthropic";

export function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const list = loadConversations();
    return list.length ? list : [newConversation()];
  });
  const [activeId, setActiveId] = useState<string>(() => "");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]); // data URLs pending send
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [settings, setSettings] = useState<BrainSettings>(loadSettings);
  const [online, setOnline] = useState<boolean | null>(null);
  const [approval, setApproval] = useState<{ summary: string; resolve: (ok: boolean) => void } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const approveAllRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0],
    [conversations, activeId],
  );

  useEffect(() => {
    if (!activeId && conversations[0]) setActiveId(conversations[0].id);
  }, [activeId, conversations]);

  useEffect(() => saveConversations(conversations), [conversations]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        createConversation();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    const check = () => ping(settings).then((ok) => alive && setOnline(ok));
    void check();
    const t = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [settings]);

  function patchActive(fn: (c: Conversation) => Conversation) {
    setConversations((prev) => prev.map((c) => (c.id === active?.id ? fn(c) : c)));
  }

  async function send() {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    const imgs = attachments;
    setInput("");
    setAttachments([]);
    await sendText(text, undefined, imgs);
  }

  async function sendText(text: string, base?: StoredMessage[], images?: string[]) {
    if ((!text && !(images && images.length)) || busy || !active) return;
    setError(null);

    const userMsg: StoredMessage = {
      id: Date.now(),
      role: "user",
      content: text,
      ...(images && images.length ? { images } : {}),
    };
    const assistantMsg: StoredMessage = { id: Date.now() + 1, role: "assistant", content: "" };
    const history = [...(base ?? active.messages), userMsg];
    patchActive((c) => ({
      ...c,
      messages: [...history, assistantMsg],
      title: c.messages.length === 0 ? titleFrom(history) : c.title,
      updatedAt: Date.now(),
    }));
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    approveAllRef.current = false;
    const system = settings.systemPrompt.trim();

    // Destructive tool calls pause here for user approval (unless "разрешить всё" was chosen).
    const onApprove = (summary: string): Promise<boolean> =>
      new Promise((resolve) => {
        if (approveAllRef.current) {
          resolve(true);
          return;
        }
        setApproval({
          summary,
          resolve: (ok) => {
            setApproval(null);
            resolve(ok);
          },
        });
      });
    const append = (delta: string) =>
      patchActive((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: m.content + delta } : m,
        ),
      }));

    try {
      if (agentMode) {
        const agentSystem =
          (system ? system + "\n\n" : "") +
          "У тебя есть инструменты (терминал, файлы, поиск, скриншот, веб). Используй их, чтобы " +
          "выполнять задачи на компьютере пользователя, затем дай краткий итог.";
        const agentHistory: AgentMessage[] = [
          { role: "system", content: agentSystem },
          ...history.map(({ role, content }) => ({ role, content })),
        ];
        const cbs = {
          onText: append,
          onStep: (label: string) => append(`\n${label}\n`),
          onApprove,
          signal: controller.signal,
        };
        if (settings.provider === "anthropic")
          await runAnthropicAgent(settings, agentHistory, cbs, toImageInputs(images));
        else await runAgent(settings, agentHistory, cbs);
      } else if (settings.provider === "anthropic") {
        const agentHistory: AgentMessage[] = [
          ...(system ? [{ role: "system" as const, content: system }] : []),
          ...history.map(({ role, content }) => ({ role, content })),
        ];
        await streamAnthropicChat(settings, agentHistory, append, controller.signal, toImageInputs(images));
      } else {
        const payload: ChatMessage[] = [
          ...(system ? [{ role: "system" as const, content: system }] : []),
          ...history.map(({ role, content }) => ({ role, content })),
        ];
        await streamChat(settings, payload, append, controller.signal, images);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    approval?.resolve(false); // release any pending approval so the loop unwinds
    setBusy(false);
  }

  async function regenerate() {
    if (busy || !active) return;
    // Drop the trailing assistant reply and the last user turn, then resend that user text.
    const msgs = [...active.messages];
    while (msgs.length && msgs[msgs.length - 1].role === "assistant") msgs.pop();
    const lastUser = msgs.pop();
    if (!lastUser) return;
    patchActive((c) => ({ ...c, messages: msgs }));
    await sendText(lastUser.content, msgs);
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard blocked — ignore
    }
  }

  function createConversation() {
    const conv = newConversation();
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
  }

  function deleteConversation(id: string) {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      return next.length ? next : [newConversation()];
    });
  }

  function persistSettings(next: BrainSettings) {
    setSettings(next);
    saveSettings(next);
  }

  async function takeScreenshot() {
    try {
      const path = await invoke<string>("screenshot");
      await invoke("open_path", { path });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function addFiles(files: FileList | File[]) {
    const imgs = [...files].filter((f) => f.type.startsWith("image/"));
    const urls = await Promise.all(
      imgs.map(
        (f) =>
          new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.readAsDataURL(f);
          }),
      ),
    );
    if (urls.length) setAttachments((prev) => [...prev, ...urls]);
  }

  function onPaste(e: React.ClipboardEvent) {
    const files = [...e.clipboardData.items]
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  }

  const commands: Command[] = useMemo(
    () => [
      { id: "new", label: "Новая беседа", hint: "Ctrl+N", run: createConversation },
      {
        id: "agent",
        label: agentMode ? "Выключить агента" : "Включить агента (инструменты)",
        hint: "терминал, файлы, веб",
        run: () => setAgentMode((a) => !a),
      },
      { id: "shot", label: "Скриншот экрана", hint: "сохранить и открыть PNG", run: () => void takeScreenshot() },
      { id: "term", label: "Терминал", run: () => setShowTerminal((s) => !s) },
      { id: "settings", label: "Настройки", hint: "провайдер, модель, ключ", run: () => setShowSettings(true) },
      {
        id: "provider",
        label:
          settings.provider === "anthropic"
            ? "Провайдер → Мозг SAI (мост)"
            : "Провайдер → Claude напрямую",
        run: () =>
          persistSettings({
            ...settings,
            provider: settings.provider === "anthropic" ? "bridge" : "anthropic",
          }),
      },
      {
        id: "clear",
        label: "Очистить текущую беседу",
        run: () => active && patchActive((c) => ({ ...c, messages: [] })),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentMode, settings, active],
  );

  return (
    <div className="app">
      <CommandPalette open={showPalette} commands={commands} onClose={() => setShowPalette(false)} />
      <aside className="sidebar">
        <button className="new-chat" onClick={createConversation}>
          ＋ Новая беседа
        </button>
        <div className="conv-list">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`conv ${c.id === active?.id ? "active" : ""}`}
              onClick={() => setActiveId(c.id)}
            >
              <span className="conv-title">{c.title}</span>
              <button
                className="conv-del"
                title="Удалить"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversation(c.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className="main">
        <header className="titlebar" data-tauri-drag-region>
          <span className="brand">✦ SAI</span>
          <span className={`dot ${online === null ? "unknown" : online ? "on" : "off"}`} title={online ? "Мозг на связи" : "Нет связи с мозгом"} />
          <button
            className="provider-chip"
            title="Провайдер и модель — нажми для настроек"
            onClick={() => setShowSettings(true)}
          >
            {settings.provider === "anthropic" ? "Claude" : "Мозг"} · {settings.model}
          </button>
          <div className="spacer" />
          <button
            className={`icon-btn ${showTerminal ? "active" : ""}`}
            title="Терминал"
            onClick={() => setShowTerminal((s) => !s)}
          >
            ⌘
          </button>
          <button className="icon-btn" title="Настройки" onClick={() => setShowSettings((s) => !s)}>
            ⚙
          </button>
        </header>

        {showSettings && (
          <SettingsPanel
            settings={settings}
            onSave={persistSettings}
            onClose={() => setShowSettings(false)}
          />
        )}

        <div className="messages" ref={listRef}>
          {(!active || active.messages.length === 0) && (
            <div className="empty">
              {settings.provider === "anthropic"
                ? online
                  ? "Спроси что угодно — говорю с Claude напрямую. 🛠 — агент, 📎 — картинки, Ctrl+K — команды."
                  : "Открой ⚙ и вставь Anthropic API-ключ, чтобы начать."
                : online
                  ? "Спроси что угодно — подключён к мозгу nikolay_ai. 🛠 — агент, 📎 — картинки, Ctrl+K — команды."
                  : "Нет связи с мозгом. Подними Tailscale и проверь адрес/токен в ⚙."}
            </div>
          )}
          {active?.messages.map((m, i) => {
            const isLast = i === active.messages.length - 1;
            return (
              <div key={m.id} className={`msg ${m.role}`}>
                <div className="bubble">
                  {m.images && m.images.length > 0 && (
                    <div className="msg-images">
                      {m.images.map((src, k) => (
                        <img key={k} src={src} alt="вложение" className="msg-image" />
                      ))}
                    </div>
                  )}
                  {m.role === "assistant" ? (
                    m.content ? (
                      <Markdown text={m.content} />
                    ) : (
                      busy && <span className="typing">…</span>
                    )
                  ) : (
                    m.content
                  )}
                </div>
                {m.role === "assistant" && m.content && !busy && (
                  <div className="msg-actions">
                    <button onClick={() => void copyText(m.content)}>копировать</button>
                    {isLast && <button onClick={() => void regenerate()}>↻ заново</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {showTerminal && <Terminal onClose={() => setShowTerminal(false)} />}

        {approval && (
          <div className="approval-overlay">
            <div className="approval">
              <div className="approval-title">Агент просит разрешение</div>
              <pre className="approval-body">{approval.summary}</pre>
              <div className="approval-actions">
                <button onClick={() => approval.resolve(false)}>Отклонить</button>
                <button
                  onClick={() => {
                    approveAllRef.current = true;
                    approval.resolve(true);
                  }}
                >
                  Разрешить всё
                </button>
                <button className="primary" onClick={() => approval.resolve(true)}>
                  Разрешить
                </button>
              </div>
            </div>
          </div>
        )}

        {error && <div className="error">⚠ {error}</div>}

        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((src, k) => (
              <div key={k} className="attachment">
                <img src={src} alt="вложение" />
                <button
                  className="attachment-del"
                  title="Убрать"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== k))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className="composer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
          }}
        >
          <button
            className={`agent-toggle ${agentMode ? "on" : ""}`}
            title={agentMode ? "Агент включён: использует терминал и файлы" : "Включить агента (инструменты)"}
            onClick={() => setAgentMode((a) => !a)}
          >
            🛠
          </button>
          <button
            className="attach-btn"
            title="Прикрепить изображение (или вставь/перетащи)"
            onClick={() => fileRef.current?.click()}
          >
            📎
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <textarea
            value={input}
            placeholder="Сообщение…  (Enter — отправить, Shift+Enter — перенос)"
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
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
      </main>
    </div>
  );
}

/** "data:image/png;base64,AAAA" -> { mediaType, dataB64 } for the Anthropic vision API. */
function dataUrlToImageInput(url: string): ImageInput | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
  return m ? { mediaType: m[1], dataB64: m[2] } : null;
}

function toImageInputs(urls?: string[]): ImageInput[] {
  return (urls ?? []).map(dataUrlToImageInput).filter((x): x is ImageInput => x !== null);
}

function SettingsPanel(props: {
  settings: BrainSettings;
  onSave: (s: BrainSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(props.settings);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    void fetchModels(draft).then(setModels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.endpoint, draft.apiKey]);

  return (
    <div className="settings">
      <label>
        Провайдер
        <select
          value={draft.provider}
          onChange={(e) => setDraft({ ...draft, provider: e.target.value as BrainSettings["provider"] })}
        >
          <option value="anthropic">Claude напрямую (Anthropic API)</option>
          <option value="bridge">Мозг SAI (мост control-plane / nikolay_ai)</option>
        </select>
      </label>
      {draft.provider === "bridge" && (
        <label>
          Адрес мозга
          <input
            value={draft.endpoint}
            onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })}
            placeholder="http://127.0.0.1:3099"
          />
        </label>
      )}
      <label>
        Модель
        {models.length ? (
          <select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
            {!models.includes(draft.model) && <option value={draft.model}>{draft.model}</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
        )}
      </label>
      <label>
        {draft.provider === "anthropic" ? "Anthropic API-ключ" : "API-ключ моста"}
        <input
          type="password"
          value={draft.apiKey}
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          placeholder={draft.provider === "anthropic" ? "sk-ant-…" : "Bearer-токен моста"}
        />
      </label>
      <label>
        Характер ассистента (system prompt)
        <textarea
          className="sys-prompt"
          rows={3}
          value={draft.systemPrompt}
          onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
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
