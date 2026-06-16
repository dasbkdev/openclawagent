/**
 * Employee-to-employee messaging through the assistant. Pure parsing/matching
 * and pending-broadcast state helpers — the Telegram handler performs the
 * actual delivery (DM to the recipient's private chat).
 *
 *  - "Сообщи Бегайым что будет собрание в 14:00" → relay a DM to one employee.
 *  - "Отправь всем что завтра выходной"          → broadcast (OWNER/SENIOR_PM,
 *                                                   confirmed before sending).
 *
 * Everyone may DM anyone who has linked Telegram; only managers may broadcast.
 */

import { Roles } from "./roles.js";

// Note: JS \b is ASCII-only, so it does not work after Cyrillic letters —
// require an explicit separator after the verb / target instead.
const RELAY_VERB = /^\s*(сообщи(?:те)?|напиши(?:те)?|передай(?:те)?|скажи(?:те)?|отправь(?:те)?|перешли(?:те)?|пиши|уведоми(?:ть|те)?|оповести(?:ть|те)?|напомни(?:ть|те)?)[\s,:—-]+(.+)$/isu;
const BROADCAST_TARGET = /^(всем(?:\s+сотрудникам|\s+коллегам|\s+в\s+команде)?|все(?:\s+сотрудники)?|команде|всей\s+команде|каждому)(?:[\s,:—-]+(?:что\s+|чтобы\s+|о\s+том,?\s+что\s+|про\s+то,?\s+что\s+)?(.*))?$/isu;
const LEADING_CONNECTOR = /^\s*(?:что|чтобы|о\s+том,?\s+что|про\s+то,?\s+что|следующее|такое)[\s,:—-]+/iu;
// Filler words that may sit between the verb and the recipient name, e.g.
// "отправь сообщение агенту Бегайым …" / "напиши сотруднику Айзирек …".
const LEADING_FILLER = /^(?:сообщени[еяю]|сообщенье|смс|уведомлени[еяю]|месседж|весточк[ауи]|агенту|сотруднику|коллеге|товарищу|для|это|этот|эту|эти|вот|файл|документ|картинку|фото|изображение|видео|его|её|ее)(?:[\s,:—-]+|$)/iu;

function stripLeadingFiller(text) {
  let value = String(text || "").trim();
  let previous;
  do {
    previous = value;
    value = value.replace(LEADING_FILLER, "").trim();
  } while (value !== previous && value.length > 0);
  return value;
}

const AFFIRMATIVE = /^\s*(да|ага|давай|давайте|подтверждаю|подтвердить|ок|окей|окай|yes|y|отправляй|отправляйте|отправь|отправить|шли|шлите)\s*[.!]*\s*$/iu;
const NEGATIVE = /^\s*(нет|не\s+надо|отмена|отменить|отмени|стоп|cancel|no|n)\s*[.!]*\s*$/iu;

export function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[\s_]+/gu, "")
    .trim();
}

/**
 * Detect a relay/broadcast intent. Returns:
 *   { kind: "broadcast", body }                  — send to everyone
 *   { kind: "relay", remainder }                 — recipient+body still joined
 *   null                                         — not a messaging command
 * `remainder` is split into recipient + body by splitRecipientAndBody, which
 * needs the directory to know where the (possibly multi-word) name ends.
 */
export function parseRelayIntent(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.startsWith("/")) {
    return null;
  }
  const m = RELAY_VERB.exec(raw);
  if (!m) {
    return null;
  }
  const rest = m[2].trim();
  if (!rest) {
    return null;
  }
  const broadcast = BROADCAST_TARGET.exec(rest);
  if (broadcast) {
    return { kind: "broadcast", body: (broadcast[2] || "").trim() };
  }
  // "отправь"/"перешли" are also used for files and device actions, so they are
  // "weak": the handler only treats them as a relay when a recipient resolves.
  const weak = /^(отправь|перешли)/iu.test(m[1]);
  return { kind: "relay", remainder: stripLeadingFiller(rest), weak };
}

