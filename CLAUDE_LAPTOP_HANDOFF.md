# Handoff для Claude на новом ноутбуке — ЧИТАЙ ПЕРВЫМ

Ты — Claude Code на новой машине пользователя (владелец проекта Starlab Agent,
он же оператор прода). Этот файл — полный контекст, чтобы продолжить работу без
потери истории. Память предыдущей сессии (`~/.claude/.../memory/`) на эту машину
НЕ переехала — всё критичное сведено сюда. После прочтения сверяйся с актуальным
кодом: файл — снимок на 2026-06-18, факты могли измениться.

Параллельно читай в репозитории: `CLAUDE.md` (жёсткие правила проекта),
`CODEX_WORKLOG_FOR_CLAUDE.md` (журнал всех работ, самое свежее — внизу),
`STARLAB_AGENT_FULL_HANDOFF_RU.md`, `CLAUDE_SESSION_HANDOFF.md`.

---

## 0. TL;DR — первые действия на новой машине

1. Поставить Node.js ≥ 22.19, git, Claude Code.
2. `git clone https://github.com/dasbkdev/openclawagent.git` → ветка **`server`** (рабочая, НЕ main).
3. Настроить push-доступ к GitHub (PAT или `gh auth login`).
4. Получить доступ к проду: на этой машине сгенерировать SSH-ключ и попросить
   пользователя/меня добавить его `~/.ssh/<key>.pub` в `authorized_keys` на сервере
   (см. §4). Приватные ключи со старой машины переносить по защищённому каналу,
   либо завести новые.
5. Проверка: `cd control-plane && npm test` (должно быть ~293 passed).

---

## 1. Настройка новой машины (по ОС)

**Node + git + Claude Code:**
- macOS: `brew install node git` ; Claude Code — по инструкции Anthropic; вход через браузер.
- Windows: установщик Node.js LTS (≥22), Git for Windows (даёт Git Bash); Claude Code CLI.
- Linux: `nodejs`/`npm` ≥22 из nodesource, `git`; Claude Code CLI.

**SSH-ключи** (нужны для прода и Mac-сборки) — кладутся в `~/.ssh/`, `chmod 600`:
- `starlab_server` — root-доступ к прод-VPS.
- `maksat_mac` — доступ к Mac для сборки desktop-агента (Mac часто офлайн).
Лучшая практика: НЕ таскать приватный ключ, а сгенерировать новый на этой машине
(`ssh-keygen -t ed25519 -f ~/.ssh/starlab_server`) и добавить `.pub` на сервер.

**GitHub push:** репо `dasbkdev/openclawagent`. Нужен write-доступ (PAT/gh/SSH).

---

## 2. Что это за проект

Внутренняя система AI-ассистентов компании Starlab: Telegram-бот + центральный
control-plane на Linux VPS + локальные desktop-агенты (форк OpenClaw) на машинах
сотрудников. Сотрудники — PM'ы: **pm1 = Бегайым, pm2 = Айзирек, pm3 = Перизат,
senior pm = Максат, владелец = Николай**. Бот делает: ежедневные планы/отчёты,
сводки по активности (Metricon), задачи (Platrum/Bitrix), график (Platrum+Google),
обмен сообщениями между сотрудниками, медиа (картинки/PDF/видео), семантическую
память, голос (STT/TTS), и device-задачи (агент управляет компьютером сотрудника).

---

## 3. Карта репозитория

- `control-plane/` — основной backend (Node ≥22.19, **zero-dependency**, ESM, только `node:*` + опционально `pg`). Два процесса:
  - `src/server.js` — HTTP API на `127.0.0.1:3099`.
  - `src/telegram-bot.js` — long-polling бот (работает **in-process**, не ходит в HTTP API).
  - Слои: `api/` → `domain/` → `connectors/` → `integrations/` → `setup/` → `infra/`.
  - `src/telegram/handler.js` — презентация (parse_mode HTML; **весь динамический текст экранировать** `escapeHtml`, иначе краш `can't parse entities`).
