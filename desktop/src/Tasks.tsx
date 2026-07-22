import { useEffect, useState } from "react";
import { type BrainSettings, type DesktopTask, createTask, listTasks } from "./api";
import { IconPlus, IconX } from "./icons";

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

  async function add() {
    const t = text.trim();
    if (!t) return;
    setText("");
    try {
      await createTask(settings, t);
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
                if (e.key === "Enter") void add();
              }}
            />
            <button className="send" onClick={() => void add()} disabled={!text.trim()}>
              <IconPlus size={15} /> В очередь
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
