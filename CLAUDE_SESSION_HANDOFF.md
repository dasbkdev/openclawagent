# Claude Session Handoff — Starlab Agent

Личная памятка Claude для продолжения работы в новой сессии. Обновлено: 2026-06-12.
Рабочая ветка: `server`. Репо: `dasbkdev/openclawagent` (origin).
Полный контекст продукта: `STARLAB_AGENT_FULL_HANDOFF_RU.md`. Журнал работ:
`CODEX_WORKLOG_FOR_CLAUDE.md` (пишу туда каждую задачу). Правила: `CLAUDE.md`.

## 0. Как пользователь со мной работает (важно)

- Полный карт-бланш: «не спрашивай подтверждений, я доверяю». Действую
  автономно до результата — деплою, коммичу, пушу сам.
- Отвечаю и пишу пользователю по-русски.
- Каждую завершённую задачу фиксирую в `CODEX_WORKLOG_FOR_CLAUDE.md` и пушу.
- Оркестрация агентов настроена: `.claude/agents/developer.md` (Sonnet),
  `.claude/agents/expert.md` (Opus). Для крупных параллельных задач запускаю
  Opus-субагентов на ИЗОЛИРОВАННЫХ наборах файлов (иначе конфликт правок).

## 1. Доступ к серверу

- Production VPS: `195.238.122.228`, домен `https://starlabagent.pp.ua`,
  hostname `starlabopenclaw-1`, Ubuntu, Node **v22.22.3**.
- **SSH-ключ уже установлен**: `~/.ssh/starlab_server` (ed25519). Пароль
  больше НЕ нужен (и я рекомендовал пользователю его сменить — мог уже).
  - Git Bash: `ssh -i ~/.ssh/starlab_server -o BatchMode=yes root@195.238.122.228 '<cmd>'`
  - PowerShell scp: `scp -i "$env:USERPROFILE\.ssh\starlab_server" -o BatchMode=yes ...`
  - hostkey: `SHA256:yb/AtQRMBCn+sOxGG4iX4oLI3o1AHIlo+xAhsIbygyU`
- PuTTY plink/pscp тоже установлены, но ssh-ключ через OpenSSH проще и не
  светит пароль.

## 2. Среда на этой Windows-машине

- Node.js установлен (winget OpenJS.NodeJS.LTS, v24.x) но **НЕ в PATH** по
  умолчанию. Перед npm/node:
  - Bash: `export PATH="/c/Program Files/nodejs:$PATH"`
  - PowerShell: `$env:Path = "C:\Program Files\nodejs;$env:Path"`
- Рабочая папка: `C:\Users\dasmu\openclawagent`. Документы внутри ссылаются на
  старый путь `C:\Users\dasmu\agent` — это историческое, реальная папка
  `openclawagent`.
- `.codex-temp/` — мои диагностические скрипты (диагностика маппингов,
  Google, Metricon). Можно переиспользовать/удалять.

## 3. Деплой (отработанный процесс)

```bash
# из control-plane/, PATH с node
npm test                       # должно быть 0 fail (база растёт, см. §6)
# копируем на сервер
scp -i ~/.ssh/starlab_server -o BatchMode=yes -r src test root@195.238.122.228:/opt/company-control-plane/
ssh -i ~/.ssh/starlab_server -o BatchMode=yes root@195.238.122.228 \
  "chown -R company-control-plane:company-control-plane /opt/company-control-plane/src /opt/company-control-plane/test && \
   cd /opt/company-control-plane && npm test 2>&1 | grep -E '^. (tests|pass|fail)' && \
   systemctl restart company-control-plane-api.service company-control-plane-telegram-bot.service && \
   sleep 4 && systemctl is-active company-control-plane-api.service company-control-plane-telegram-bot.service && \
   curl -s http://127.0.0.1:3099/health"
```

- Есть готовый скрипт `control-plane/scripts/deploy-to-server.ps1` (PuTTY-based).
- После ручной правки runtime-файлов от root — вернуть владельца
  `company-control-plane:company-control-plane`, права 600, иначе сервис
  падает с EACCES.
- Desktop-agent (Electron) на сервер НЕ деплоится — он собирается через CI
  `.github/workflows/build-desktop-agents.yml` (.exe/.dmg).

