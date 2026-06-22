# Ребренд OpenClaw Desktop под Starlab — план и заготовка

Цель: взять **полноценный OpenClaw desktop** (macOS, нативный Swift, со всеми
функциями), ребрендировать под компанию и **привязать его мозг к нашему серверу**
— чтобы все ответы шли из нашей памяти, заточки под компанию и интеграций, но
богатый интерфейс OpenClaw сохранился.

Статус: **серверный keystone готов и на проде** (этот документ — заготовка для
Mac-части, которую делаем, когда Mac asik/Максата будет в сети).

---

## Архитектура (как это работает)

```
[ Ребрендированный OpenClaw desktop (Mac) ]
        │  provider = openai-compatible
        │  baseURL  = https://starlabagent.pp.ua/v1
        │  apiKey   = <device token сотрудника>
        ▼
[ control-plane: POST /v1/chat/completions ]  ← УЖЕ ГОТОВО, на проде
        │  resolve user by device token (findDeviceAgentByToken)
        │  answerCompanyAssistant(...)
        ▼
[ НАШ МОЗГ: память (Postgres) + профили + заточка под компанию +
  Platrum/Metricon/Google/Bitrix + семантическая память ]
```

OpenClaw остаётся «оболочкой и руками», наш сервер — «мозгом и памятью».
OpenClaw умеет работать с любым OpenAI-совместимым провайдером (см.
`openclaw-starlab-2026.6.5/docs/providers/openai.md`, `extensions/openai/base-url.*`),
поэтому достаточно подменить baseURL.

---

## Что УЖЕ сделано (серверная часть, keystone)

- `POST /v1/chat/completions` и `GET /v1/models` на control-plane
  (`src/api/router.js`), OpenAI-совместимый формат ответа.
- Авторизация: `Authorization: Bearer <device token>` →
  `findDeviceAgentByToken` (`src/domain/device-agents.js`) → пользователь →
  `answerCompanyAssistant` (память/заточка/интеграции).
- nginx: добавлен `location ^~ /v1/ → 127.0.0.1:3099` (реальный бэкап:
  `/etc/nginx/starlabagent.pp.ua.realbak-*`).
- Проверено снаружи: `GET https://starlabagent.pp.ua/v1/models` отдаёт нашу
  модель `starlab-assistant`; без токена — `401` в OpenAI-формате.

Device token сотрудник уже получает при активации
(`POST /api/v1/device-agents/activate` по registration-коду от Николая).
Этот же токен = ключ OpenAI-провайдера в десктопе.

---

## Mac-часть — пошагово (выполнить на Mac, исходник: ~/agent/openclaw)

Полный исходник Starlab-mac приложения живёт ТОЛЬКО на Mac (в этом репо его нет;
есть только вспомогательные модули и `OPENCLAW_STARLAB_DEVICE_CONTROL.patch`).
Сборка мака — см. [[desktop-agent-build-topology]] и
`control-plane/scripts/release/README.md`.

### 1. Идентичность (ребренд)
- Имя приложения / `productName`: «Starlab Agent».
- Bundle ID: `com.starlab.openclaw.agent` (уже используется для Starlab-сборки).
- Иконка: заменить `apps/macos/.../Icon.icon` на нашу.
- Тексты онбординга: `OnboardingWizard.swift` (Starlab-патч уже его трогает) —
  «Введите код активации от руководителя».

### 2. Привязать мозг к нашему серверу (главное)
Зашить дефолтную конфигурацию OpenClaw на openai-compatible провайдер,
указывающий на наш `/v1`, и запретить пользователю менять провайдера:
- provider: `openai` (или generic openai-compatible),
- `baseURL`/`OPENAI_BASE_URL` = `https://starlabagent.pp.ua/v1`,
- `apiKey` = device token, полученный при активации (НЕ ключ OpenAI),
- модель: `starlab-assistant`.
Точное место конфигурации — config OpenClaw (`docs/providers/openai.md`,
`docs/concepts/model-providers.md`). Прошить как пресет/lock, чтобы сотрудник
не переключил на сторонний провайдер.

### 3. Связать активацию и ключ
- Экран активации (Starlab уже добавил `StarlabAgentWindow.swift`/`StarlabAgentClient.swift`):
  сотрудник вводит registration-код → `activate` → получаем `deviceToken`.
- Записать `deviceToken` в OpenClaw-config как apiKey openai-провайдера
  (см. шаг 2). После этого весь чат OpenClaw идёт в наш мозг от имени этого
  сотрудника (память/доступы по его userId).

### 4. Сохранить функции OpenClaw + наши «руки»
- Не вырезать родные функции OpenClaw (canvas, skills, каналы, MCP) — они
  остаются; меняем только провайдера модели.
- Device-команды (наши `open_app/screenshot/run_script/...`) уже реализованы в
  `StarlabDeviceCommandExecutor.swift` + polling в `MenuBar.swift` — сохранить.

### 5. Сборка и публикация
- Версию `package.json` поднять (следующая, напр. `2026.6.9`).
- Собрать: `SKIP_NOTARIZE=1 ALLOW_ADHOC_SIGNING=1 pnpm starlab:mac:package`
  → `dist/starlab-openclaw-agent-macos-universal.dmg`.
- Опубликовать: `control-plane/scripts/release/publish-desktop-release.sh <dmg>`
  (обновит `releases.json`, проверит HTTPS).

### 6. Проверка
- Активировать тестовым кодом → задать вопрос в чате OpenClaw →
  ответ должен прийти С НАШЕЙ ПАМЯТЬЮ (например, «что обещала Бегайым»).
- Проверить, что device-команды («открой Chrome») работают.

---

## Открытые вопросы к решению на Mac
- Streaming: сейчас `/v1/chat/completions` отвечает НЕ потоком. Если конкретный
  экран OpenClaw требует SSE — добавить `stream:true` (SSE) на сервере
  (несложно: чанкуем готовый ответ или подключаем стрим Claude).
- Голос/Realtime OpenClaw (talk): если нужен — потребует отдельной серверной
  поддержки; по умолчанию отключить.
- Подпись Apple Developer ID (убрать Gatekeeper) — отдельно, нужен сертификат.

---

## Потом — Windows
После Mac: переписать наш `apps/windows` (или новый клиент) так же —
openai-compatible на `https://starlabagent.pp.ua/v1` с device token. Сервер уже
готов, повтор тривиален.
