export function renderSetupPage() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Company Control Plane Setup</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --panel: #ffffff;
      --text: #18202a;
      --muted: #657080;
      --line: #d7dde5;
      --accent: #0e7c66;
      --accent-dark: #075f4e;
      --danger: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: "Segoe UI", Arial, sans-serif;
    }
    main {
      width: min(980px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0 44px;
    }
    header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0;
      font-size: 30px;
      line-height: 1.18;
      font-weight: 700;
      letter-spacing: 0;
    }
    .subtitle {
      margin: 8px 0 0;
      color: var(--muted);
      line-height: 1.45;
      max-width: 720px;
    }
    .status {
      min-width: 188px;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 14px;
      color: var(--muted);
    }
    .status strong {
      display: block;
      color: var(--text);
      font-size: 16px;
      margin-top: 2px;
    }
    form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }
    section.full { grid-column: 1 / -1; }
    h2 {
      margin: 0 0 14px;
      font-size: 17px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    label {
      display: block;
      margin-top: 12px;
      font-size: 13px;
      font-weight: 600;
      color: #26313d;
    }
    input, textarea {
      width: 100%;
      margin-top: 6px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px 11px;
      font: inherit;
      color: var(--text);
      background: #fff;
    }
    textarea {
      min-height: 120px;
      resize: vertical;
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
      line-height: 1.45;
    }
    input:focus, textarea:focus {
      outline: 2px solid rgba(14, 124, 102, 0.2);
      border-color: var(--accent);
    }
    .hint {
      margin: 7px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .masked {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      min-height: 18px;
    }
    .actions {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      padding-top: 4px;
    }
    button {
      border: 0;
      border-radius: 6px;
      background: var(--accent);
      color: #fff;
      font: inherit;
      font-weight: 700;
      padding: 11px 16px;
      cursor: pointer;
    }
    button:hover { background: var(--accent-dark); }
    button:disabled { opacity: .55; cursor: wait; }
    .message {
      color: var(--muted);
      font-size: 14px;
      min-height: 20px;
    }
    .message.error { color: var(--danger); }
    @media (max-width: 760px) {
      main { width: min(100% - 22px, 980px); padding-top: 20px; }
      header { align-items: stretch; flex-direction: column; }
      form { grid-template-columns: 1fr; }
      h1 { font-size: 24px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Company Control Plane Setup</h1>
        <p class="subtitle">Первичная настройка сервиса Starlab Agent: Telegram, Google OAuth, Claude, Bitrix, Metricon и голосовые ответы. Секреты сохраняются зашифрованными и показываются только в маске.</p>
      </div>
      <div class="status" id="setupStatus">Статус<strong>Загрузка</strong></div>
    </header>

    <form id="setupForm">
      <section>
        <h2>Telegram</h2>
        <label for="bootstrapOwnerTelegramId">Telegram ID Николая</label>
        <input id="bootstrapOwnerTelegramId" name="bootstrapOwnerTelegramId" autocomplete="off" placeholder="123456789">
        <p class="hint">Этот ID используется для первичной учетной записи владельца.</p>

        <label for="telegramBotToken">Bot Token</label>
        <input id="telegramBotToken" name="telegramBotToken" autocomplete="off" placeholder="123456:ABC...">
        <div class="masked" data-secret="telegramBotToken"></div>
      </section>

      <section>
        <h2>Claude</h2>
        <label for="claudeApiKey">Claude API Key</label>
        <input id="claudeApiKey" name="claudeApiKey" type="password" autocomplete="off" placeholder="sk-ant-...">
        <div class="masked" data-secret="claudeApiKey"></div>
        <p class="hint" id="claudeModelPolicy">Default model: latest Sonnet</p>
      </section>

      <section class="full">
        <h2>Voice Assistant</h2>
        <label for="voiceAssistantEnabled">Voice enabled</label>
        <input id="voiceAssistantEnabled" name="voiceAssistantEnabled" autocomplete="off" placeholder="true">
        <p class="hint">true включает обработку Telegram voice. false полностью отключает голосовой режим.</p>

        <label for="voiceReplyMode">Reply mode</label>
        <input id="voiceReplyMode" name="voiceReplyMode" autocomplete="off" placeholder="on_request">
        <p class="hint">on_request - голосом только когда пользователь просит. always_text - всегда текстом. always_voice - всегда голосом, если ElevenLabs настроен.</p>

        <label for="sttProvider">STT Provider</label>
        <input id="sttProvider" name="sttProvider" autocomplete="off" placeholder="elevenlabs">
        <p class="hint">elevenlabs или openai. Для ElevenLabs можно использовать тот же API key, что и для озвучки.</p>

        <label for="sttApiKey">STT API Key</label>
        <input id="sttApiKey" name="sttApiKey" type="password" autocomplete="off" placeholder="optional">
        <div class="masked" data-secret="sttApiKey"></div>
        <p class="hint">Если оставить пустым и выбран elevenlabs, будет использован ElevenLabs API Key. Для openai укажи OpenAI API key.</p>

        <label for="sttModel">STT Model</label>
        <input id="sttModel" name="sttModel" autocomplete="off" placeholder="scribe_v2">

        <label for="sttLanguageCode">STT Language Code</label>
        <input id="sttLanguageCode" name="sttLanguageCode" autocomplete="off" placeholder="ru">
        <p class="hint">Можно оставить пустым для автоопределения языка.</p>

        <label for="elevenLabsApiKey">ElevenLabs API Key</label>
        <input id="elevenLabsApiKey" name="elevenLabsApiKey" type="password" autocomplete="off" placeholder="xi-api-key">
        <div class="masked" data-secret="elevenLabsApiKey"></div>

        <label for="elevenLabsVoiceId">ElevenLabs Voice ID</label>
        <input id="elevenLabsVoiceId" name="elevenLabsVoiceId" autocomplete="off" placeholder="voice_id">
        <p class="hint">ID голоса берется в ElevenLabs в разделе Voices. Без Voice ID бот сможет понимать голосовые, но не сможет отвечать голосом.</p>

        <label for="elevenLabsTtsModel">ElevenLabs TTS Model</label>
        <input id="elevenLabsTtsModel" name="elevenLabsTtsModel" autocomplete="off" placeholder="eleven_multilingual_v2">

        <label for="elevenLabsOutputFormat">ElevenLabs Output Format</label>
        <input id="elevenLabsOutputFormat" name="elevenLabsOutputFormat" autocomplete="off" placeholder="mp3_44100_128">
      </section>

      <section>
        <h2>Metricon</h2>
        <label for="kickidlerBaseUrl">API Base URL</label>
        <input id="kickidlerBaseUrl" name="kickidlerBaseUrl" autocomplete="off" placeholder="http://metriconapp.com">

        <label for="kickidlerAccessToken">Access Token</label>
        <input id="kickidlerAccessToken" name="kickidlerAccessToken" type="password" autocomplete="off">
        <div class="masked" data-secret="kickidlerAccessToken"></div>

        <label for="kickidlerRefreshToken">Refresh Token</label>
        <input id="kickidlerRefreshToken" name="kickidlerRefreshToken" type="password" autocomplete="off">
        <div class="masked" data-secret="kickidlerRefreshToken"></div>
        <p class="hint">Recommended for Metricon: access tokens are short-lived and are refreshed automatically.</p>

        <label for="kickidlerUsername">Service login/email</label>
        <input id="kickidlerUsername" name="kickidlerUsername" type="password" autocomplete="off" placeholder="service user email">
        <div class="masked" data-secret="kickidlerUsername"></div>

        <label for="kickidlerPassword">Service password</label>
        <input id="kickidlerPassword" name="kickidlerPassword" type="password" autocomplete="off" placeholder="service user password">
        <div class="masked" data-secret="kickidlerPassword"></div>
        <p class="hint">Used only as a fallback when Metricon refresh token is expired or rejected. All agent operations stay read-only.</p>
      </section>

      <section>
        <h2>Platrum</h2>
        <label for="platrumBaseUrl">API Base URL</label>
        <input id="platrumBaseUrl" name="platrumBaseUrl" autocomplete="off" placeholder="https://platrum.starlabit.com">
        <p class="hint">Primary read-only source for employees, projects, kanban tasks, daily reports, attendance and team metrics.</p>

        <label for="platrumUsername">Username</label>
        <input id="platrumUsername" name="platrumUsername" type="password" autocomplete="off" placeholder="service user login">
        <div class="masked" data-secret="platrumUsername"></div>

        <label for="platrumPassword">Password</label>
        <input id="platrumPassword" name="platrumPassword" type="password" autocomplete="off" placeholder="service user password">
        <div class="masked" data-secret="platrumPassword"></div>
        <p class="hint">The agent uses this account only through the server-side read-only guard. Task changes, deletes and writes are blocked before network requests.</p>
      </section>

      <section>
        <h2>YouGile (reserved)</h2>
        <label for="yougileEnabled">Enabled</label>
        <input id="yougileEnabled" name="yougileEnabled" autocomplete="off" placeholder="false">
        <p class="hint">Keep false until users, projects, boards and columns are mapped. Create/update operations will also require explicit confirmation; delete is permanently blocked.</p>

        <label for="yougileBaseUrl">API Base URL</label>
        <input id="yougileBaseUrl" name="yougileBaseUrl" autocomplete="off" placeholder="https://yougile.com/api-v2">

        <label for="yougileApiKey">API Key</label>
        <input id="yougileApiKey" name="yougileApiKey" type="password" autocomplete="off" placeholder="leave empty for now">
        <div class="masked" data-secret="yougileApiKey"></div>
      </section>

      <section>
        <h2>Bitrix Legacy</h2>
        <label for="bitrixWebhookUrl">Incoming Webhook URL</label>
        <input id="bitrixWebhookUrl" name="bitrixWebhookUrl" type="password" autocomplete="off" placeholder="https://example.bitrix24.ru/rest/...">
        <div class="masked" data-secret="bitrixWebhookUrl"></div>
        <p class="hint">Legacy fallback only. New task/project reports should use Platrum.</p>
      </section>

      <section class="full">
        <h2>Token Analytics</h2>
        <label for="tokenReportRecipientTelegramId">Report recipient Telegram ID</label>
        <input id="tokenReportRecipientTelegramId" name="tokenReportRecipientTelegramId" autocomplete="off" placeholder="984834133">
        <p class="hint">Automatic usage reports are sent only to this Telegram account.</p>

        <label for="tokenUsageIngestToken">Ingest API token</label>
        <input id="tokenUsageIngestToken" name="tokenUsageIngestToken" type="password" autocomplete="off" placeholder="optional shared token">
        <p class="hint">If set, agents must send this value in X-Usage-Ingest-Token.</p>
        <div class="masked" data-secret="tokenUsageIngestToken"></div>
      </section>

      <section class="full">
        <h2>Google OAuth JSON</h2>
        <label for="googleOAuthFile">OAuth client JSON</label>
        <input id="googleOAuthFile" name="googleOAuthFile" type="file" accept="application/json,.json">
        <p class="hint">Файл читается локально браузером и отправляется в локальный API на 127.0.0.1.</p>
        <textarea id="googleOAuthClientJson" name="googleOAuthClientJson" spellcheck="false" placeholder="{ ... }"></textarea>
        <div class="masked" data-secret="googleOAuthClientJson"></div>
      </section>

      <div class="actions">
        <button id="saveButton" type="submit">Сохранить настройки</button>
        <span class="message" id="message"></span>
      </div>
    </form>
  </main>

  <script>
    const form = document.getElementById("setupForm");
    const message = document.getElementById("message");
    const saveButton = document.getElementById("saveButton");
    const setupStatus = document.getElementById("setupStatus");
    const googleFile = document.getElementById("googleOAuthFile");
    const googleJson = document.getElementById("googleOAuthClientJson");

    googleFile.addEventListener("change", async () => {
      const file = googleFile.files && googleFile.files[0];
      if (!file) return;
      googleJson.value = await file.text();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.textContent = "";
      message.classList.remove("error");
      saveButton.disabled = true;

      try {
        const payload = {};
        for (const key of [
          "bootstrapOwnerTelegramId",
          "telegramBotToken",
          "claudeApiKey",
          "kickidlerBaseUrl",
          "kickidlerAccessToken",
          "kickidlerRefreshToken",
          "kickidlerUsername",
          "kickidlerPassword",
          "platrumBaseUrl",
          "platrumUsername",
          "platrumPassword",
          "bitrixWebhookUrl",
          "tokenReportRecipientTelegramId",
          "tokenUsageIngestToken",
          "voiceAssistantEnabled",
          "voiceReplyMode",
          "sttProvider",
          "sttApiKey",
          "sttModel",
          "sttLanguageCode",
          "elevenLabsApiKey",
          "elevenLabsVoiceId",
          "elevenLabsTtsModel",
          "elevenLabsOutputFormat",
          "yougileEnabled",
          "yougileBaseUrl",
          "yougileApiKey",
          "googleOAuthClientJson",
        ]) {
          const value = form.elements[key].value.trim();
          if (value) payload[key] = value;
        }

        const response = await fetch("/api/v1/setup/services", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) {
          throw new Error(result.error && result.error.message ? result.error.message : "Save failed");
        }
        renderStatus(result.data);
        clearSecretInputs();
        message.textContent = "Настройки сохранены. API уже использует новые значения; Telegram task подхватит токен после запуска/перезапуска.";
      } catch (error) {
        message.classList.add("error");
        message.textContent = error.message || String(error);
      } finally {
        saveButton.disabled = false;
      }
    });

    function clearSecretInputs() {
      for (const key of [
        "telegramBotToken",
        "claudeApiKey",
        "kickidlerAccessToken",
        "kickidlerRefreshToken",
        "kickidlerUsername",
        "kickidlerPassword",
        "platrumUsername",
        "platrumPassword",
        "bitrixWebhookUrl",
        "tokenUsageIngestToken",
        "sttApiKey",
        "elevenLabsApiKey",
        "yougileApiKey",
        "googleOAuthClientJson",
      ]) {
        form.elements[key].value = "";
      }
      googleFile.value = "";
    }

    async function loadStatus() {
      try {
        const response = await fetch("/api/v1/setup/status");
        const result = await response.json();
        if (!response.ok || !result.ok) {
          throw new Error("Status failed");
        }
        renderStatus(result.data);
      } catch (error) {
        setupStatus.innerHTML = "Статус<strong>Недоступен</strong>";
      }
    }

    function renderStatus(data) {
      setupStatus.innerHTML = "Статус<strong>" + (data.configured ? "Готово" : "Нужна настройка") + "</strong>";
      form.elements.bootstrapOwnerTelegramId.value = data.settings.bootstrapOwnerTelegramId || "";
      form.elements.kickidlerBaseUrl.value = data.settings.kickidlerBaseUrl || "";
      form.elements.platrumBaseUrl.value = data.settings.platrumBaseUrl || "https://platrum.starlabit.com";
      form.elements.yougileEnabled.value = data.settings.yougileEnabled || "false";
      form.elements.yougileBaseUrl.value = data.settings.yougileBaseUrl || "https://yougile.com/api-v2";
      form.elements.tokenReportRecipientTelegramId.value = data.settings.tokenReportRecipientTelegramId || "984834133";
      form.elements.voiceAssistantEnabled.value = data.settings.voiceAssistantEnabled || "true";
      form.elements.voiceReplyMode.value = data.settings.voiceReplyMode || "on_request";
      form.elements.sttProvider.value = data.settings.sttProvider || "elevenlabs";
      form.elements.sttModel.value = data.settings.sttModel || "scribe_v2";
      form.elements.sttLanguageCode.value = data.settings.sttLanguageCode || "";
      form.elements.elevenLabsVoiceId.value = data.settings.elevenLabsVoiceId || "";
      form.elements.elevenLabsTtsModel.value = data.settings.elevenLabsTtsModel || "eleven_multilingual_v2";
      form.elements.elevenLabsOutputFormat.value = data.settings.elevenLabsOutputFormat || "mp3_44100_128";
      const modelPolicy = data.modelPolicy || {};
      document.getElementById("claudeModelPolicy").textContent =
        "Default model for all users: " + (modelPolicy.openClawModel || "latest Sonnet");
      for (const node of document.querySelectorAll("[data-secret]")) {
        const name = node.getAttribute("data-secret");
        const secret = data.secrets[name];
        node.textContent = secret && secret.configured ? "Сохранено: " + secret.masked : "Не сохранено";
      }
    }

    loadStatus();
  </script>
</body>
</html>`;
}