- `control-plane/browser-service/` — отдельный сервис Playwright на `127.0.0.1:3210` («браузер как человек» для агента). Запускается отдельным systemd-юнитом.
- `control-plane/desktop-agent/` — **LEGACY** Electron-агент (v0.2.0), НЕ отгружается. Ловушка: workflow `.github/workflows/build-desktop-agents.yml` собирает именно его. Реальные агенты — ниже (§6).
- `openclaw-starlab-2026.6.5/` — вендорный форк OpenClaw (Windows-агент `apps/windows`, и частично mac).
- `n8n/` — workflow-экспорты (Docker на сервере, порт 5678).
- `control-plane/scripts/` — установка/деплой/бэкап/пробы (синхронизируются на сервер).

Команды: `cd control-plane && npm test` (node --test, ~293 passed — обязательно перед сдачей); `node --check src/<file>`.

---

## 4. Production — доступ, деплой, health-gate

**VPS:** `195.238.122.228` (starlabagent.pp.ua). Доступ: `ssh -i ~/.ssh/starlab_server root@195.238.122.228`. Node на сервере: `/usr/bin/node` (v22). Деплой-юзер: `company-control-plane`.

**Пути на сервере:**
- Git-чекаут (source of truth на сервере): `/opt/starlab-repo` (ветка server, `git reset --hard origin/server` на каждый деплой).
- Рантайм: `/opt/company-control-plane` (синхронизируется из чекаута; `src test scripts package.json`).
- Browser-service рантайм: `/opt/starlab-browser-service`.
- Runtime-данные (производные файлы): `/var/lib/company-control-plane`.
- Секреты (зашифрованы): через `setupService` (`/setup` wizard), путь конфигов `/var/lib/company-control-plane`; env: `/etc/company-control-plane/control-plane.env` (НЕ читать/не коммитить).

**Деплой (стандартный поток):**
```
git push origin server
ssh -i ~/.ssh/starlab_server root@195.238.122.228 \
  'cd /opt/starlab-repo && git fetch -q origin server && git reset --hard origin/server \
   && bash /opt/company-control-plane/scripts/linux/deploy-from-git.sh'
```
`deploy-from-git.sh` сам: синхронит код → `npm test` (гейт) → рестарт `company-control-plane-api` + `company-control-plane-telegram-bot` + `starlab-browser-service` → **health-gate**: проверяет оба сервиса `active` + `/health` ok; при провале **откатывает код на предыдущий коммит** и выходит с ошибкой. Если видишь `Deployed <sha>` и `healthy` — успех.

**Проверка здоровья:** `curl -s http://127.0.0.1:3099/health` → `{"ok": true,...}` (внимание: pretty-printed, с пробелом).

**Жёсткое правило:** прод-изменения (systemd/nginx/state) — только после backup и с подтверждения пользователя.

---

## 5. Postgres, бэкапы, секреты

