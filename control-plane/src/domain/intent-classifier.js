/**
 * Optional LLM intent classifier — a SAFETY NET, not a replacement.
 *
 * The deterministic regex handlers run first (fast, predictable). Only when they
 * miss AND `INTENT_CLASSIFIER_ENABLED=true` does the handler call this to
 * normalize a messy phrase into a canonical command that the existing, tested
 * handlers understand (e.g. "слушай, скинь-ка Бегайым что я опоздаю" ->
 * "сообщи Бегайым что я опоздаю"). Off by default → zero behaviour change.
 */

const KNOWN_INTENTS = new Set([
  "relay",
  "broadcast",
  "plan_create",
  "plan_add",
  "plan_delete",
  "done",
  "question",
  "other",
]);

export function intentClassifierEnabled(env = process.env) {
  return String(env?.INTENT_CLASSIFIER_ENABLED || "").toLowerCase() === "true";
}

export async function classifyIntent({ claudeClient, text, users = [], env = process.env, model } = {}) {
  if (!intentClassifierEnabled(env)) {
    return null;
  }
  if (!claudeClient?.complete || claudeClient.configured === false) {
    return null;
  }
  const raw = String(text || "").trim();
  if (!raw || raw.startsWith("/")) {
    return null;
  }
  const directory = (users || [])
    .filter((u) => u.telegram?.telegramUserId)
    .map((u) => u.displayName)
    .filter(Boolean);
  try {
    const completion = await claudeClient.complete({
      system: buildSystemPrompt(),
      user: buildUserPrompt(raw, directory),
      maxTokens: 200,
      model: model || env.CLAUDE_MEMORY_MODEL || "claude-haiku-4-5-20251001",
    });
    return parseIntent(completion.text);
  } catch {
    return null;
  }
}

export function parseIntent(text) {
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
  const intent = KNOWN_INTENTS.has(payload?.intent) ? payload.intent : "other";
  const canonical = typeof payload?.canonical === "string" ? payload.canonical.trim() : "";
  if (intent === "other" || intent === "question" || !canonical) {
    return { intent, canonical: "" };
  }
  return { intent, canonical };
}

function buildSystemPrompt() {
  return [
    "Ты — классификатор намерений Telegram-бота Starlab. По одной реплике определи намерение и нормализуй её в каноническую команду.",
    "Верни СТРОГО JSON без пояснений: {\"intent\":\"...\",\"canonical\":\"...\"}.",
    "Намерения и канонический формат:",
    "- relay: сообщение сотруднику → canonical: «сообщи ИМЯ ТЕКСТ» (ИМЯ — из списка сотрудников).",
    "- broadcast: сообщение всем → canonical: «отправь всем ТЕКСТ».",
    "- plan_create: задать план дня → canonical: «План на сегодня: пункт1; пункт2».",
    "- plan_add: добавить в план дня → canonical: «добавь в план дня: пункт1; пункт2».",
    "- plan_delete: удалить пункт/план → canonical: «удали пункт ТЕКСТ из плана» или «очисти план дня».",
    "- done: отметить выполненным → canonical: исходная фраза.",
    "- question: вопрос ассистенту (сводки, данные, «что/как/во сколько») → canonical: \"\".",
    "- other: всё остальное → canonical: \"\".",
    "Если намерение неочевидно или это обычный вопрос — ставь question/other с пустым canonical. Не выдумывай получателя или текст, которых нет.",
  ].join("\n");
}

function buildUserPrompt(text, directory) {
  return [
    "Сотрудники (для relay выбирай ИМЯ только отсюда):",
    directory.length ? directory.join(", ") : "(нет)",
    "",
    "Реплика:",
    text,
    "",
    "Верни JSON {intent, canonical}.",
  ].join("\n");
}
