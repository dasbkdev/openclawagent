const update = $input.first()?.json?.body || $input.first()?.json || {};
const message = update.message || update.edited_message || null;

if (!message?.chat?.id) {
  return [{ json: { ok: true, skip: true, reason: "No Telegram message in update" } }];
}

const text = String(message.text || message.caption || "").trim();
const command = parseCommand(text);

return [{
  json: {
    ok: true,
    updateId: update.update_id || null,
    message,
    chatId: message.chat.id,
    telegramUserId: String(message.from?.id || ""),
    username: message.from?.username || null,
    firstName: message.from?.first_name || null,
    text,
    command,
    isVoice: Boolean(message.voice),
    voice: message.voice || null,
    receivedAt: new Date().toISOString(),
  },
}];

function parseCommand(value) {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/")) {
    return { name: "", argsText: raw, args: [] };
  }
  const [commandRaw, ...args] = raw.split(/\s+/u);
  return {
    name: commandRaw.split("@")[0].toLowerCase(),
    args,
    argsText: raw.slice(commandRaw.length).trim(),
  };
}