- Состояние — в выделенном контейнере **`starlab-cp-postgres`** (postgres:16-alpine, `127.0.0.1:5433`, том `starlab-cp-pgdata`). БД/роль/юзер: **`controlplane`**. Отдельно от n8n-postgres.
- Backend выбирается в `src/infra/store-factory.js`: Postgres при `CONTROL_PLANE_STORE=postgres` + connection string (`CONTROL_PLANE_DATABASE_URL`/`DATABASE_URL`); иначе файловый `JsonStore`. `pg` — optionalDependency.
- **Всё состояние — в ОДНОЙ jsonb-строке** `control_plane_state(id, data, updated_at)`. Конкурентность: транзакция + `pg_advisory_xact_lock` + `FOR UPDATE` (`src/infra/pg-store.js`). Не добавлять новых писателей; не делать медленный I/O внутри `store.update` (держит лок). Есть узкий `store.readDeviceCommand(id)` для горячего полла.
- Производные файлы (work-timeline JSONL, memory-archive, obsidian vault) — на диске рядом (`PgStore.filePath`).
- **Бэкапы** (исправлены 2026-06-18): systemd-таймер `company-control-plane-backup.timer` (ежедневно 03:30 UTC) → `scripts/linux/backup-runtime.sh` дампит БД через `docker exec starlab-cp-postgres pg_dump` (gzip, sanity-check) + tar файлов, в `/var/backups/company-control-plane/` (хранит 14). Восстановление: `gzip -dc pg-<ts>.sql.gz | docker exec -i starlab-cp-postgres psql -U controlplane -d <db>`. Юнит запускает скрипт через `/bin/bash` (чтобы потеря +x не ломала).
- **Пробы на сервере** требуют: `set -a && . /etc/company-control-plane/control-plane.env && set +a` + `CONTROL_PLANE_CONFIG_DIR=/var/lib/company-control-plane` (иначе читают пустой dev-стейт). Пример: `scripts/linux/probe-google-docs.mjs`, `probe-bitrix.mjs`, `probe-platrum-schedule.mjs`.

---

## 6. Desktop-агенты (Win/Mac) — сборка и релиз

**ВАЖНО — топология (неочевидно):**
- Реальный **Windows-агент** = Electron `openclaw-starlab-2026.6.5/apps/windows/` (версия в его `package.json`), собирается на Windows (`npm run build:win`).
- Реальный **macOS-агент** = нативное Swift-приложение OpenClaw (`apps/macos/Sources/OpenClaw/` + Starlab-файлы), собирается **только на Mac** (Xcode/Swift → `OpenClaw.app` → hdiutil → `…-macos-universal.dmg`).
- `control-plane/desktop-agent/` (v0.2.0) — **legacy, не отгружается**.

**Текущие версии: Win и Mac оба `2026.6.7`** (выложены на `https://starlabagent.pp.ua/download`). Манифест авто-апдейта: `public/downloads/releases.json` (механизм Windows; **у мака авто-апдейт пока НЕ подключён** — это открытая задача).

**Сборка мака (как делалось 2026-06-17, на Mac Максата по SSH `~/.ssh/maksat_mac`):**
```
git clone --depth 1 --branch v2026.6.5 https://github.com/openclaw/openclaw.git
cd openclaw
tr -d '\r' < OPENCLAW_STARLAB_DEVICE_CONTROL.patch > lf.patch   # BSD patch давится CRLF
patch -p1 --fuzz=3 < lf.patch        # Swift-файлы лягут; package.json-хунк добавь npm-скрипт вручную
corepack enable && pnpm install
echo 'prefer-offline=true' >> ~/.npmrc   # иначе Sparkle-шаг зависает на опц. пакетах (error 23)
SKIP_NOTARIZE=1 ALLOW_ADHOC_SIGNING=1 pnpm starlab:mac:package  # -> dist/...universal.dmg
```
Сборка ~30 мин (universal + Sparkle + Peekaboo). DMG ad-hoc подписан → первый запуск ПКМ→Открыть.
Патч `OPENCLAW_STARLAB_DEVICE_CONTROL.patch` (корень репо) несёт Starlab-overlay. Фичи 2026.6.7 добавлены скриптом `control-plane/scripts/release/mac-2026.6.7-deltas.py`.

**Публикация на прод:** `control-plane/scripts/release/` — `desktop-releases.config.json` (единый источник версий), `make-releases-manifest.mjs` (SHA-256 из реального файла), `publish-desktop-release.sh <dmg>` (заливает + пересобирает `releases.json` + проверяет HTTPS).

**Облачная сборка мака без Mac:** `.github/workflows/starlab-mac-dmg.yml` (macos-latest, клонирует upstream + патч + сборка) — резерв, если Mac недоступен. Минус: платные macOS-минуты на приватном репо.

---

## 7. Интеграции — read-only, модели данных