## 4. Грабли (на чём уже спотыкался)

- **Имена env на сервере**: `AUTOMATION_API_TOKEN` (не `AUTOMATION_TOKEN`),
  `INTERNAL_API_TOKEN`, в `/etc/company-control-plane/control-plane.env`.
- **Маршрут типов действий**: `GET /api/v1/device-actions` (НЕ
  `/device-agents/actions`).
- **Google status route**: `GET /api/v1/google/status`.
- **Внутренний токен**: если `INTERNAL_API_TOKEN` задан, все `/api/v1/*`
  требуют заголовок `X-Internal-Token`, КРОМЕ префиксов: google/oauth,
  device-agents/, automation/, setup/, health/integrations, local-agent/.
- **Nikolay runtime Telegram ID** = `8859688650` (для actor-заголовка).
  Developer/owner reports Telegram ID = `984834133`.
- **JsonStore lock**: два процесса (api+bot) пишут в один JSON через файловую
  блокировку. Некоторые мутаторы делают сетевые вызовы ВНУТРИ store.update
  (отчёты тянут Platrum/Metricon) — держат лок секунды. Уже подкрутил:
  lock timeout 25s, stale 120s, репортеры в боте раз в 60с. Настоящий фикс
  (вынести сеть из-под лока) — в долге, см. §7.
- **Claude timeout** теперь 120s (`CLAUDE_TIMEOUT_MS`); длинные ответы 3000
  токенов. Был баг «This operation was aborted» из-за 30s.
- **PowerShell heredoc/кавычки через ssh** капризны — проще писать скрипт в
  `.codex-temp/*.mjs`, scp на сервер в /tmp, запускать там с
  `set -a; . /etc/company-control-plane/control-plane.env; set +a; node /tmp/x.mjs`.
- LF→CRLF warnings при git add на Windows — это норма, не ошибка.

## 5. Что сделано за эти сессии (крупно)

1. **Оркестрация**: CLAUDE.md + .claude/agents/{developer,expert}.md +
   .claude/settings.json (allow npm/node/git, deny чтение secrets).
2. **Память v2**: open loops, долговременные факты (экстракция через
   `CLAUDE_MEMORY_MODEL`=haiku), дневные сводки, JSONL-архив per-user,
   контекст V2, межпроцессный lock. Файлы: domain/assistant-{open-loops,
   facts,summaries}.js, assistant/memory-distiller.js, infra/memory-archive.js.
3. **Render-слой Telegram**: telegram/render.js (blocks→HTML, Markdown→HTML,
   split 4096). Claude отвечает строгим JSON {title,sections,next_steps},
   рендерим. Защита от сырого JSON/обрезанного ответа (salvage/repair).
4. **Polling-цикл бота**: изоляция ошибок по-сообщенно, offset двигается
   всегда.
5. **Инфраструктура**: integration-health (+`/status` команда,
   `GET /api/v1/health/integrations`), внутренний API-токен, CI
   (control-plane-tests.yml), backup-timer (03:30 UTC, 14 копий),
   deploy-to-server.ps1.
6. **Баг атрибуции задач**: личные KPI считались по задачам ВСЕХ участников
   проекта. Фикс на 3 уровнях (промпт + platrum-reports + daily-assistant):
   только задачи где сотрудник = assignee. `taskAssignedToUser`,
   `taskBelongsToUser`.
7. **Авто-резолв сотрудников**: `domain/external-mapping.js`
   `autoResolveUserMappings` — при /register ищет сотрудника в Platrum/Bitrix/
   Metricon по имени через сервисные учётки и сохраняет ID. Bitrix
   `resolveBitrixUser` (user.search), Platrum word-level match, Metricon
   listEmployees. Lazy-healing в отчётах.
8. **Desktop agent уровни 2+3**:
   - Executor `src/agent-tools/executor.js` — 27 типов действий
     кроссплатформенно (win PowerShell, mac osascript, linux best-effort).
   - Клиенты (device-agent.js CLI + desktop-agent Electron) claim+execute
     команды, заявляют реальные capabilities, подтверждают sensitive.
   - Планировщик `src/assistant/agent-loop.js` `runAgentTask` — Claude
     tool-use цикл, ставит команды в очередь и ждёт результат.
     `POST /api/v1/agent/task` + Telegram `/task`.
   - `claude-client.js`: `sendMessages()` (tool use), `extractToolUseBlocks`.

