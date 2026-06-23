/**
 * Turn a transcribed employee voice message into a structured timeline entry,
 * using the employee's same-day timeline as context so the model can chain
 * "закончил встречу" to the open "начал встречу" and recognise tasks. Quality
 * over cost — we pass rich context and ask for an accurate, faithful result.
 */
import { VOICE_KINDS } from "../domain/voice-timeline.js";

export async function extractVoiceActivity({ claudeClient, transcript, dayEntries = [], now = new Date() }) {
  const text = String(transcript || "").trim();
  if (!text) {
    return fallback("");
  }
  if (!claudeClient?.complete) {
    return fallback(text);
  }
  try {
    const completion = await claudeClient.complete({
      system: buildSystem(),
      user: buildUser({ text, dayEntries, now }),
      maxTokens: 600,
    });
    const parsed = parseExtraction(completion.text);
    return parsed || fallback(text);
  } catch {
    return fallback(text);
  }
}

export function parseExtraction(raw) {
  const s = String(raw || "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a === -1 || b === -1 || b <= a) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
  const kind = VOICE_KINDS.includes(payload?.kind) ? payload.kind : "заметка";
  return {
    statedTime: normalizeTime(payload?.statedTime),
    kind,
    activity: String(payload?.activity || "").trim().slice(0, 200),
    relatedPerson: String(payload?.relatedPerson || "").trim().slice(0, 80) || null,
    cleanedText: String(payload?.cleanedText || "").trim() || null,
    isQuestion: Boolean(payload?.isQuestion),
  };
}

function buildSystem() {
  return [
    "Ты — модуль учёта рабочей активности по голосовым сообщениям сотрудников.",
    "Тебе дают расшифровку голосового и сегодняшний таймлайн этого сотрудника.",
    "Верни СТРОГО JSON без пояснений:",
    "{\"statedTime\":\"HH:MM или null\",\"kind\":\"начало|конец|задание|заметка\",\"activity\":\"...\",\"relatedPerson\":\"имя или пусто\",\"cleanedText\":\"...\",\"isQuestion\":false}",
    "Правила:",
    "- statedTime: время, НАЗВАННОЕ в самом сообщении (например «12:05»). Если не названо — null. НИКОГДА не выдумывай и не подставляй текущее время.",
    "- kind: «начало» если сотрудник начинает дело/встречу/задачу; «конец» если завершает (закончил/завершил/закрыл); «задание» если ему дали поручение (например «Николай поручил…»); иначе «заметка».",
    "- activity: короткая суть на русском («встреча с Бегайым», «купить технику для офиса»). Для «конец» — та же активность, что у соответствующего «начало», чтобы их можно было связать.",
    "- relatedPerson: упомянутый человек (с кем встреча / от кого задание), иначе пусто.",
    "- cleanedText: аккуратная версия расшифровки — поправь явные ошибки распознавания по смыслу, но НЕ меняй числа, время и имена. Сохрани смысл дословно.",
    "- isQuestion: true, если это вопрос/просьба к ассистенту, а не отметка об активности.",
    "Опирайся на таймлайн дня, чтобы «конец» относился к правильному «начало».",
  ].join("\n");
}

function buildUser({ text, dayEntries, now }) {
  const ctx = (dayEntries || []).slice(-20).map((e) => {
    const t = e.statedTime || "(время не названо)";
    return `- [${e.kind}] ${t} ${e.activity || ""}${e.relatedPerson ? ` (с ${e.relatedPerson})` : ""}${e.kind === "начало" && !e.durationMinutes ? " — ещё открыто" : ""}`;
  });
  return [
    `Текущее время (Бишкек): ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now)}.`,
    "",
    "Сегодняшний таймлайн сотрудника:",
    ctx.length ? ctx.join("\n") : "(пока пусто)",
    "",
    "Расшифровка нового голосового:",
    text,
    "",
    "Верни JSON.",
  ].join("\n");
}

function fallback(text) {
  // No model: best-effort from a leading "HH:MM" and simple keywords.
  const statedTime = normalizeTime(text);
  let kind = "заметка";
  if (/(законч|заверш|закрыл|закончил|завершил)/iu.test(text)) {
    kind = "конец";
  } else if (/(начина|начал|приступ|иду на|стартую|начинаю)/iu.test(text)) {
    kind = "начало";
  } else if (/(поручил|задани|попросил|нужно|надо)/iu.test(text)) {
    kind = "задание";
  }
  const isQuestion =
    /\?/u.test(text) ||
    /(ответь|скажи|подскажи|расскажи|голосом|как\s|что\s|почему|зачем|когда\s|сколько|кто\s|где\s|какой|какая)/iu.test(text);
  return { statedTime, kind, activity: text.slice(0, 200), relatedPerson: null, cleanedText: text, isQuestion };
}

function normalizeTime(value) {
  const m = /(\d{1,2})[:.\s](\d{2})/u.exec(String(value || ""));
  if (!m) {
    return null;
  }
  const h = Math.min(23, Number(m[1]));
  const min = Math.min(59, Number(m[2]));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
