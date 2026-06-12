export function renderDownloadPage({ baseUrl = "https://starlabagent.pp.ua" } = {}) {
  const safeBaseUrl = escapeHtml(String(baseUrl || "https://starlabagent.pp.ua").replace(/\/+$/u, ""));
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Starlab OpenClaw Agent</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f7fb;
      --panel: #ffffff;
      --text: #162033;
      --muted: #667085;
      --line: #d8e0ec;
      --accent: #1267d8;
      --accent-dark: #0f52ad;
      --ok: #0e7c66;
      --warn: #b66a00;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Segoe UI, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      background: #101a2b;
      color: #fff;
      border-bottom: 1px solid #233752;
    }
    .wrap {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
    }
    .top {
      min-height: 72px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .brand { font-size: 20px; font-weight: 800; }
    .tag { color: #aab7ca; font-size: 14px; }
    main { padding: 34px 0 48px; }
    h1 {
      font-size: 34px;
      line-height: 1.15;
      margin: 0 0 10px;
      letter-spacing: 0;
    }
    p {
      line-height: 1.55;
      color: var(--muted);
      margin: 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      margin-top: 26px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      min-height: 260px;
    }
    .os {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .os h2 {
      font-size: 20px;
      margin: 0;
      letter-spacing: 0;
    }
    .badge {
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 12px;
      white-space: nowrap;
      border: 1px solid #b7e4d8;
      color: var(--ok);
      background: #ecfdf7;
    }
    .badge.warn {
      border-color: #ffd79a;
      color: var(--warn);
      background: #fff7e8;
    }
    .button {
      display: inline-flex;
      justify-content: center;
      align-items: center;
      min-height: 42px;
      padding: 10px 14px;
      border-radius: 6px;
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      font-weight: 750;
    }
    .button:hover { background: var(--accent-dark); }
    code, pre {
      font-family: Consolas, Menlo, monospace;
      font-size: 13px;
    }
    pre {
      margin: 0;
      background: #101828;
      color: #eef4ff;
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .steps {
      margin-top: 26px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }
    .links {
      margin-top: 18px;
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 14px;
    }
    .links a { color: var(--accent); }
    .steps h2 {
      margin: 0 0 12px;
      font-size: 22px;
    }
    ol {
      margin: 0;
      padding-left: 22px;
      color: var(--text);
      line-height: 1.7;
    }
    @media (max-width: 860px) {
      .grid { grid-template-columns: 1fr; }
      h1 { font-size: 28px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap top">
      <div>
        <div class="brand">Starlab OpenClaw Agent</div>
        <div class="tag">Локальное desktop-приложение сотрудника</div>
      </div>
      <div class="tag">${safeBaseUrl}</div>
    </div>
  </header>
  <main class="wrap">
    <h1>Скачать локального агента</h1>
    <p>Это desktop-приложение, собранное из OpenClaw. При первом запуске оно попросит registration code, который выдаёт Николай, привяжет устройство к сотруднику и подключит его к общему серверному ассистенту.</p>

    <section class="grid" aria-label="Downloads">
      <article class="card">
        <div class="os">
          <h2>Windows</h2>
          <span class="badge">Installer .exe</span>
        </div>
        <p>Установщик Windows создаёт приложение и ярлык. После запуска появится форма активации и чат с агентом.</p>
        <a class="button" href="/downloads/starlab-openclaw-agent-windows.exe">Скачать Windows</a>
        <pre>Файл: starlab-openclaw-agent-windows.exe
Запуск: двойной клик, затем введите код</pre>
      </article>

      <article class="card">
        <div class="os">
          <h2>macOS</h2>
          <span class="badge">Desktop .dmg</span>
        </div>
        <p>macOS-приложение собирается из существующего Swift target OpenClaw. После сборки сюда кладётся .dmg.</p>
        <a class="button" href="/downloads/starlab-openclaw-agent-macos-universal.dmg">Скачать macOS Universal</a>
        <pre>Файл после сборки:
starlab-openclaw-agent-macos-universal.dmg</pre>
      </article>

      <article class="card">
        <div class="os">
          <h2>Linux Debian</h2>
          <span class="badge warn">Debian .deb</span>
        </div>
        <p>Linux-версия собирается как .deb пакет из OpenClaw Windows/Linux target на Electron.</p>
        <a class="button" href="/downloads/starlab-openclaw-agent-linux-amd64.deb">Скачать Linux .deb</a>
        <pre>sudo apt install ./starlab-openclaw-agent-linux-amd64.deb</pre>
      </article>
    </section>

    <section class="steps">
      <h2>Как проходит привязка</h2>
      <ol>
        <li>Николай создаёт registration code для сотрудника.</li>
        <li>Сотрудник скачивает и запускает локальный OpenClaw Agent.</li>
        <li>Приложение спрашивает registration code.</li>
        <li>Сервер возвращает пользователя, роль, устройство и персональный device token.</li>
        <li>После этого агент показывает чат, отправляет heartbeat и работает в общей иерархии вместе с Telegram-ботом.</li>
      </ol>
      <div class="links">
        <a href="/privacy">Политика конфиденциальности</a>
        <a href="/terms">Условия использования</a>
      </div>
    </section>
  </main>
</body>
</html>`;
}

export function renderPrivacyPage({ baseUrl = "https://starlabagent.pp.ua" } = {}) {
  return renderInfoPage({
    baseUrl,
    title: "Политика конфиденциальности",
    updatedAt: "11 июня 2026",
    body: `
      <p>Starlab Agent - внутренний корпоративный ассистент Starlab IT. Он помогает сотрудникам и руководителям работать с задачами, календарями, документами, почтой, отчетами и локальными desktop-агентами.</p>

      <h2>Какие Google-данные используются</h2>
      <p>После явного согласия пользователя через Google OAuth приложение может читать данные Google Calendar, Gmail, Google Drive, Google Docs и Google Sheets. Доступ используется только для рабочих сценариев: построение расписания, подготовка сводок, поиск рабочих документов, анализ задач и формирование отчетов для сотрудника и разрешенных руководителей.</p>

      <h2>Какие разрешения запрашиваются</h2>
      <ul>
        <li>Профиль Google: чтобы связать Google-аккаунт с сотрудником.</li>
        <li>Google Calendar read-only: чтобы читать рабочий график и события.</li>
        <li>Gmail read-only: чтобы находить рабочие письма, относящиеся к задачам и встречам.</li>
        <li>Google Drive read-only: чтобы находить рабочие файлы и активность документов.</li>
        <li>Google Docs read-only: чтобы читать рабочие документы при подготовке контекста.</li>
        <li>Google Sheets read-only: чтобы читать рабочие таблицы при подготовке отчетов.</li>
      </ul>

      <h2>Хранение и защита</h2>
      <p>OAuth refresh tokens и другие секреты сохраняются на сервере в зашифрованном виде. Доступ к данным ограничивается ролями внутри Starlab Agent: владелец видит всех, старший PM видит своих подчиненных, PM видит свой рабочий контур.</p>

      <h2>Передача и использование данных</h2>
      <p>Данные Google не продаются, не передаются рекламным системам и не используются для обучения внешних моделей. Данные используются только для выполнения запросов пользователя, рабочих отчетов, автоматизации и внутренней аналитики Starlab IT.</p>

      <p>Использование и передача информации, полученной через Google APIs, соответствует Google API Services User Data Policy, включая требования Limited Use.</p>

      <h2>Отключение доступа</h2>
      <p>Пользователь может отключить Google-доступ командой <code>/google_disconnect</code> в Telegram-боте или через настройки безопасности своего Google-аккаунта на странице сторонних приложений.</p>

      <h2>Контакты</h2>
      <p>По вопросам доступа к данным и удаления подключения обратитесь к администратору Starlab Agent внутри компании.</p>
    `,
  });
}

export function renderTermsPage({ baseUrl = "https://starlabagent.pp.ua" } = {}) {
  return renderInfoPage({
    baseUrl,
    title: "Условия использования",
    updatedAt: "11 июня 2026",
    body: `
      <p>Starlab Agent является внутренним рабочим инструментом Starlab IT. Сервис предназначен для сотрудников компании и используется для помощи в ежедневной работе, отчетности, анализе задач, календарей, документов и активности устройств.</p>

      <h2>Доступ</h2>
      <p>Доступ выдается только зарегистрированным сотрудникам через registration code. Пользователь обязан использовать только свой аккаунт и не передавать код доступа третьим лицам.</p>

      <h2>Рабочие данные</h2>
      <p>Пользователь понимает, что сервис может обрабатывать рабочие данные из подключенных корпоративных сервисов, включая Google Workspace, Platrum, YouGile, Telegram и локальный desktop-агент, в рамках разрешений и роли пользователя.</p>

      <h2>Ограничения</h2>
      <p>Запрещено использовать сервис для несанкционированного доступа, удаления данных без подтверждения, передачи секретов, нарушения политик компании или обхода прав доступа.</p>

      <h2>Изменения</h2>
      <p>Starlab IT может обновлять Starlab Agent, его интеграции и эти условия, чтобы улучшать безопасность, надежность и функциональность продукта.</p>

      <h2>Контакты</h2>
      <p>По вопросам использования сервиса обратитесь к администратору Starlab Agent внутри компании.</p>
    `,
  });
}

function renderInfoPage({ baseUrl, title, updatedAt, body }) {
  const safeBaseUrl = escapeHtml(String(baseUrl || "https://starlabagent.pp.ua").replace(/\/+$/u, ""));
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Starlab Agent</title>
  <style>
    :root { color-scheme: light; --bg: #f4f7fb; --panel: #fff; --text: #162033; --muted: #667085; --line: #d8e0ec; --accent: #1267d8; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: var(--bg); color: var(--text); }
    header { background: #101a2b; color: #fff; border-bottom: 1px solid #233752; }
    .wrap { width: min(920px, calc(100% - 32px)); margin: 0 auto; }
    .top { min-height: 72px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .brand { font-size: 20px; font-weight: 800; }
    .tag { color: #aab7ca; font-size: 14px; }
    main { padding: 34px 0 48px; }
    article { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 24px; }
    h1 { font-size: 34px; line-height: 1.15; margin: 0 0 8px; letter-spacing: 0; }
    h2 { font-size: 20px; margin: 24px 0 8px; letter-spacing: 0; }
    p, li { line-height: 1.6; color: var(--muted); }
    p { margin: 0 0 12px; }
    ul { margin: 0 0 12px; padding-left: 22px; }
    a { color: var(--accent); }
    code { font-family: Consolas, Menlo, monospace; font-size: 13px; color: var(--text); }
    .meta { color: var(--muted); margin-bottom: 22px; }
    .nav { margin-top: 24px; display: flex; gap: 14px; flex-wrap: wrap; }
  </style>
</head>
<body>
  <header>
    <div class="wrap top">
      <div>
        <div class="brand">Starlab Agent</div>
        <div class="tag">Корпоративный AI-ассистент</div>
      </div>
      <div class="tag">${safeBaseUrl}</div>
    </div>
  </header>
  <main class="wrap">
    <article>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">Обновлено: ${escapeHtml(updatedAt)}</div>
      ${body}
      <div class="nav">
        <a href="/download">Главная страница приложения</a>
        <a href="/privacy">Политика конфиденциальности</a>
        <a href="/terms">Условия использования</a>
      </div>
    </article>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
