export class TelegramBotApi {
  constructor({ token, timeoutMs = 30000 }) {
    if (!token) {
      throw new Error("TELEGRAM_BOT_TOKEN is required");
    }
    this.baseUrl = `https://api.telegram.org/bot${token}`;
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
}