## 6. Тесты

- Локально/сервер: **196 passed, 0 failed** (на момент 2026-06-12 вечер).
- Запуск: `cd control-plane && npm test` (нужен PATH с node).
- При добавлении команды бота — обновить тест в `test/telegram.test.js`
  («command menu exposes only useful product commands» хардкодит список).

## 7. Что осталось / технический долг (приоритеты)

**Высокий:**
- PostgreSQL-миграция (на сервере уже есть PG для n8n). Уберёт lock-костыль
  и откроет pgvector для семантической памяти (память «фаза 3»).
- Вынести сетевые вызовы ИЗ store.update в отчётах (daily-assistant-reporter,
  platrum/bitrix reports) — настоящий фикс долгих локов.
- Google reconnect: Nikolay и Maksat — токены от отключённого OAuth-клиента,
  нужен повторный `/google_connect` (проверял — refresh fails). PM-1, PM-2
  живые, PM-3 не подключала.

**Средний:**
- Code signing desktop-агента: Apple Developer (~$99/год) + Azure Trusted
  Signing (~$10/мес) → тихие автообновления без SmartScreen/Gatekeeper.
  Без них updater качает + просит ручное подтверждение (SHA-256).
- Довести CI-сборку обеих платформ + автопубликация в /downloads +
  releases.json. macOS DMG застрял на 2026.6.5 (Mac Максата был недоступен).
- Computer use «уровень 4»: mouse_click + OCR по скриншотам (нативные модули
  nut.js/robotjs или Anthropic computer-use API). Сейчас mouse_click/ocr_screen
  возвращают unsupported.
- n8n: дубль Telegram-воркфлоу `starlabTelegramMvp01` уже выключен;
  control-plane — единственный владелец Telegram. Расписания
  (`starlabDailyAssistant01`) и heartbeat-mirror активны.
- Переименование kickidler→metricon в коде (legacy-имена), распил
  handler.js (1900+ строк) и router.js (1200+) на модули.

**Низкий:**
- Live-проверка русского voice в Telegram, чистка старых документов.

## 8. Маппинги сотрудников (актуальные в production)

| user | роль | имя | Platrum | Bitrix | Metricon | Google |
|---|---|---|---|---|---|---|
| u-nikolay | OWNER | Николай Маслов | 25/maslov | null | 74 | reconnect нужен |
| u-maksat | SENIOR_PM | Maksat | 23/max | 1 | нет в Metricon | reconnect нужен |
| u-pm-1 | PM | Бегайым Ниязбекова | 18/beks | 17 | 32 | ✅ |
| u-pm-2 | PM | Айзирек Аликенова | 9/aisyy | 101 | 29 | ✅ |
| u-pm-3 | PM | Перизат Усенкулова | 19/jesus | 15 | 76 | не подключала |

- Metricon: у Maksat нет записи в API (не маппил, чтобы не выдумывать).
  У Айзирек было 2 записи (29 активная, 75 — пустой дубль, выбрал 29).
- Бизнес-доступы: Platrum — суперюзер (видит всех/все проекты), Bitrix —
  вебхук главного админа (вся компания). Агент должен тянуть данные ЛЮБОГО
  сотрудника через эти учётки, не требуя ручной привязки.

## 9. Архитектура одной строкой

Центральный Linux-сервер: control-plane (Node, zero-dep, 2 systemd-процесса
api+bot, JSON-хранилище `/var/lib/company-control-plane/control-plane.json`) +
n8n в Docker. Telegram-бот = интерфейс/мозг, desktop-агенты (Electron+OpenClaw
форк) = руки. Claude (sonnet-4-6) = AI. Коннекторы read-only: Metricon,
Platrum (основной), Bitrix (legacy), Google OAuth, YouGile (выкл). Все секреты
через `/setup` (encrypted AES-256-GCM), доступ по SSH-туннелю на 127.0.0.1:3099.