export function messagingAliases(user) {
  const tg = user?.telegram || {};
  const fullName = [tg.firstName, tg.lastName].filter(Boolean).join(" ");
  return [
    user?.displayName,
    user?.employeeId,
    user?.id,
    user?.id?.replace(/^u-/u, ""),
    tg.username,
    tg.firstName,
    tg.lastName,
    fullName,
    user?.platrumUsername,
  ].filter(Boolean);
}

/**
 * Resolve a name to a single user. Status is one of:
 *   "ok"         — unique match, Telegram linked (user)
 *   "not_linked" — unique match but no Telegram (user)
 *   "ambiguous"  — several matches (users)
 *   "not_found" / "empty"
 */
export function resolveMessageRecipient(state, name) {
  const target = normalizeName(name);
  if (!target) {
    return { status: "empty" };
  }
  const matches = (state.users || []).filter((user) =>
    messagingAliases(user).some((alias) => normalizeName(alias) === target),
  );
  if (matches.length === 0) {
    return { status: "not_found" };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", users: matches };
  }
  const user = matches[0];
  if (!user.telegram?.telegramUserId) {
    return { status: "not_linked", user };
  }
  return { status: "ok", user };
}

/**
 * Split "Бегайым что будет собрание" into a resolved recipient and a body.
 * Tries the leading 1..3 words as the name (shortest first so a first-name
 * like "Бегайым" wins), preferring a linked match.
 */
export function splitRecipientAndBody(state, remainder) {
  const words = String(remainder || "").trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) {
    return { res: { status: "empty" }, body: "" };
  }
  let fallback = null;
  const maxNameWords = Math.min(3, words.length);
  for (let n = 1; n <= maxNameWords; n += 1) {
    const name = words.slice(0, n).join(" ");
    const res = resolveMessageRecipient(state, name);
    const body = words.slice(n).join(" ").replace(LEADING_CONNECTOR, "").trim();
    if (res.status === "ok" || res.status === "not_linked") {
      return { res, body };
    }
    if (res.status === "ambiguous" && !fallback) {
      fallback = { res, body };
    }
  }
  if (fallback) {
    return fallback;
  }
  return { res: { status: "not_found" }, body: "" };
}

export function canBroadcast(actor) {
  return actor?.role === Roles.OWNER || actor?.role === Roles.SENIOR_PM;
}

export function listBroadcastRecipients(state, exceptTelegramUserId = null) {
  const except = exceptTelegramUserId === null ? null : String(exceptTelegramUserId);
  return (state.users || []).filter(
    (user) => user.telegram?.telegramUserId && String(user.telegram.telegramUserId) !== except,
  );
}

export function ensureMessagingState(state) {
  if (!state.pendingBroadcasts || typeof state.pendingBroadcasts !== "object") {
    state.pendingBroadcasts = {};
  }
  return state.pendingBroadcasts;
}

export function setPendingBroadcast(state, telegramUserId, body, now = new Date(), media = null) {
  ensureMessagingState(state)[String(telegramUserId)] = {
    body,
    media: media || null,
    createdAt: now.toISOString(),
  };
}

export function peekPendingBroadcast(state, telegramUserId) {
  return ensureMessagingState(state)[String(telegramUserId)] || null;
}

/**
 * Consume the pending broadcast for a user (always clears it). Returns the
 * pending payload, or null when absent or expired.
 */
export function takePendingBroadcast(state, telegramUserId, now = new Date(), ttlMs = 5 * 60 * 1000) {
  const map = ensureMessagingState(state);
  const key = String(telegramUserId);
  const pending = map[key];
  delete map[key];
  if (!pending) {
    return null;
  }
  if (now.getTime() - new Date(pending.createdAt).getTime() > ttlMs) {
    return null;
  }
  return pending;
}

export function isAffirmative(text) {
  return AFFIRMATIVE.test(String(text || ""));
}

export function isNegative(text) {
  return NEGATIVE.test(String(text || ""));
}
