import { useEffect, useState } from "react";
import { type BrainSettings, type DesktopTask, createTask, listTasks } from "./api";
import { IconClock, IconPlus, IconX } from "./icons";

const STATUS_RU: Record<string, string> = {
  pending: "в очереди",
  running: "выполняется",
  done: "готово",
  failed: "ошибка",
  canceled: "отменено",
};

// Task queue view: toggle background execution, enqueue new tasks, watch statuses.
export function TasksPanel({ settings, queueOn, onToggleQueue, onClose }: {
  settings: BrainSettings;
  queueOn: boolean;
  onToggleQueue: (on: boolean) => void;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<DesktopTask[]>([]);
  const [text, setText] = useState("");
  const [when, setWhen] = useState(""); // datetime-local value for scheduling

  useEffect(() => {
    let alive = true;
    const load = () => void listTasks(settings).then((t) => alive && setTasks(t));
    load();
    const i = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [settings]);

  async function add(schedule = false) {
    const t = text.trim();
    if (!t) return;
    const runAt = schedule && when ? new Date(when).toISOString() : undefined;
    setText("");
    if (schedule) setWhen("");
    try {
      await createTask(settings, t, runAt ? { runAt } : {});
    } catch {
      // ignore — list refresh will reflect reality
    }
    void listTasks(settings).then(setTasks);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal tasks-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Задачи</span>
          <button className="icon-btn" onClick={onClose} title="Закрыть">
            <IconX size={16} />
          </button>
        </div>
        <div className="tasks-body">
          <div className="danger-row">
            <div className="danger-text">
              <div className="danger-title">Выполнять фоном</div>
              <div className="danger-desc">SAI сам берёт задачи из очереди и выполняет их.</div>
            </div>
            <button
              className={`switch ${queueOn ? "on" : ""}`}
              role="switch"
              aria-checked={queueOn}
              onClick={() => onToggleQueue(!queueOn)}
            >
              <span className="knob" />
            </button>
          </div>

          <div className="task-add">
            <input
              value={text}
              placeholder="Новая задача для SAI…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add(false);
              }}
            />
            <button className="send" onClick={() => void add(false)} disabled={!text.trim()}>
              <IconPlus size={15} /> В очередь
            </button>
          </div>
          <div className="task-schedule">
            <IconClock size={15} />
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              title="Когда выполнить задачу"
            />
            <button
              className="send ghost"
              onClick={() => void add(true)}
              disabled={!text.trim() || !when}
              title={!when ? "Укажи дату и время" : "Запланировать на выбранное время"}
            >
              <IconClock size={14} /> Запланировать
            </button>
          </div>

          <div className="task-list">
            {tasks.length === 0 && <div className="task-empty">Очередь пуста</div>}
            {tasks.map((t) => (
              <div key={t.id} className="task-item">
                <span className={`task-badge ${t.status}`}>{STATUS_RU[t.status] ?? t.status}</span>
                <div className="task-main">
                  <div className="task-instr">{t.instruction}</div>
                  {t.result && <div className="task-result">{t.result}</div>}
                  {t.run_at && (
                    <div className="task-src">⏰ {new Date(t.run_at).toLocaleString("ru-RU")}</div>
                  )}
                  {t.source === "telegram" && <div className="task-src">из Telegram</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
