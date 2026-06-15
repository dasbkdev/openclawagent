import { extractToolUseBlocks } from "./claude-client.js";
import {
  createDeviceCommand,
  DEVICE_ACTION_TYPES,
  isSensitiveDeviceAction,
  listVisibleDeviceAgents,
} from "../domain/device-agents.js";
import { validation } from "../domain/errors.js";
import { recordTokenUsageEvent } from "../domain/token-usage.js";
import { appendAuditEvent } from "../infra/audit.js";
import { appendTimelineEvent } from "../domain/work-timeline.js";

const DEFAULT_MAX_STEPS = 12;
const DEFAULT_COMMAND_WAIT_MS = 90_000;
const COMMAND_POLL_MS = 1_000;
const DEFAULT_MODEL = process.env.CLAUDE_AGENT_MODEL || "claude-sonnet-4-6";

/**
 * Human-readable, JSON-schema tool definitions for the device action types.
 * Only a curated, planner-friendly subset is exposed; each maps 1:1 to a
 * device command type the executor understands.
 */
export const DEVICE_TOOL_SCHEMAS = Object.freeze([
  tool("open_app", "Открыть/запустить приложение на компьютере сотрудника.", {
    app: { type: "string", description: "Имя приложения, напр. 'Google Chrome'." },
  }, ["app"]),
  tool("close_app", "Закрыть приложение.", {
    app: { type: "string", description: "Имя приложения." },
  }, ["app"]),
  tool("open_url", "Открыть ссылку в браузере по умолчанию.", {
    url: { type: "string", description: "Полный URL (http/https)." },
  }, ["url"]),
  tool("open_file", "Открыть файл или папку в системе.", {
    path: { type: "string", description: "Абсолютный путь к файлу или папке." },
  }, ["path"]),
  tool("list_running_apps", "Получить список запущенных приложений.", {}),
  tool("active_window", "Узнать активное окно/приложение на переднем плане.", {}),
  tool("screenshot", "Сделать скриншот экрана сотрудника (с его согласия).", {}),
  tool("clipboard_get", "Прочитать содержимое буфера обмена.", {}),
  tool("clipboard_set", "Положить текст в буфер обмена.", {
    text: { type: "string" },
  }, ["text"]),
  tool("notify", "Показать всплывающее уведомление на рабочем столе сотрудника.", {
    title: { type: "string" },
    message: { type: "string" },
  }, ["message"]),
  tool("read_file", "Прочитать текстовый файл с компьютера сотрудника.", {
    path: { type: "string", description: "Абсолютный путь к файлу." },
  }, ["path"]),
  tool("write_file", "Записать текст в файл (требует подтверждения сотрудника).", {
    path: { type: "string" },
    content: { type: "string" },
  }, ["path", "content"]),
  tool("list_dir", "Получить список файлов в папке.", {
    path: { type: "string" },
  }, ["path"]),
  tool("search_files", "Найти файлы по имени/маске в папке.", {
    path: { type: "string", description: "Папка для поиска." },
    query: { type: "string", description: "Имя или маска, напр. '*.xlsx'." },
  }, ["path", "query"]),
  tool("make_dir", "Создать папку.", {
    path: { type: "string" },
  }, ["path"]),
  tool("move_path", "Переместить/переименовать файл или папку (требует подтверждения).", {
    from: { type: "string" },
    to: { type: "string" },
  }, ["from", "to"]),
  tool("run_script", "Выполнить скрипт в системной оболочке (PowerShell/shell). Самый мощный инструмент — требует подтверждения сотрудника. Используй только когда другие инструменты не подходят.", {
    script: { type: "string", description: "Текст скрипта." },
    lang: { type: "string", description: "Оболочка: 'powershell' | 'shell' | 'applescript'." },
  }, ["script"]),
  tool("media_control", "Управление медиа: play/pause/next/previous.", {
    command: { type: "string", description: "play_pause | next | previous" },
  }, ["command"]),
  tool("set_volume", "Установить громкость (0-100).", {
    level: { type: "number" },
  }, ["level"]),
  tool("system_info", "Получить сведения о системе сотрудника.", {}),
  tool("play_youtube", "Найти и включить видео/музыку на YouTube.", {
    query: { type: "string" },
  }, ["query"]),
]);

const FINISH_TOOL = tool(
  "finish_task",
  "Заверши задачу: вызови, когда цель достигнута или дальше двигаться невозможно. Подведи итог для сотрудника.",
  {
    summary: { type: "string", description: "Короткий понятный итог: что сделано и результат." },
    success: { type: "boolean", description: "true если цель достигнута." },
  },
  ["summary", "success"],
);

/**
 * Run a multi-step desktop agent task. Claude plans, calls device tools,
 * and the loop executes each tool by enqueuing a device command and waiting
 * for the executor to report the result. Stops on finish_task, end_turn,
 * an error, or maxSteps.
 *
 * `enqueueAndWait({ type, args })` is injected by the caller (router/bot):
 * it must create the device command for the resolved device and resolve to
 * `{ status, result, error }` once the device reports back (or times out).
 */
