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

const REPLACE_PLAN = /(нов(ый|ого)\s+план|план\s+заново|заново|перепиш|замени(ть)?\s+план|очисти(ть)?\s+план|с\s+нуля|сначала\s+план)/iu;

// Whether a plan message asks to REPLACE the whole plan rather than add to it.
// Default is to merge, so a stray message never wipes the day's plan.
export function isReplacePlanIntent(text) {
  return REPLACE_PLAN.test(String(text || ""));
}

const ADD_VERB = /(добав(?:ь|ьте|ить)|допиши(?:те)?|дополни(?:те)?|впиши(?:те)?|внеси(?:те)?)/iu;
const DELETE_VERB = /^\s*(удали(?:ть|те)?|убери(?:те)?|сотри(?:те)?|вычеркни(?:те)?|выкини(?:те)?|очисти(?:ть|те)?|снеси)[\s,:—-]+(.+)$/isu;

function splitPlanItems(text) {
  return String(text || "")
    .split(/\r?\n|[;•]|,(?!\d)/u)
    .map((item) => item.replace(/^\s*[-*\d.)]+\s*/u, "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

// Assigning a plan item TO ANOTHER employee ("поставь Бегайым задачу …",
// "назначь Айзирек в план: …", "дай Перизат задачу …"). Returns the remainder
// after the verb; the handler resolves the recipient (with the directory) and
// strips plan/task connector words from the body.
const ASSIGN_VERB = /^\s*(?:поставь(?:те)?|назначь(?:те)?|дай(?:те)?|задай(?:те)?)[\s,:—-]+(.+)$/isu;

export function parseAssignPlanIntent(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.startsWith("/")) {
    return null;
  }
  const m = ASSIGN_VERB.exec(raw);
  if (!m) {
    return null;
  }
  // Must look like a plan/task assignment, not e.g. "поставь чайник".
  if (!/задач|план|пункт|дел[оа]/iu.test(raw)) {
    return null;
  }
  return { kind: "assign_plan", remainder: m[1].trim() };
}

/** Strip connector words ("в план дня", "задачу", "пункт") around the body. */
export function stripAssignConnectors(text) {
  return String(text || "")
    .replace(/(?:^|\s)(?:в|на)\s+план[ауеыо]?(?:\s+дня|\s+на\s+сегодня)?/giu, " ")
    .replace(/(?:^|\s)план[ауеыо]?(?:\s+дня|\s+на\s+сегодня)?/giu, " ")
    .replace(/(?:^|\s)задач[уаи]?/giu, " ")
    .replace(/(?:^|\s)пункт[ауыео]?/giu, " ")
    .replace(/^[\s:,—-]+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * "добавь к плану дня: A; B" / "добавь A, B в план" — add items to today's plan
 * (merge). Returns { kind:"add_plan", items } or null. items may be empty when
 * the user referenced earlier items ("добавь эти два пункта к плану дня").
 */
export function parseAddToPlanIntent(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.startsWith("/")) {
    return null;
  }
  if (!ADD_VERB.test(raw) || !/план/iu.test(raw)) {
    return null;
  }
  // Items after the "план [дня] :" keyword …
  let itemsText = "";
  const after = /план[ауеыо]?(?:\s+(?:дня|на\s+сегодня))?\s*[:\-—]?\s*/iu.exec(raw);
  if (after) {
    itemsText = raw.slice(after.index + after[0].length).trim();
  }
  // … or between the verb and "к/в план" ("добавь A и B к плану").
  if (!itemsText) {
    const between = new RegExp(`${ADD_VERB.source}\\s+(.+?)\\s+(?:к|в)\\s+план`, "isu").exec(raw);
    if (between) {
      itemsText = (between[2] || "").trim();
    }
  }
  itemsText = itemsText.replace(/^эти\s+\S+\s+(?:пункт[а-яё]*|задач[а-яё]*|дел[а-яё]*)\s*[:\-—]?\s*/iu, "").trim();
  return { kind: "add_plan", items: splitPlanItems(itemsText) };
}

/**
 * "удали пункт собрание из плана" / "очисти план дня" — remove one item or the
 * whole plan. Returns { kind:"remove_item", reference } | { kind:"clear_plan" }
 * | null. Only triggers when the message mentions план/пункт (so "удали файл"
 * is not hijacked).
 */
export function parseDeletePlanIntent(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.startsWith("/")) {
    return null;
  }
  const m = DELETE_VERB.exec(raw);
  if (!m) {
    return null;
  }
  const rest = m[2].trim();
  if (!/план|пункт/iu.test(rest)) {
    return null;
  }
  if (/^(?:весь\s+|целиком\s+|мой\s+|этот\s+)?план(?:\s+дня|\s+на\s+сегодня)?\s*$/iu.test(rest)) {
    return { kind: "clear_plan" };
  }
  const reference = rest
    .replace(/из\s+план[ауеыо]?(?:\s+дня|\s+на\s+сегодня)?/iu, " ")
    .replace(/в\s+план[еу]?(?:\s+дня)?/iu, " ")
    .replace(/план[ауеыо]?(?:\s+дня|\s+на\s+сегодня)?/iu, " ")
    .replace(/пункт[ауеыо]?/iu, " ")
    .replace(/задач[ауеиыу]?/iu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (reference) {
    return { kind: "remove_item", reference };
  }
  return { kind: "clear_plan" };
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
