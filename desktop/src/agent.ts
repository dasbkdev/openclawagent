// Client-side agent loop. The brain (control-plane bridge, tool-calling mode) decides which
// tool to call; the app executes it locally via Tauri (terminal + files) and sends results
// back until the model answers. Signature echoes OpenClaw: the model reasons, the app acts.

import { invoke } from "@tauri-apps/api/core";
import { type AgentMessage, type BrainSettings, type ToolDef, chatWithTools } from "./api";

type CommandResult = { stdout: string; stderr: string; code: number };

export const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Выполнить команду в системной оболочке (PowerShell на Windows, bash иначе) и вернуть вывод.",
      parameters: {
        type: "object",
        properties: {
          cmd: { type: "string", description: "команда" },
          cwd: { type: "string", description: "рабочая директория (необязательно)" },
        },
        required: ["cmd"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Прочитать текстовый файл по абсолютному пути.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Записать (перезаписать) текстовый файл по абсолютному пути.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "Список файлов и папок в директории.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Точечно заменить фрагмент в файле: old меняется на new. old должен встречаться ровно один раз.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old: { type: "string", description: "точный существующий фрагмент" },
          new: { type: "string", description: "чем заменить" },
        },
        required: ["path", "old", "new"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_files",
      description: "Найти файлы по подстроке в имени рекурсивно от корневой папки.",
      parameters: {
        type: "object",
        properties: {
          root: { type: "string", description: "с какой папки искать" },
          pattern: { type: "string", description: "подстрока имени файла" },
        },
        required: ["root", "pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Grep: найти строки, содержащие запрос, в текстовых файлах под корневой папкой.",
      parameters: {
        type: "object",
        properties: {
          root: { type: "string" },
          query: { type: "string" },
        },
        required: ["root", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_path",
      description: "Открыть файл, папку или URL в приложении по умолчанию (проводник/браузер).",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "screenshot",
      description:
        "Сделать скриншот всего экрана. Возвращает путь к PNG — затем можно попросить пользователя показать его или проанализировать зрением.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "http_get",
      description: "Загрузить содержимое URL (текст/HTML/JSON). Для чтения веб-страниц и API.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  // --- computer-use: the agent's hands on the machine ---
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Напечатать текст как с клавиатуры в активное окно/поле.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "key_combo",
      description: "Нажать сочетание клавиш, например [\"ctrl\",\"c\"], [\"alt\",\"tab\"], [\"win\",\"d\"], [\"enter\"].",
      parameters: {
        type: "object",
        properties: { keys: { type: "array", items: { type: "string" } } },
        required: ["keys"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_move",
      description: "Переместить курсор в абсолютные координаты экрана.",
      parameters: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" } },
        required: ["x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_click",
      description: "Клик мышью в (x,y) или по текущей позиции. button: left|right|middle.",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          button: { type: "string", enum: ["left", "right", "middle"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_scroll",
      description: "Прокрутка колесом: положительное — вниз, отрицательное — вверх.",
      parameters: {
        type: "object",
        properties: { amount: { type: "number" } },
        required: ["amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clipboard_get",
      description: "Прочитать текст из буфера обмена.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "clipboard_set",
      description: "Положить текст в буфер обмена.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_processes",
      description: "Список запущенных процессов.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_windows",
      description: "Список открытых окон с заголовками.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "active_window",
      description: "Активное (сфокусированное) окно: приложение и заголовок.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "open_app",
      description: "Запустить приложение по имени или пути (например notepad, chrome).",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "close_app",
      description: "Принудительно закрыть приложение по имени процесса (например notepad.exe).",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
];

const MAX_STEPS = 8;

// Tools that change the system need explicit user approval before they run.
export const DESTRUCTIVE = new Set([
  "run_command",
  "write_file",
  "edit_file",
  "type_text",
  "key_combo",
  "mouse_click",
  "open_app",
  "close_app",
]);

/** Human-readable one-liner describing what a destructive tool call will do. */
export function describeCall(name: string, args: Record<string, unknown>): string {
  if (name === "run_command") {
    const cwd = args.cwd ? ` (в ${String(args.cwd)})` : "";
    return `Выполнить команду${cwd}:\n${String(args.cmd ?? "")}`;
  }
  if (name === "write_file") {
    const content = String(args.content ?? "");
    const preview = content.length > 400 ? content.slice(0, 400) + "…" : content;
    return `Записать файл ${String(args.path ?? "")}:\n${preview}`;
  }
  if (name === "edit_file") {
    return `Изменить файл ${String(args.path ?? "")}:\n- ${String(args.old ?? "")}\n+ ${String(args.new ?? "")}`;
  }
  if (name === "type_text") return `Напечатать текст:\n${String(args.text ?? "")}`;
  if (name === "key_combo") return `Нажать клавиши: ${(Array.isArray(args.keys) ? args.keys : []).join(" + ")}`;
  if (name === "mouse_click") {
    const at = args.x != null && args.y != null ? ` в (${args.x}, ${args.y})` : " по текущей позиции";
    return `Клик мышью (${String(args.button ?? "left")})${at}`;
  }
  if (name === "open_app") return `Запустить приложение: ${String(args.name ?? "")}`;
  if (name === "close_app") return `Принудительно закрыть: ${String(args.name ?? "")}`;
  return `${name}(${JSON.stringify(args)})`;
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "run_command": {
        const res = await invoke<CommandResult>("run_command", {
          cmd: String(args.cmd ?? ""),
          cwd: args.cwd ? String(args.cwd) : null,
        });
        return [res.stdout, res.stderr && `stderr: ${res.stderr}`, `код: ${res.code}`]
          .filter(Boolean)
          .join("\n")
          .slice(0, 8000);
      }
      case "read_file":
        return (await invoke<string>("read_file", { path: String(args.path ?? "") })).slice(0, 12000);
      case "write_file":
        await invoke("write_file", { path: String(args.path ?? ""), content: String(args.content ?? "") });
        return "записано";
      case "edit_file":
        return await invoke<string>("edit_file", {
          path: String(args.path ?? ""),
          old: String(args.old ?? ""),
          new: String(args.new ?? ""),
        });
      case "list_dir":
        return (await invoke<string[]>("list_dir", { path: String(args.path ?? "") })).join("\n");
      case "find_files":
        return (
          await invoke<string[]>("find_files", {
            root: String(args.root ?? ""),
            pattern: String(args.pattern ?? ""),
            max: 200,
          })
        ).join("\n") || "ничего не найдено";
      case "search_files":
        return (
          await invoke<string[]>("search_files", {
            root: String(args.root ?? ""),
            query: String(args.query ?? ""),
            max: 200,
          })
        ).join("\n") || "совпадений нет";
      case "open_path":
        await invoke("open_path", { path: String(args.path ?? "") });
        return "открыто";
      case "screenshot":
        return `скриншот сохранён: ${await invoke<string>("screenshot")}`;
      case "http_get": {
        const res = await fetch(String(args.url ?? ""));
        const text = await res.text();
        return `HTTP ${res.status}\n${text.slice(0, 12000)}`;
      }
      case "type_text":
        await invoke("type_text", { text: String(args.text ?? "") });
        return "напечатано";
      case "key_combo":
        await invoke("key_combo", { keys: Array.isArray(args.keys) ? args.keys.map(String) : [] });
        return "нажато";
      case "mouse_move":
        await invoke("mouse_move", { x: Number(args.x), y: Number(args.y) });
        return "курсор перемещён";
      case "mouse_click":
        await invoke("mouse_click", {
          x: args.x != null ? Number(args.x) : null,
          y: args.y != null ? Number(args.y) : null,
          button: args.button ? String(args.button) : null,
        });
        return "клик";
      case "mouse_scroll":
        await invoke("mouse_scroll", { amount: Number(args.amount ?? 0) });
        return "прокручено";
      case "clipboard_get":
        return (await invoke<string>("clipboard_get")).slice(0, 12000) || "(буфер пуст)";
      case "clipboard_set":
        await invoke("clipboard_set", { text: String(args.text ?? "") });
        return "в буфере";
      case "list_processes":
        return (await invoke<string>("list_processes")).slice(0, 8000);
      case "list_windows":
        return (await invoke<string>("list_windows")).slice(0, 8000) || "нет окон с заголовками";
      case "active_window":
        return (await invoke<string>("active_window")) || "не определено";
      case "open_app":
        await invoke("open_app", { name: String(args.name ?? "") });
        return "запущено";
      case "close_app":
        await invoke("close_app", { name: String(args.name ?? "") });
        return "закрыто";
      default:
        return `неизвестный инструмент: ${name}`;
    }
  } catch (e) {
    return `ошибка инструмента: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export type AgentCallbacks = {
  onText: (text: string) => void;
  onStep: (label: string) => void;
  // Ask the user to approve a destructive tool call. Resolve true to run, false to skip.
  // When omitted, destructive tools run without prompting (legacy behaviour).
  onApprove?: (summary: string) => Promise<boolean>;
  signal?: AbortSignal;
};

/** Run the agent to completion. `history` is the prior conversation (system/user/assistant). */
export async function runAgent(
  settings: BrainSettings,
  history: AgentMessage[],
  cb: AgentCallbacks,
): Promise<void> {
  const messages: AgentMessage[] = [...history];

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (cb.signal?.aborted) return;
    const reply = await chatWithTools(settings, messages, TOOLS, cb.signal);
    messages.push(reply);

    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      if (reply.content) cb.onText(reply.content);
      return;
    }

    if (reply.content) cb.onText(reply.content + "\n");
    for (const call of reply.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      cb.onStep(`🛠 ${call.function.name}(${short(call.function.arguments)})`);
      if (DESTRUCTIVE.has(call.function.name) && cb.onApprove) {
        const approved = await cb.onApprove(describeCall(call.function.name, args));
        if (!approved) {
          cb.onStep("↳ ⛔ отклонено пользователем");
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: "Пользователь отклонил выполнение этого действия.",
          });
          continue;
        }
      }
      const result = await executeTool(call.function.name, args);
      cb.onStep(`↳ ${short(result, 300)}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  cb.onText("\n⚠️ Достигнут лимит шагов агента.");
}

function short(text: string, cap = 120): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  return s.length > cap ? s.slice(0, cap) + "…" : s;
}