Все интеграции **read-only**; write только через draft+confirm; delete запрещён всегда. Гард — allowlist'ы (`READ_ONLY_BITRIX_METHODS`, `READ_ONLY_PLATRUM_ENDPOINTS`).

- **Platrum** (основной источник задач): задачи на досках, в т.ч. личных без проекта; для полного списка — `/tasks/team/`. График: шаблон недели + «недельный план» (`work-schedules`). `kickidler` в коде = **Metricon** в продукте.
- **Bitrix** (legacy): задачи на workgroups + личный канбан (`GROUP_ID 0`); `getAllTasks` читает все доски.
- **Google** (`src/integrations/google-oauth.js`): Calendar/Gmail/Drive/Docs/Sheets, OAuth, скоупы readonly. **Docs/Sheets читаются через docs.googleapis/sheets.googleapis** (не files.get). Прим.: 2026-06-18 чинили 403 `SERVICE_DISABLED` — Docs/Sheets API не были включены в Cloud-проекте `350155398807`; включили в консоли (не код).
- **n8n**: Telegram-конвейер дублируется в control-plane и n8n — не расширять дубль без решения о единственном владельце. Защищённые endpoints — через `X-Automation-Token`.

---

## 8. Ассистент/агент, память, лимиты

- Модель ассистента: **Opus 4.8** (`CLAUDE_MODEL`), дистиллятор памяти — Sonnet, OpenClaw — Sonnet. Форсится в `src/setup/claude-model-policy.js`.
- Семантическая память: **Voyage** embeddings (voyage-3.5, dim 1024) кэшируются в отдельной Postgres-таблице `memory_embeddings`; косинус считается в Node. Секрет `voyageApiKey`. Известный баг: дистиллятор пишет факты под спросившего, а не субъекта (см. open items).
- **Лимит токенов:** 2.2 млн на пользователя / скользящие 24ч (`src/domain/token-usage.js`, `enforceUserTokenBudget`, владелец OWNER исключён; env `TOKEN_USER_DAILY_LIMIT`). Гейт в `answerCompanyAssistant` и `runAgentTask`.
- Device-агент: `src/assistant/agent-loop.js` (`runAgentTask`) — Claude планирует и вызывает device-инструменты (`run_script`, `open_app`, `screenshot`, `play_youtube`, …); опасные требуют подтверждения НА устройстве. Браузер-инструмент `browse_web` идёт в browser-service (теперь с SSRF-защитой).
- Дневные планы: `state.dailyWorkPlans` (userId+date, TZ Asia/Bishkek). Натуральный язык: создать/добавить/удалить пункты, отметить done (`src/domain/natural-plan-actions.js`, `daily-assistant.js`).

---

## 9. ЖЁСТКИЕ ПРАВИЛА (нарушать нельзя)

