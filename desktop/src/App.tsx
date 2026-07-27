import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CommandPalette, type Command } from "./CommandPalette";
import {
  IconChevron,
  IconCopy,
  IconEye,
  IconMaximize,
  IconMic,
  IconMinimize,
  IconPaperclip,
  IconPlus,
  IconRefresh,
  IconSend,
  IconSettings,
  IconSparkle,
  IconStop,
  IconTasks,
  IconTrash,
  IconUser,
  IconVolume,
  IconWand,
  IconX,
} from "./icons";
import {
  type AgentMessage,
  ANTHROPIC_MODELS,
  type BrainSettings,
  type ChatMessage,
  claimNextTask,
  type DesktopTask,
  fetchModels,
  loadSettings,
  ping,
  reportTaskResult,
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
import { FEMALE_VOICES, MALE_VOICES, voiceName } from "./voices";
import { TasksPanel } from "./Tasks";
import { runAgent } from "./agent";
import { type ImageInput, runAnthropicAgent, streamAnthropicChat } from "./anthropic";
import { type HandsFreeHandle, speak, startHandsFree, stopSpeaking, transcribe } from "./voice";

const appWindow = getCurrentWindow();

// Voice-mode UI states (single voice button). listening → hearing (you talk) → recognizing
// → thinking (brain) → speaking (reply), then back to listening.
type VoicePhase = "listening" | "hearing" | "recognizing" | "thinking" | "speaking";

function voicePhaseLabel(p: VoicePhase): string {
  switch (p) {
    case "hearing":
      return "Говорите…";
    case "recognizing":
      return "Распознаю…";
    case "thinking":
      return "Думаю…";
    case "speaking":
      return "Отвечаю…";
    default:
      return "Слушаю";
  }
}

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
  const [showPalette, setShowPalette] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [queueOn, setQueueOn] = useState<boolean>(() => localStorage.getItem("sai.queue") === "1");
  // Agent mode is on by default (SAI acts on the machine); persisted so it stays on.
  const [agentMode, setAgentMode] = useState<boolean>(() => localStorage.getItem("sai.agent") !== "0");
  const [openMenu, setOpenMenu] = useState<null | "model" | "provider" | "voice">(null);
  const [models, setModels] = useState<string[]>(ANTHROPIC_MODELS);
  const [settings, setSettings] = useState<BrainSettings>(loadSettings);
  const [online, setOnline] = useState<boolean | null>(null);
  const [autostart, setAutostart] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("listening");
  // Vision mode: auto-attach a live screenshot to every turn so SAI sees the current screen.
  const [visionMode, setVisionMode] = useState<boolean>(() => localStorage.getItem("sai.vision") === "1");
  const [approval, setApproval] = useState<{ summary: string; resolve: (ok: boolean) => void } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const approveAllRef = useRef(false);
  const hfRef = useRef<HandsFreeHandle | null>(null);
  const busyRef = useRef(false);
  const hfProcessingRef = useRef(false);
  const speakingRef = useRef(false);
  const voiceModeRef = useRef(false);
  const visionModeRef = useRef(false);
  const queueBusyRef = useRef(false);
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

  // Mirror `busy`/`voiceMode` into refs so voice callbacks read live values, not stale closures.
  useEffect(() => {
    busyRef.current = busy;
    if (voiceModeRef.current && busy) setVoicePhase("thinking");
  }, [busy]);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);
  useEffect(() => {
    visionModeRef.current = visionMode;
    localStorage.setItem("sai.vision", visionMode ? "1" : "0");
  }, [visionMode]);

  // Persist agent mode so it stays on across restarts.
  useEffect(() => {
    localStorage.setItem("sai.agent", agentMode ? "1" : "0");
  }, [agentMode]);

  // Tear down hands-free listening if the component unmounts.
  useEffect(() => () => hfRef.current?.stop(), []);

  useEffect(() => {
    void invoke<boolean>("get_autostart").then(setAutostart).catch(() => {});
  }, []);

  // Provisioning: if ~/.sai-bootstrap.json exists, merge it into settings once (lets the
  // brain endpoint/token/model be configured for the user without touching the UI).
  useEffect(() => {
    void (async () => {
      try {
        const path = await join(await homeDir(), ".sai-bootstrap.json");
        const raw = await invoke<string>("read_file", { path });
        const cfg = JSON.parse(raw) as Partial<BrainSettings>;
        const next = { ...loadSettings(), ...cfg };
        saveSettings(next);
        setSettings(next);
      } catch {
        // no bootstrap file — normal
      }
    })();
  }, []);

  async function toggleAutostart() {
    const next = !autostart;
    try {
      await invoke("set_autostart", { enabled: next });
      setAutostart(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Single voice mode: tap once to start a hands-free conversation. SAI listens, auto-sends
  // when you pause, and always speaks its reply. Tap again to stop. Capture pauses while the
  // brain is thinking or SAI is speaking, so it never records over itself.
  async function toggleVoice() {
    if (voiceMode) {
      hfRef.current?.stop();
      hfRef.current = null;
      stopSpeaking();
      speakingRef.current = false;
      setVoiceMode(false);
      setVoicePhase("listening");
      return;
    }
    const key = settings.elevenKey?.trim();
    if (!key) {
      setError("Добавь ключ ElevenLabs в настройках, чтобы включить голосовой режим.");
      setShowSettings(true);
      return;
    }
    try {
      hfRef.current = await startHandsFree({
        isBusy: () => busyRef.current || hfProcessingRef.current || speakingRef.current,
        onState: (s) => {
          if (busyRef.current || hfProcessingRef.current || speakingRef.current) return;
          setVoicePhase(s === "recording" ? "hearing" : "listening");
        },
        onSegment: async (blob) => {
          hfProcessingRef.current = true;
          setVoicePhase("recognizing");
          try {
            const text = (await transcribe(blob, key)).trim();
            if (text) await sendText(text);
            else setVoicePhase("listening");
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setVoicePhase("listening");
          } finally {
            hfProcessingRef.current = false;
          }
        },
      });
      setVoiceMode(true);
      setVoicePhase("listening");
      setError(null);
    } catch {
      setError("Нет доступа к микрофону.");
    }
  }

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

  useEffect(() => {
    let alive = true;
    void fetchModels(settings).then((m) => alive && m.length && setModels(m));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.provider, settings.endpoint, settings.apiKey]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const eff = settings.theme === "system" ? (mq.matches ? "light" : "dark") : settings.theme;
      document.documentElement.dataset.theme = eff;
    };
    apply();
    if (settings.theme === "system") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [settings.theme]);

  function chooseModel(model: string) {
    persistSettings({ ...settings, model });
    setOpenMenu(null);
  }

  function chooseProvider(provider: BrainSettings["provider"]) {
    const model = provider === "anthropic" ? "claude-opus-4-8" : "nikolay-assistant";
    persistSettings({ ...settings, provider, model });
    setOpenMenu(null);
  }

  function chooseVoice(id: string) {
    persistSettings({ ...settings, elevenVoice: id });
    setOpenMenu(null);
  }

  function toggleQueue(on: boolean) {
    setQueueOn(on);
    localStorage.setItem("sai.queue", on ? "1" : "0");
  }

  function toggleVision() {
    setVisionMode((v) => !v);
    setError(null);
  }

  // Execute one queued task headlessly (no user present → auto-approve tool calls).
  async function runQueuedTask(task: DesktopTask): Promise<void> {
    let out = "";
    const cb = {
      onText: (t: string) => {
        out += t;
      },
      onStep: (l: string) => {
        out += `\n${l}\n`;
      },
      onApprove: async () => true,
    };
    const sys = settings.systemPrompt.trim();
    const history: AgentMessage[] = [
      {
        role: "system",
        content:
          (sys ? sys + "\n\n" : "") +
          "Это фоновая задача из очереди — пользователя рядом нет. Выполни её полностью " +
          "своими инструментами и в конце дай короткий отчёт о результате.",
      },
      { role: "user", content: task.instruction },
    ];
    try {
      if (settings.provider === "anthropic") await runAnthropicAgent(settings, history, cb);
      else await runAgent(settings, history, cb);
      await reportTaskResult(settings, task.id, "done", out.trim() || "готово");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reportTaskResult(settings, task.id, "failed", `${msg}\n${out}`.trim());
    }
  }

  // Poll the brain queue and run due tasks one at a time (bridge provider only).
  useEffect(() => {
    if (!queueOn || settings.provider !== "bridge") return;
    let alive = true;
    const tick = async () => {
      if (!alive || queueBusyRef.current || !online) return;
      queueBusyRef.current = true;
      try {
        const task = await claimNextTask(settings);
        if (task) await runQueuedTask(task);
      } finally {
        queueBusyRef.current = false;
      }
    };
    void tick();
    const i = setInterval(() => void tick(), 10000);
    return () => {
      alive = false;
      clearInterval(i);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueOn, settings, online]);

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

    // Vision mode: attach a live screenshot to THIS request so SAI sees the current screen.
    // Sent to the model only — not stored in history (a base64 PNG per turn would blow the
    // localStorage quota). User-attached images are still stored/displayed as before.
    let sendImgs = images ?? [];
    if (visionModeRef.current) {
      try {
        const path = await invoke<string>("screenshot");
        const b64 = await invoke<string>("read_file_base64", { path });
        sendImgs = [...sendImgs, `data:image/png;base64,${b64}`];
      } catch {
        // screen capture failed — send without it
      }
    }

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

    // Destructive tool calls pause here for user approval (unless "разрешить всё" was chosen
    // or danger mode is on — then they run unconditionally).
    const onApprove = (summary: string): Promise<boolean> =>
      new Promise((resolve) => {
        if (settings.dangerMode || approveAllRef.current) {
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
    let full = "";
    const append = (delta: string) => {
      full += delta;
      patchActive((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: m.content + delta } : m,
        ),
      }));
    };

    try {
      if (agentMode) {
        const agentSystem =
          (system ? system + "\n\n" : "") +
          "У тебя есть полный доступ к компьютеру пользователя: терминал, файлы, поиск, скриншот, " +
          "веб, а также клавиатура, мышь, буфер обмена, список окон/процессов и запуск/закрытие " +
          "приложений. Действуй как агент: выполняй задачи до конца, разрушительные действия " +
          "пользователь подтверждает сам. В конце дай краткий итог.";
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
          await runAnthropicAgent(settings, agentHistory, cbs, toImageInputs(sendImgs));
        else await runAgent(settings, agentHistory, cbs, sendImgs);
      } else if (settings.provider === "anthropic") {
        const agentHistory: AgentMessage[] = [
          ...(system ? [{ role: "system" as const, content: system }] : []),
          ...history.map(({ role, content }) => ({ role, content })),
        ];
        await streamAnthropicChat(settings, agentHistory, append, controller.signal, toImageInputs(sendImgs));
      } else {
        const payload: ChatMessage[] = [
          ...(system ? [{ role: "system" as const, content: system }] : []),
          ...history.map(({ role, content }) => ({ role, content })),
        ];
        await streamChat(settings, payload, append, controller.signal, sendImgs);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      abortRef.current = null;
      const key = settings.elevenKey?.trim();
      const shouldSpeak =
        !!key && full.trim().length > 0 && !controller.signal.aborted &&
        (voiceModeRef.current || settings.speakReplies === true);
      if (shouldSpeak) {
        speakingRef.current = true;
        if (voiceModeRef.current) setVoicePhase("speaking");
        void speak(full, key as string, settings.elevenVoice || "JBFqnCBsd6RMkjVDRZzb")
          .catch(() => {})
          .finally(() => {
            speakingRef.current = false;
            if (voiceModeRef.current) setVoicePhase("listening");
          });
      } else if (voiceModeRef.current) {
        setVoicePhase("listening");
      }
    }
  }

  function stop() {
    abortRef.current?.abort();
    approval?.resolve(false); // release any pending approval so the loop unwinds
    stopSpeaking();
    speakingRef.current = false;
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
      { id: "tasks", label: "Задачи и очередь", hint: "фоновое выполнение", run: () => setShowTasks(true) },
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
        id: "autostart",
        label: autostart ? "Автозапуск с системой: выключить" : "Автозапуск с системой: включить",
        hint: autostart ? "сейчас вкл" : "сейчас выкл",
        run: () => void toggleAutostart(),
      },
      {
        id: "clear",
        label: "Очистить текущую беседу",
        run: () => active && patchActive((c) => ({ ...c, messages: [] })),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentMode, settings, active, autostart],
  );

  return (
    <div className="app">
      <CommandPalette open={showPalette} commands={commands} onClose={() => setShowPalette(false)} />
      {showTasks && (
        <TasksPanel
          settings={settings}
          queueOn={queueOn}
          onToggleQueue={toggleQueue}
          onClose={() => setShowTasks(false)}
        />
      )}
      <aside className="sidebar">
        <div className="side-brand">
          <span className="logo">
            <IconSparkle size={18} />
          </span>
          <span className="name">SAI</span>
        </div>
        <button className="new-chat" onClick={createConversation}>
          <IconPlus size={16} /> Новая беседа
        </button>
        <div className="side-label">Недавние</div>
        <div className="conv-list">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`conv ${c.id === active?.id ? "active" : ""}`}
              onClick={() => setActiveId(c.id)}
            >
              <span className="cdot" />
              <span className="conv-body">
                <span className="conv-title">{c.title}</span>
                <span className="conv-time">{relativeTime(c.updatedAt)}</span>
              </span>
              <button
                className="conv-del"
                title="Удалить"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversation(c.id);
                }}
              >
                <IconTrash size={15} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className="main">
        <header className="topbar" data-tauri-drag-region>
          <div className="crumbs">
            <span>SAI</span>
            <span className="sep">›</span>
            <span>Чат</span>
            <span className="sep">›</span>
            <span className="cur">{active?.title ?? "Новая беседа"}</span>
          </div>
          <div className="spacer" />
          <button
            className={`icon-btn ${queueOn ? "active" : ""}`}
            title="Задачи и очередь"
            onClick={() => setShowTasks(true)}
          >
            <IconTasks />
          </button>
          <button className="icon-btn" title="Настройки" onClick={() => setShowSettings((s) => !s)}>
            <IconSettings />
          </button>
          <div className="win-controls">
            <button className="win-btn" title="Свернуть" onClick={() => void appWindow.minimize()}>
              <IconMinimize />
            </button>
            <button className="win-btn" title="Развернуть" onClick={() => void appWindow.toggleMaximize()}>
              <IconMaximize />
            </button>
            <button className="win-btn close" title="Закрыть" onClick={() => void appWindow.close()}>
              <IconX size={15} />
            </button>
          </div>
        </header>

        <div className="controlstrip">
          {openMenu && <div className="menu-backdrop" onClick={() => setOpenMenu(null)} />}
          <div className="ctrl-wrap">
            <button
              className={`ctrl-select ${openMenu === "model" ? "open" : ""}`}
              onClick={() => setOpenMenu((m) => (m === "model" ? null : "model"))}
            >
              <span className="ctrl-label">Модель</span>
              <span className="ctrl-value">{settings.model}</span>
              <IconChevron size={13} />
            </button>
            {openMenu === "model" && (
              <div className="ctrl-menu">
                {models.map((m) => (
                  <button
                    key={m}
                    className={`ctrl-opt ${m === settings.model ? "sel" : ""}`}
                    onClick={() => chooseModel(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ctrl-wrap">
            <button
              className={`ctrl-select ${openMenu === "provider" ? "open" : ""}`}
              onClick={() => setOpenMenu((m) => (m === "provider" ? null : "provider"))}
            >
              <span className="ctrl-label">Провайдер</span>
              <span className="ctrl-value">{settings.provider === "anthropic" ? "Claude напрямую" : "Мозг SAI"}</span>
              <IconChevron size={13} />
            </button>
            {openMenu === "provider" && (
              <div className="ctrl-menu">
                <button
                  className={`ctrl-opt ${settings.provider === "bridge" ? "sel" : ""}`}
                  onClick={() => chooseProvider("bridge")}
                >
                  Мозг SAI (мост)
                </button>
                <button
                  className={`ctrl-opt ${settings.provider === "anthropic" ? "sel" : ""}`}
                  onClick={() => chooseProvider("anthropic")}
                >
                  Claude напрямую
                </button>
              </div>
            )}
          </div>
          <div className="ctrl-wrap">
            <button
              className={`ctrl-select ${openMenu === "voice" ? "open" : ""}`}
              onClick={() => setOpenMenu((m) => (m === "voice" ? null : "voice"))}
            >
              <span className="ctrl-label">Голос</span>
              <span className="ctrl-value">{voiceName(settings.elevenVoice)}</span>
              <IconChevron size={13} />
            </button>
            {openMenu === "voice" && (
              <div className="ctrl-menu voice-menu">
                <div className="ctrl-group">Женские</div>
                {FEMALE_VOICES.map((v) => (
                  <button
                    key={v.id}
                    className={`ctrl-opt ${v.id === settings.elevenVoice ? "sel" : ""}`}
                    onClick={() => chooseVoice(v.id)}
                  >
                    <span>{v.name}</span>
                    <span className="ctrl-opt-desc">{v.desc}</span>
                  </button>
                ))}
                <div className="ctrl-group">Мужские</div>
                {MALE_VOICES.map((v) => (
                  <button
                    key={v.id}
                    className={`ctrl-opt ${v.id === settings.elevenVoice ? "sel" : ""}`}
                    onClick={() => chooseVoice(v.id)}
                  >
                    <span>{v.name}</span>
                    <span className="ctrl-opt-desc">{v.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="spacer" />
          {settings.dangerMode && (
            <span className="danger-flag" title="Разрешения отключены — асик действует без подтверждений">
              без ограничений
            </span>
          )}
          <span
            className={`dot ${online === null ? "unknown" : online ? "on" : "off"}`}
            title={online === null ? "Проверка связи" : online ? "Мозг на связи" : "Нет связи с мозгом"}
          />
        </div>

        {showSettings && (
          <div className="modal-overlay" onClick={() => setShowSettings(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <span>Настройки</span>
                <button className="icon-btn" onClick={() => setShowSettings(false)} title="Закрыть">
                  <IconX size={16} />
                </button>
              </div>
              <SettingsPanel
                settings={settings}
                onSave={persistSettings}
                onClose={() => setShowSettings(false)}
                autostart={autostart}
                onToggleAutostart={toggleAutostart}
              />
            </div>
          </div>
        )}

        <div className="messages" ref={listRef}>
          {(!active || active.messages.length === 0) && (
            <div className="empty">
              <span className="empty-mark">
                <IconSparkle size={30} />
              </span>
              <h1 className="empty-title">Чем помочь?</h1>
              <p className="empty-sub">
                {online === false
                  ? "Нет связи с мозгом — проверь настройки."
                  : "Спроси что угодно или включи агента, чтобы действовать на компьютере."}
              </p>
              <div className="empty-chips">
                {[
                  "Что у меня по задачам сегодня?",
                  "Собери сводку почты",
                  "Наведи порядок в папке Загрузки",
                ].map((s) => (
                  <button key={s} className="chip" onClick={() => void sendText(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {active?.messages.map((m, i) => {
            const isLast = i === active.messages.length - 1;
            const ai = m.role === "assistant";
            return (
              <div key={m.id} className={`msg ${m.role}`}>
                <span className={`avatar ${ai ? "ai" : "me"}`}>
                  {ai ? <IconSparkle size={16} /> : <IconUser size={15} />}
                </span>
                <div className="msg-col">
                  <div className="msg-meta">
                    {ai ? "SAI" : "Вы"} · {clockTime(m.id)}
                  </div>
                  <div className="bubble">
                    {m.images && m.images.length > 0 && (
                      <div className="msg-images">
                        {m.images.map((src, k) => (
                          <img key={k} src={src} alt="вложение" className="msg-image" />
                        ))}
                      </div>
                    )}
                    {ai ? (
                      m.content ? (
                        <Markdown text={m.content} />
                      ) : (
                        busy && <span className="typing" />
                      )
                    ) : (
                      m.content
                    )}
                  </div>
                  {ai && m.content && !busy && (
                    <div className="msg-actions">
                      <button onClick={() => void copyText(m.content)}>
                        <IconCopy /> копировать
                      </button>
                      {isLast && (
                        <button onClick={() => void regenerate()}>
                          <IconRefresh /> заново
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

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
                  <IconX size={12} />
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
          <textarea
            value={input}
            placeholder="Сообщение SAI…"
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
          <div className="composer-tools">
            <button
              className="tool-btn"
              title="Прикрепить изображение (или вставь/перетащи)"
              onClick={() => fileRef.current?.click()}
            >
              <IconPaperclip size={16} /> Вложить
            </button>
            <button
              className={`tool-btn ${agentMode ? "on" : ""}`}
              title={agentMode ? "Агент включён: терминал, файлы, мышь/клавиатура" : "Включить агента (инструменты)"}
              onClick={() => setAgentMode((a) => !a)}
            >
              <IconWand size={16} /> Агент
            </button>
            <button
              className={`tool-btn voice-btn ${voiceMode ? `on ${voicePhase}` : ""}`}
              title={
                voiceMode
                  ? "Голосовой режим включён — говори, SAI слушает и отвечает голосом. Нажми, чтобы выключить."
                  : "Голосовой режим: говори — SAI слушает и отвечает голосом (без кнопок)"
              }
              onClick={() => void toggleVoice()}
            >
              <IconMic size={16} /> {voiceMode ? voicePhaseLabel(voicePhase) : "Голос"}
            </button>
            <button
              className={`tool-btn ${settings.speakReplies ? "on" : ""}`}
              title={
                settings.speakReplies
                  ? "Ответы озвучиваются голосом — нажми, чтобы выключить"
                  : "Озвучивать письменные ответы голосом (пишешь текстом — SAI отвечает текстом и голосом)"
              }
              onClick={() => persistSettings({ ...settings, speakReplies: !settings.speakReplies })}
            >
              <IconVolume size={16} /> Озвучка
            </button>
            <button
              className={`tool-btn ${visionMode ? "on" : ""}`}
              title={
                visionMode
                  ? "Зрение включено — SAI видит твой экран в каждой реплике"
                  : "Зрение: SAI видит экран (живой снимок прикладывается к каждому сообщению)"
              }
              onClick={toggleVision}
            >
              <IconEye size={16} /> Зрение
            </button>
            <div className="spacer" />
            {busy ? (
              <button className="send stop" onClick={stop}>
                <IconStop size={15} /> Стоп
              </button>
            ) : (
              <button className="send" onClick={() => void send()} disabled={!input.trim() && attachments.length === 0}>
                Отправить <IconSend size={15} />
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Compact relative time for the sidebar ("только что", "5 мин", "2 ч", "3 д"). */
function relativeTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return "только что";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  return `${d} д`;
}

/** HH:MM for message meta. */
function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
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
  autostart: boolean;
  onToggleAutostart: () => void;
}) {
  const [draft, setDraft] = useState(props.settings);
  const [models, setModels] = useState<string[]>([]);
  const [warnDanger, setWarnDanger] = useState(false);

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
      <label>
        Тема
        <select
          value={draft.theme}
          onChange={(e) => setDraft({ ...draft, theme: e.target.value as BrainSettings["theme"] })}
        >
          <option value="dark">Тёмная</option>
          <option value="light">Светлая</option>
          <option value="system">Как в системе</option>
        </select>
      </label>
      <label>
        Ключ ElevenLabs (голос: микрофон + озвучка)
        <input
          type="password"
          value={draft.elevenKey ?? ""}
          onChange={(e) => setDraft({ ...draft, elevenKey: e.target.value })}
          placeholder="xi-api-key…"
        />
      </label>
      <label>
        Голос (ElevenLabs voice id)
        <input
          value={draft.elevenVoice ?? ""}
          onChange={(e) => setDraft({ ...draft, elevenVoice: e.target.value })}
          placeholder="JBFqnCBsd6RMkjVDRZzb"
        />
      </label>

      <div className="danger-row">
        <div className="danger-text">
          <div className="danger-title">Озвучивать ответы в текстовом режиме</div>
          <div className="danger-desc">В голосовом режиме ответы озвучиваются всегда.</div>
        </div>
        <button
          className={`switch ${draft.speakReplies ? "on" : ""}`}
          role="switch"
          aria-checked={!!draft.speakReplies}
          onClick={() => setDraft({ ...draft, speakReplies: !draft.speakReplies })}
        >
          <span className="knob" />
        </button>
      </div>

      <div className="danger-row">
        <div className="danger-text">
          <div className="danger-title">Запускать с Windows</div>
          <div className="danger-desc">SAI стартует в трее при входе в систему — всегда под рукой.</div>
        </div>
        <button
          className={`switch ${props.autostart ? "on" : ""}`}
          role="switch"
          aria-checked={props.autostart}
          onClick={() => props.onToggleAutostart()}
        >
          <span className="knob" />
        </button>
      </div>

      <div className="danger-row">
        <div className="danger-text">
          <div className="danger-title">Не спрашивать разрешений</div>
          <div className="danger-desc">Асик выполняет любые действия без подтверждения.</div>
        </div>
        <button
          className={`switch ${draft.dangerMode ? "on" : ""}`}
          role="switch"
          aria-checked={draft.dangerMode}
          onClick={() => (draft.dangerMode ? setDraft({ ...draft, dangerMode: false }) : setWarnDanger(true))}
        >
          <span className="knob" />
        </button>
      </div>

      {warnDanger && (
        <div className="danger-overlay" onClick={() => setWarnDanger(false)}>
          <div className="danger-modal" onClick={(e) => e.stopPropagation()}>
            <div className="danger-h">⚠ Режим без ограничений</div>
            <p className="danger-body">
              Асик сможет делать на компьютере <b>что угодно без подтверждения</b>: удалять и
              перезаписывать файлы, выполнять любые команды, управлять мышью и клавиатурой,
              закрывать приложения. Есть <b>реальный риск потери важных данных</b>.
              <br />
              <br />
              Включай только если полностью доверяешь и понимаешь последствия. Разработчики
              <b> не несут ответственности</b>, если асик сотрёт или испортит данные.
            </p>
            <div className="danger-actions">
              <button onClick={() => setWarnDanger(false)}>Отмена</button>
              <button
                className="danger-confirm"
                onClick={() => {
                  setDraft({ ...draft, dangerMode: true });
                  setWarnDanger(false);
                }}
              >
                Понимаю риск — включить
              </button>
            </div>
          </div>
        </div>
      )}

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
