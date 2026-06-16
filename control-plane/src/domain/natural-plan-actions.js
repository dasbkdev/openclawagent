/**
 * Natural-language understanding for daily plans, so employees don't have to
 * use slash commands. Detects:
 *  - "План на сегодня\n1. ...\n2. ..." → create/update the daily plan.
 *  - "переговоры на 17:00 провели" / "я выполнил отчёт" → mark a matching
 *    plan item done (fuzzy, by keyword overlap).
 *
 * Pure parsing/matching only — the handler performs the state mutation via
 * the existing daily-assistant domain functions.
 */

const PLAN_HEADER = /(^|\n)\s*(план(\s+(на|дня))?(\s+(сегодня|завтра|день))?|мой\s+план|вот\s+(мой\s+)?план|to\s?do|todo|задачи\s+на\s+(сегодня|день))\s*[:\-—]?\s*/iu;
const PLAN_QUESTION = /(какой|что|где|покажи|скажи|когда|сколько)\b.*план|план.*\?/iu;

// Completion verbs the bot understands in free text (many morphological forms,
// RU + EN). Kept broad on purpose: an employee should be able to write "собрание
// завершено", "отчёт закрыт", "задачу сдал", "созвон провели" and have the bot
// mark the matching plan item done without a slash command.
const DONE_VERBS = /(выполн(ил|ила|или|ено|ена|ены)?|сделал(а|и)?|сделан(о|а|ы)?|законч(ил|ила|или|ено|ена)?|заверш(ил|ила|или|ено|ена|ены|ить)?|закрыл(а|и)?|закрыт(а|о|ы)?|сдал(а|и)?|сдан(о|а|ы)?|доделал(а|и)?|доделан(о|а)?|дописал(а|и)?|провёл|провел|провела|провели|готов(о|а|ы)?|отправил(а|и)?|done|completed|complete|finished|finish|closed|ready)/iu;
const REMAINING_HINT = /(оставш|остальн|все\s+(задачи|пункты|остальн)|всё\s+сделал|все\s+сделал)/iu;

const STOP_WORDS = new Set([
  "я", "мы", "уже", "всё", "все", "это", "и", "а", "но", "на", "в", "во", "по",
  "с", "со", "за", "до", "от", "к", "о", "об", "то", "так", "там", "тут", "его",
  "их", "ее", "её", "наш", "наша", "уже", "сегодня", "сейчас", "только", "что",
  "как", "был", "была", "были", "быть", "the", "a", "an", "is", "to", "of",
  ...donewords(),
]);

function donewords() {
  return [
    "выполнил", "выполнила", "выполнили", "выполнено", "выполнена", "выполнены",
    "сделал", "сделала", "сделали", "сделано", "сделана", "сделаны",
    "закончил", "закончила", "закончили", "закончено", "закончена",
    "завершил", "завершила", "завершили", "завершено", "завершена", "завершены",
    "завершить", "закрыл", "закрыла", "закрыли", "закрыта", "закрыто", "закрыты",
    "сдал", "сдала", "сдали", "сдано", "сдана", "сданы",
    "доделал", "доделала", "доделали", "доделано", "доделана",
    "дописал", "дописала", "дописали",
    "провёл", "провел", "провела", "провели", "готово", "готова", "готовы",
    "отправил", "отправила", "задачу", "задача", "задание", "пункт",
    "done", "completed", "complete", "finished", "finish", "closed", "ready",
  ];
}

export function parseNaturalPlanIntent(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.startsWith("/")) {
    return null;
  }
  // A question about the plan ("какой у меня план?") is not a creation.
  if (PLAN_QUESTION.test(raw) && !/\n/u.test(raw)) {
    return null;
  }
  const headerMatch = raw.match(PLAN_HEADER);
  if (!headerMatch) {
    return null;
  }
  // Everything after the header keyword is the plan body.
  const afterHeader = raw.slice(headerMatch.index + headerMatch[0].length);
  const items = parsePlanItems(afterHeader);
  if (items.length === 0) {
    return null;
  }
  return { kind: "create_plan", items, text: raw };
}

export function parseNaturalDoneIntent(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.startsWith("/")) {
    return null;
  }
  if (!DONE_VERBS.test(raw)) {
    return null;
  }
  // "всё/остальные сделал" is handled by the remaining-done path.
  if (REMAINING_HINT.test(raw)) {
    return null;
  }
  // The phrase to match against plan items = the message minus nothing; the
  // matcher strips verbs/stopwords itself.
  return { kind: "mark_done", reference: raw, text: raw };
}

/**
 * Whether a done-phrase carries no concrete subject keywords beyond the
 * completion verb itself (e.g. "готово", "сделал", "закрыл всё"). For such
 * generic confirmations the handler may complete the single open plan item.
 * A phrase that names something ("собрание завершено") returns false, so we
 * never guess the wrong item.
 */
export function isGenericDoneReference(text) {
  return keywords(text).size === 0;
}

/**
 * Find the plan item that best matches a free-text phrase by keyword overlap.
 * Returns { index, item, score } (1-based index) or null when no overlap.
 */
export function matchPlanItemByPhrase(plan, phrase) {
  const items = plan?.items || [];
  if (items.length === 0) {
    return null;
  }
  const phraseTokens = keywords(phrase);
  if (phraseTokens.size === 0) {
    return null;
  }
  let best = null;
  items.forEach((item, idx) => {
    const titleTokens = keywords(item.title);
    let score = 0;
    for (const token of titleTokens) {
      if (phraseTokens.has(token)) {
        score += 1;
      } else {
        // partial: phrase token is a prefix of a title token or vice versa
        for (const pt of phraseTokens) {
          if (pt.length >= 4 && (token.startsWith(pt) || pt.startsWith(token))) {
            score += 0.5;
            break;
          }
        }
      }
    }
    // Time tokens like "17:00" are strong signals.
    const titleTimes = times(item.title);
    const phraseTimes = times(phrase);
    for (const t of phraseTimes) {
      if (titleTimes.includes(t)) {
        score += 2;
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { index: idx + 1, item, score };
    }
  });
  return best;
}

function keywords(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[^\p{L}\p{N}\s:]/gu, " ");
  const set = new Set();
  for (const word of normalized.split(/\s+/u)) {
    const w = word.trim();
    if (w.length >= 3 && !STOP_WORDS.has(w) && !/^\d{1,2}:\d{2}$/u.test(w)) {
      set.add(w);
    }
  }
  return set;
}

function times(text) {
  const out = [];
  const re = /(\d{1,2}):(\d{2})/gu;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    out.push(`${m[1]}:${m[2]}`);
  }
  return out;
}

function parsePlanItems(text) {
  return String(text)
    .split(/\r?\n|;|•/u)
    .map((item) => item.replace(/^\s*[-*\d.)]+\s*/u, "").trim())
    .filter(Boolean)
    .slice(0, 20);
}
