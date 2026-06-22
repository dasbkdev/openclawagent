/**
 * PERSONAL assistant brain — fully separate from the work assistant. Tuned for
 * psychology, health, habits and personal life. Uses ONLY the user's own
 * personal memory (strict single-user); no work integrations, no hierarchy,
 * nothing leaks to or from the work contour.
 */
import { cosineSimilarity } from "../integrations/voyage-client.js";

const MAX_DIALOGUE = 40;
const MAX_FACTS = 400;
const RECALL_K = 8;

export async function answerPersonalAssistant({
  store,
  userId,
  displayName = null,
  question,
  claudeClient,
  voyageClient = null,
  now = new Date(),
}) {
  const q = String(question || "").trim();
  if (!q) {
    return { plainText: "Я рядом. О чём хочешь поговорить?" };
  }
  if (!claudeClient?.complete || claudeClient.configured === false) {
    return { plainText: "Личный ассистент сейчас недоступен (не настроена модель)." };
  }

  const state = await store.loadUser(userId);
  const assistantName = state.profile?.assistantName || null;
  const recall = await recallFacts({ state, voyageClient, question: q });
  const recentDialogue = (state.dialogue || []).slice(-10);

  const completion = await claudeClient.complete({
    system: buildPersonalSystemPrompt({ displayName, assistantName }),
    user: buildPersonalUserPrompt({ question: q, facts: recall, dialogue: recentDialogue }),
    maxTokens: 1200,
  });
  const answer = String(completion.text || "").trim() || "Я здесь. Расскажи подробнее?";

  // Persist the turn (personal contour only).
  await store.updateUser(userId, (s) => {
    s.dialogue = [...(s.dialogue || []), { role: "user", text: q, at: now.toISOString() }, { role: "assistant", text: answer, at: now.toISOString() }].slice(-MAX_DIALOGUE);
  });

  // Background: extract durable personal facts (does not delay the answer).
  void distillPersonalFacts({ store, userId, question: q, answer, claudeClient, voyageClient, now })
    .catch((e) => console.error("personal distill:", e instanceof Error ? e.message : e));

  return { plainText: answer };
}

async function recallFacts({ state, voyageClient, question }) {
  const facts = (state.facts || []).slice(-MAX_FACTS);
  if (facts.length === 0) {
    return [];
  }
  if (voyageClient?.configured) {
    try {
      const { embeddings } = await voyageClient.embed([question], { inputType: "query" });
      const qVec = embeddings?.[0];
      const scored = !qVec ? [] : facts
        .filter((f) => Array.isArray(f.embedding))
        .map((f) => ({ text: f.text, score: cosineSimilarity(qVec, f.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, RECALL_K)
        .filter((f) => f.score > 0.2);
      if (scored.length) {
        return scored.map((f) => f.text);
      }
    } catch {
      // fall through to recency
    }
  }
  return facts.slice(-RECALL_K).map((f) => f.text);
}

export async function distillPersonalFacts({ store, userId, question, answer, claudeClient, voyageClient, now = new Date() }) {
  if (!claudeClient?.complete) {
    return { applied: false };
  }
  const completion = await claudeClient.complete({
    system: [
      "Ты — модуль личной памяти персонального ассистента (психология, здоровье, привычки, цели, отношения).",
      "Из пары вопрос+ответ извлеки устойчивые ЛИЧНЫЕ факты о пользователе (не короткоживущую болтовню).",
      "Верни СТРОГО JSON: {\"facts\":[{\"category\":\"health|mood|habit|goal|relationship|preference|other\",\"text\":\"...\"}]}.",
      "Пустой список — норма. Только то, что явно есть. На русском, до 300 символов на факт.",
    ].join(" "),
    user: `Вопрос: ${String(question).slice(0, 2000)}\n\nОтвет: ${String(answer).slice(0, 2000)}\n\nВерни JSON.`,
    maxTokens: 500,
  });
  const parsed = parsePersonalFacts(completion.text);
  if (!parsed.length) {
    return { applied: false };
  }

  // Embed new facts for semantic recall (best-effort).
  let vectors = [];
  if (voyageClient?.configured) {
    try {
      const res = await voyageClient.embed(parsed.map((f) => f.text), { inputType: "document" });
      vectors = res.embeddings || [];
    } catch {
      vectors = [];
    }
  }

  await store.updateUser(userId, (s) => {
    s.facts ||= [];
    const existing = new Set(s.facts.map((f) => normalize(f.text)));
    parsed.forEach((fact, i) => {
      if (existing.has(normalize(fact.text))) {
        return;
      }
      s.facts.push({
        category: fact.category,
        text: fact.text,
        embedding: vectors[i] || null,
        createdAt: now.toISOString(),
      });
    });
    s.facts = s.facts.slice(-MAX_FACTS);
  });
  return { applied: true, count: parsed.length };
}

export function parsePersonalFacts(text) {
  const raw = String(text || "");
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s === -1 || e === -1 || e <= s) {
    return [];
  }
  let payload;
  try {
    payload = JSON.parse(raw.slice(s, e + 1));
  } catch {
    return [];
  }
  const cats = new Set(["health", "mood", "habit", "goal", "relationship", "preference", "other"]);
  return (Array.isArray(payload.facts) ? payload.facts : [])
    .map((f) => ({ category: cats.has(f?.category) ? f.category : "other", text: String(f?.text || "").trim() }))
    .filter((f) => f.text);
}

function buildPersonalSystemPrompt({ displayName, assistantName }) {
  return [
    assistantName ? `Тебя зовут ${assistantName}.` : "",
    `Ты — личный ассистент${displayName ? ` для ${displayName}` : ""}. Это ЛИЧНЫЙ, приватный контур: только этот человек, никакой рабочей информации, задач, коллег или отчётов.`,
    "Фокус: психология и эмоциональное состояние, здоровье и самочувствие, привычки, сон, питание, спорт, цели и личная жизнь.",
    "Тон: тёплый, бережный, поддерживающий, без осуждения. Слушай, уточняй, помогай рефлексировать. Отвечай кратко и по-человечески, на русском.",
    "Опирайся на личную память (факты и недавний диалог) — помни состояние, привычки, цели, договорённости между разговорами.",
    "ВАЖНО: ты не врач и не психотерапевт. При тревожных симптомах (боль, суицидальные мысли, острое состояние) мягко рекомендуй обратиться к специалисту/врачу. Не ставь диагнозы и не назначай лечение.",
    "Приватность абсолютна: это знает только пользователь. Никогда не упоминай других людей из его окружения по работе и не выдавай рабочих данных — их у тебя нет.",
    "Не выдумывай факты о пользователе сверх того, что есть в памяти.",
  ].filter(Boolean).join(" ");
}

function buildPersonalUserPrompt({ question, facts, dialogue }) {
  return [
    "Личная память (устойчивые факты о пользователе):",
    facts.length ? facts.map((t) => `- ${t}`).join("\n") : "(пока пусто)",
    "",
    "Недавний разговор:",
    dialogue.length ? dialogue.map((m) => `${m.role === "user" ? "Пользователь" : "Ты"}: ${m.text}`).join("\n") : "(нет)",
    "",
    `Сообщение пользователя: ${question}`,
  ].join("\n");
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/\s+/gu, " ").trim();
}