export async function runAgentTask({
  store,
  claudeClient,
  actor,
  device,
  instruction,
  enqueueAndWait,
  maxSteps = DEFAULT_MAX_STEPS,
  onProgress = () => {},
  now = new Date(),
}) {
  const trimmed = String(instruction || "").trim();
  if (!trimmed) {
    return { ok: false, summary: "Пустая инструкция.", steps: [] };
  }
  if (!claudeClient?.configured) {
    return { ok: false, summary: "Claude API не настроен — задача не может быть выполнена.", steps: [] };
  }

  const platform = device?.platform || "unknown";
  const capabilities = new Set(device?.capabilities || []);
  const availableTools = DEVICE_TOOL_SCHEMAS.filter((schema) =>
    DEVICE_ACTION_TYPES.includes(schema.name) &&
    (capabilities.size === 0 || capabilities.has(schema.name)),
  );
  const tools = [...availableTools, FINISH_TOOL];

  const messages = [{ role: "user", content: trimmed }];
  const steps = [];
  let totalUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let finalSummary = null;
  let finalSuccess = false;

  for (let step = 0; step < maxSteps; step += 1) {
    let payload;
    try {
      payload = await claudeClient.sendMessages({
        system: buildAgentSystemPrompt({ device, platform }),
        messages,
        tools,
        maxTokens: 1500,
        model: DEFAULT_MODEL,
      });
    } catch (error) {
      finalSummary = `Ошибка планировщика: ${error instanceof Error ? error.message : String(error)}`;
      break;
    }

    totalUsage = addUsage(totalUsage, payload.usage);
    const toolUses = extractToolUseBlocks(payload);
    const assistantText = readText(payload);

    if (toolUses.length === 0) {
      finalSummary = assistantText || "Готово.";
      finalSuccess = true;
      break;
    }

    messages.push({ role: "assistant", content: payload.content });
    const toolResults = [];

    let finished = false;
    for (const toolUse of toolUses) {
      if (toolUse.name === "finish_task") {
        finalSummary = String(toolUse.input?.summary || assistantText || "Готово.");
        finalSuccess = Boolean(toolUse.input?.success);
        finished = true;
        toolResults.push(toolResultBlock(toolUse.id, "Задача завершена."));
        continue;
      }

      const type = toolUse.name;
      const args = toolUse.input || {};
      onProgress({ kind: "step", type, args, index: steps.length + 1 });

      let outcome;
      try {
        outcome = await enqueueAndWait({ type, args });
      } catch (error) {
        outcome = { status: "failed", error: error instanceof Error ? error.message : String(error) };
      }

      steps.push({
        type,
        args: redactArgs(args),
        status: outcome.status,
        sensitive: isSensitiveDeviceAction(type),
      });
      onProgress({ kind: "result", type, status: outcome.status });

      toolResults.push(
        toolResultBlock(
          toolUse.id,
          formatToolResult(outcome),
          outcome.status !== "succeeded",
        ),
      );
    }

    messages.push({ role: "user", content: toolResults });
    if (finished) {
      break;
    }
  }

  if (finalSummary === null) {
    finalSummary = "Достигнут лимит шагов. Задача может быть выполнена не полностью.";
  }

  void appendTimelineEvent({
    dataFilePath: store.filePath || null,
    userId: device?.userId || actor.id,
    event: {
      ts: now.toISOString(),
      kind: "agent_task",
      actorUserId: actor.id,
      title: trimmed.slice(0, 200),
      detail: `${trimmed}\n\nИтог: ${finalSummary}`,
      links: { userIds: [actor.id, device?.userId].filter(Boolean) },
      source: "agent-loop",
      metadata: {
        deviceId: device?.deviceId || null,
        success: finalSuccess,
        steps: steps.map((s) => ({ type: s.type, status: s.status })),
      },
    },
  });

  await store.update((state) => {
    appendAuditEvent(state, {
      actorUserId: actor.id,
      actorTelegramUserId: actor.telegram?.telegramUserId ?? null,
      action: "agent.task.run",
      target: { deviceId: device?.deviceId || null, userId: device?.userId || null },
      metadata: {
        steps: steps.length,
        success: finalSuccess,
        types: steps.map((s) => s.type),
      },
    });
    const total =
      totalUsage.inputTokens + totalUsage.outputTokens + totalUsage.cacheReadTokens + totalUsage.cacheWriteTokens;
    if (total > 0) {
      recordTokenUsageEvent(state, {
        userId: actor.id,
        action: "agent.task",
        source: "agent-loop",
        provider: "anthropic",
        model: DEFAULT_MODEL,
        inputTokens: totalUsage.inputTokens,
        outputTokens: totalUsage.outputTokens,
        cacheReadTokens: totalUsage.cacheReadTokens,
        cacheWriteTokens: totalUsage.cacheWriteTokens,
        totalTokens: total,
        metadata: { deviceId: device?.deviceId || null },
      }, { now });
    }
  });

  return { ok: finalSuccess, summary: finalSummary, steps };
}

