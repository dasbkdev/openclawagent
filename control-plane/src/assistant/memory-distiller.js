import { upsertAssistantFact } from "../domain/assistant-facts.js";
import {
  listOpenAssistantLoops,
  openAssistantLoop,
  resolveAssistantLoop,
} from "../domain/assistant-open-loops.js";
import { recordTokenUsageEvent } from "../domain/token-usage.js";

const DEFAULT_MEMORY_MODEL = "claude-haiku-4-5-20251001";
const FACT_CATEGORIES = new Set(["commitment", "preference", "habit", "project", "other"]);
const LOOP_KINDS = new Set(["command_follow_up", "promise", "question", "task_progress", "other"]);

export async function distillAssistantMemory({
  store,
  claudeClient,
  actor,
  question,
  answer,
  now = new Date(),
  env = process.env,
}) {
  if (!claudeClient || claudeClient.configured === false) {
    return { applied: false, reason: "claude-not-configured" };
  }
  const actorUserId = actor?.id || null;
  if (!actorUserId) {
    return { applied: false, reason: "no-actor" };
  }

  try {
    const state = await store.load();
    const openLoops = listOpenAssistantLoops(state, { userIds: [actorUserId], limit: 20 });
    const model = env.CLAUDE_MEMORY_MODEL || DEFAULT_MEMORY_MODEL;
    const completion = await claudeClient.complete({
      system: buildDistillSystemPrompt(),
      user: buildDistillUserPrompt({ question, answer, openLoops }),
      maxTokens: 700,
      model,
    });

    const parsed = parseDistillation(completion.text);
    if (!parsed) {
      return { applied: false, reason: "unparsable" };
    }

    const openLoopIds = new Set(openLoops.map((loop) => loop.id));
    const result = await store.update((currentState) => {
      let factCount = 0;
      let resolvedCount = 0;
      let newLoopCount = 0;

      for (const fact of parsed.newFacts) {
        const created = upsertAssistantFact(currentState, {
          userId: actorUserId,
          category: fact.category,
          text: fact.text,
          now,
        });
        if (created) {
          factCount += 1;
        }
      }

      for (const loopId of parsed.resolvedLoopIds) {
        if (!openLoopIds.has(loopId)) {
          continue;
        }
        const resolved = resolveAssistantLoop(currentState, {
          id: loopId,
          userId: actorUserId,
          resolution: "Закрыто по итогам диалога ассистента.",
          now,
        });
        if (resolved) {
          resolvedCount += 1;
        }
      }

      for (const loop of parsed.newLoops) {
        const created = openAssistantLoop(currentState, {
          userId: actorUserId,
          kind: loop.kind,
          text: loop.text,
          source: { type: "assistant-distiller", id: null },
          now,
        });
        if (created) {
          newLoopCount += 1;
        }
      }

      if (completion.usage) {
        recordDistillUsage(currentState, { actorUserId, completion, model, now });
      }

      return { factCount, resolvedCount, newLoopCount };
    });

    return { applied: true, ...result };
  } catch (error) {
    console.error(
      "memory-distiller failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { applied: false, reason: "error" };
  }
}

function recordDistillUsage(state, { actorUserId, completion, model, now }) {
  try {
    const usage = completion.usage;
    const totalTokens =
      usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    if (totalTokens === 0) {
      return;
    }
    recordTokenUsageEvent(
      state,
      {
        userId: actorUserId,
        action: "assistant.memory.distill",
        source: "memory-distiller",
        provider: "anthropic",
        model: completion.model || model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        totalTokens,
      },
      { now },
    );
  } catch {
    // Token usage accounting is nice-to-have; never break distillation over it.
  }
}

export function parseDistillation(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const newFacts = (Array.isArray(payload.newFacts) ? payload.newFacts : [])
    .map((fact) => ({
      category: FACT_CATEGORIES.has(fact?.category) ? fact.category : "other",
      text: String(fact?.text || "").trim(),
    }))
    .filter((fact) => fact.text);

  const resolvedLoopIds = (Array.isArray(payload.resolvedLoopIds) ? payload.resolvedLoopIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);

  const newLoops = (Array.isArray(payload.newLoops) ? payload.newLoops : [])
    .map((loop) => ({
      kind: LOOP_KINDS.has(loop?.kind) ? loop.kind : "other",
      text: String(loop?.text || "").trim(),
    }))
    .filter((loop) => loop.text);

  return { newFacts, resolvedLoopIds, newLoops };
}

function buildDistillSystemPrompt() {
  return [
    "Ты — модуль долговременной памяти AI-ассистента компании Starlab.",
    "Из пары вопрос+ответ и списка текущих открытых дел извлеки структурированные данные.",
    "Верни СТРОГО валидный JSON без пояснений, без markdown, без текста до или после.",
    "Формат: {\"newFacts\":[{\"category\":\"commitment|preference|habit|project|other\",\"text\":\"...\"}],\"resolvedLoopIds\":[\"...\"],\"newLoops\":[{\"kind\":\"command_follow_up|promise|question|task_progress|other\",\"text\":\"...\"}]}",
    "newFacts — устойчивые факты о сотруднике (обязательства, предпочтения, привычки, проекты). Не короткоживущая болтовня.",
    "resolvedLoopIds — id тех открытых дел из списка, которые этот диалог закрывает.",
    "newLoops — новые незакрытые дела (обещания, вопросы без ответа, начатые задачи).",
    "Пустые массивы — это норма. Ничего не выдумывай: только то, что явно есть в диалоге.",
    "Текст факта не длиннее 500 символов, на русском языке.",
  ].join(" ");
}

function buildDistillUserPrompt({ question, answer, openLoops }) {
  return [
    "Вопрос пользователя:",
    String(question || "").trim() || "(пусто)",
    "",
    "Ответ ассистента:",
    String(answer || "").trim() || "(пусто)",
    "",
    "Текущие открытые дела (id — текст):",
    openLoops.length
      ? openLoops.map((loop) => `${loop.id} — ${loop.text}`).join("\n")
      : "(нет открытых дел)",
    "",
    "Верни JSON по заданной схеме.",
  ].join("\n");
}