1. **Рабочий код проекта не менять без подтверждения пользователя.** Конфиг Claude Code и документация — можно.
2. **Не читать/не логировать/не коммитить секреты:** `**/secrets.json`, `secrets.key`, `**/.env`, API-ключи, токены, пароли, OAuth JSON.
3. **Не коммитить:** `kickidler/`, `openclaw/`, `metricon/`, runtime-state, инсталляторы `*.exe`/`*.dmg`/`releases.json`.
4. Интеграции read-only; write через draft+confirm; delete запрещён.
5. Production — только после backup и с подтверждения пользователя.
6. Именование: `kickidler`=Metricon; Bitrix=legacy; основной источник задач — Platrum.
7. Секреты — только через `/setup` (encrypted store), не через `.env` руками.
8. Перед сдачей: `npm test` + `git diff`. Коммитить на ветку `server`. Сообщения коммитов заканчивать `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## 10. Что сделано в последней сессии (2026-06-17/18)

- **macOS-агент догнал Windows → 2026.6.7**: собран на живом Mac (device-control + play_youtube + minimize_window/all), опубликован.
- **Hardening-батч (всё задеплоено, 293 теста):**
  - Лимит токенов 2.2 млн/24ч на пользователя.
  - SSRF-защита `browse_web` (блок приватных/loopback/метаданных + DNS-rebinding) в `browser-service/src/validate.js` + `browser.js`.
  - Бэкапы Postgres исправлены (падали с 15 июня и не дампили БД) + проверка восстановления.
  - Health-gate деплоя + автооткат.
  - Узкое чтение состояния в agent-loop (вместо полного jsonb каждую секунду).
  - Опциональный `X-Internal-Token` для админ-API (`CONTROL_PLANE_INTERNAL_TOKEN`, по умолчанию выкл).
- **Google Docs**: чинили 403 — включили Docs/Sheets API в Cloud-проекте (не код).
- Все три места (GitHub `server` / эта машина / прод `/opt/starlab-repo`) выровнены на один коммит.

Полный отчёт по рискам продукта и план улучшений — в истории сессии и в worklog.

---

## 11. Открытые задачи

- **macOS авто-апдейт + автозапуск (Launch-at-Login)** — нужна правка Swift + пересборка на Mac (Mac Максата часто офлайн; ключ `~/.ssh/maksat_mac`). Главный незакрытый пункт.
- **Память v3**: дистиллятор приписывает факты спросившему, а не субъекту → путаница/утечка между сотрудниками. Сделать атрибуцию субъекту + профиль на сотрудника.
- Убрать legacy `control-plane/desktop-agent` + его CI (ловушка «зелёный CI ≠ реальный агент»).
- Anti-hallucination доставки (реле сообщений): утверждать «доставлено» только по факту ok.
- Единый классификатор намерений вместо регексп-каскада в handler.js (поведенчески рискованно — под флагом).
- Apple Developer ID для мака (убрать Gatekeeper-предупреждение).
- Перекатегоризировать Chrome в Metricon/Kickidler как продуктивный (метрики занижены) — на стороне Metricon, не код.

---

## 12. Грабли и уроки (сэкономят время)

- **CRLF**: репо в основном CRLF (git на Windows). На маке BSD `patch` давится CRLF → `tr -d '\r'` сначала.
- **Exec-bit в git**: Windows теряет +x; для скриптов `git update-index --chmod=+x` ИЛИ запускать через `bash script.sh`.
- **grep -q + pipefail**: `gzip -dc | grep -q` шлёт SIGPIPE в gzip → под `set -o pipefail` пайплайн «падает». Используй `grep -c` (читает весь поток).
- **Health JSON**: `/health` отдаёт pretty-printed `"ok": true` (с пробелом) — grep делай пробел-толерантным.
- **Кириллица в регексах JS**: `\b` и `\w` — ASCII-only, после кириллицы не работают; используй явные классы `[а-яё]`.
- **Пробы на сервере**: без `CONTROL_PLANE_STORE`/env читают пустой dev-JSON, а не Postgres — всегда source'ить env + CONFIG_DIR (§5).
- **Сеть**: домашний Wi-Fi бывает с client-isolation (устройства не видят друг друга) — для доступа к Mac переключались на другую сеть/хотспот.
- **Telegram HTML**: любой невэкранированный `<` в динамическом тексте крашит отправку.

---

## 13. Куда копать глубже (в репо)

- `CLAUDE.md` — жёсткие правила + матрица делегирования субагентам.
- `CODEX_WORKLOG_FOR_CLAUDE.md` — журнал ВСЕХ работ (новое внизу). Каждую выполненную задачу фиксировать туда.
- `STARLAB_AGENT_FULL_HANDOFF_RU.md`, `CLAUDE_SESSION_HANDOFF.md` — расширенный контекст.
- `control-plane/scripts/release/README.md` — релиз desktop-агентов.
- `control-plane/browser-service/README.md` — браузер-сервис.

Если что-то в этом файле расходится с кодом — верь коду и поправь файл. Удачи.