/**
 * Build an enqueue+wait function bound to a device. Creates the command via
 * the domain layer (inside store.update) and polls until the executor
 * reports a terminal status or the timeout elapses.
 */
export function makeDeviceCommandRunner({ store, actor, device, timeoutMs = DEFAULT_COMMAND_WAIT_MS }) {
  return async function enqueueAndWait({ type, args }) {
    let command;
    try {
      command = await store.update((state) =>
        createDeviceCommand(state, {
          deviceId: device.deviceId,
          type,
          args,
          source: "agent-loop",
        }, { actor }),
      );
    } catch (error) {
      return { status: "unsupported", error: error instanceof Error ? error.message : String(error) };
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(COMMAND_POLL_MS);
      const state = await store.load();
      const current = (state.deviceCommands || []).find((item) => item.id === command.id);
      if (!current) {
        return { status: "failed", error: "command disappeared" };
      }
      if (["succeeded", "failed", "rejected", "unsupported", "expired"].includes(current.status)) {
        return { status: current.status, result: current.result, error: current.error };
      }
    }
    return { status: "failed", error: "device did not respond in time" };
  };
}

export function resolveAgentTaskDevice(state, actor, body) {
  const agents = listVisibleDeviceAgents(state, actor);
  if (agents.length === 0) {
    throw validation("Нет доступных устройств с агентом для выполнения задачи");
  }
  const deviceId = body?.deviceId ? String(body.deviceId).trim() : null;
  if (deviceId) {
    const byId = agents.find((agent) => agent.deviceId === deviceId);
    if (!byId) {
      throw validation("Устройство недоступно", { deviceId });
    }
    return byId;
  }
  const own = agents
    .filter((agent) => agent.userId === actor.id)
    .sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")));
  if (own.length > 0) {
    return own[0];
  }
  return agents
    .slice()
    .sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")))[0];
}

function buildAgentSystemPrompt({ device, platform }) {
  return [
    "Ты — исполнительный агент Starlab, управляющий компьютером сотрудника через набор инструментов.",
    `Платформа устройства: ${platform}. Устройство: ${device?.displayName || device?.deviceId || "неизвестно"}.`,
    "Разбей задачу на шаги и выполняй их инструментами по одному. После каждого результата решай следующий шаг.",
    "Используй самый специфичный инструмент. run_script — крайнее средство, только если иначе нельзя.",
    "Действия, помеченные как требующие подтверждения, сотрудник может отклонить — тогда подбери другой путь или заверши с объяснением.",
    "Не выдумывай результаты: опирайся только на фактические ответы инструментов.",
    "Когда цель достигнута или дальше нельзя — вызови finish_task с коротким понятным итогом на русском.",
    "Не запрашивай пароли, банковские данные и не выполняй необратимые разрушительные действия без явной цели в задаче.",
  ].join(" ");
}

function tool(name, description, properties, required = []) {
  return {
    name,
    description,
    input_schema: {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  };
}

function toolResultBlock(toolUseId, content, isError = false) {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: String(content).slice(0, 4000),
    ...(isError ? { is_error: true } : {}),
  };
}

function formatToolResult(outcome) {
  if (!outcome) {
    return "Нет ответа от устройства.";
  }
  if (outcome.status === "succeeded") {
    const r = outcome.result;
    if (r === null || r === undefined) {
      return "Успешно выполнено.";
    }
    return typeof r === "string" ? r : safeJson(r);
  }
  if (outcome.status === "rejected") {
    return `Сотрудник отклонил действие${outcome.error ? `: ${outcome.error}` : "."}`;
  }
  if (outcome.status === "unsupported") {
    return `Устройство не поддерживает это действие${outcome.error ? `: ${outcome.error}` : "."}`;
  }
  return `Не удалось выполнить${outcome.error ? `: ${outcome.error}` : "."}`;
}

function redactArgs(args) {
  const out = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (typeof value === "string" && value.length > 200) {
      out[key] = `${value.slice(0, 200)}…`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function readText(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  return blocks
    .filter((b) => b?.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function addUsage(total, usage) {
  if (!usage) {
    return total;
  }
  return {
    inputTokens: total.inputTokens + Number(usage.input_tokens || 0),
    outputTokens: total.outputTokens + Number(usage.output_tokens || 0),
    cacheReadTokens: total.cacheReadTokens + Number(usage.cache_read_input_tokens || 0),
    cacheWriteTokens: total.cacheWriteTokens + Number(usage.cache_creation_input_tokens || 0),
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value).slice(0, 2000);
  } catch {
    return String(value).slice(0, 2000);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
