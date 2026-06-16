function withCaption(body, caption) {
  if (caption && String(caption).trim()) {
    body.caption = String(caption);
    body.parse_mode = "HTML";
  }
  return body;
}

export class TelegramBotApi {
  constructor({ token, timeoutMs = 30000 }) {
    if (!token) {
      throw new Error("TELEGRAM_BOT_TOKEN is required");
    }
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fileBaseUrl = `https://api.telegram.org/file/bot${token}`;
    this.timeoutMs = timeoutMs;
  }

  async getUpdates({ offset, timeout = 25 }) {
    return await this.call("getUpdates", {
      offset,
      timeout,
      allowed_updates: ["message"],
    });
  }

  async sendMessage({ chatId, text }) {
    return await this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }

  async getMe() {
    return await this.call("getMe", {});
  }

  // Forwarding by file_id: the same bot can re-send a received file to any chat
  // without re-uploading. `photo`/`document`/`video` are Telegram file_id strings.
  async sendPhoto({ chatId, photo, caption }) {
    return await this.call("sendPhoto", withCaption({ chat_id: chatId, photo }, caption));
  }

  async sendDocument({ chatId, document, caption }) {
    return await this.call("sendDocument", withCaption({ chat_id: chatId, document }, caption));
  }

  async sendVideo({ chatId, video, caption }) {
    return await this.call("sendVideo", withCaption({ chat_id: chatId, video }, caption));
  }

  async getFile({ fileId }) {
    return await this.call("getFile", {
      file_id: fileId,
    });
  }

  async downloadFile({ filePath }) {
    const response = await fetch(`${this.fileBaseUrl}/${filePath}`);
    if (!response.ok) {
      throw new Error(`Telegram file download failed: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async sendVoice({ chatId, audioBytes, filename = "voice.ogg", mimeType = "audio/ogg", caption }) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("voice", new Blob([audioBytes], { type: mimeType }), filename);
    if (caption) {
      form.append("caption", caption);
      form.append("parse_mode", "HTML");
    }
    return await this.callMultipart("sendVoice", form);
  }

  async setMyCommands({ commands, scope, languageCode } = {}) {
    const body = { commands };
    if (scope) {
      body.scope = scope;
    }
    if (languageCode) {
      body.language_code = languageCode;
    }
    return await this.call("setMyCommands", body);
  }

  async getMyCommands({ scope, languageCode } = {}) {
    const body = {};
    if (scope) {
      body.scope = scope;
    }
    if (languageCode) {
      body.language_code = languageCode;
    }
    return await this.call("getMyCommands", body);
  }

  async call(method, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs + 5000);
    try {
      const response = await fetch(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(`Telegram API ${method} failed: ${payload.description || response.status}`);
      }
      return payload.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async callMultipart(method, form) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs + 5000);
    try {
      const response = await fetch(`${this.baseUrl}/${method}`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(`Telegram API ${method} failed: ${payload.description || response.status}`);
      }
      return payload.result;
    } finally {
      clearTimeout(timer);
    }
  }
}
