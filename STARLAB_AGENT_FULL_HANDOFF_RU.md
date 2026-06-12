# Starlab Agent - полный handoff проекта

Дата актуализации: 2026-06-12  
Основной сервер: `195.238.122.228`  
Домен: `https://starlabagent.pp.ua`  
Локальная рабочая папка на ноутбуке: `C:\Users\dasmu\agent`

Этот документ написан для нового разработчика/админа, который вообще не знает проект. Его цель - объяснить:

- зачем существует продукт;
- как устроены репозитории и папки;
- как заходить на сервер;
- какие сервисы запущены;
- где лежат данные, секреты и конфиги;
- как работают Telegram, n8n, control-plane, Google, Metricon, Platrum и локальный OpenClaw agent;
- что уже сделано;
- что нельзя трогать без понимания;
- какие ближайшие технические долги остались.

## 1. Что мы строим

Проект называется условно **Starlab Agent**.

Это внутренняя система AI-ассистентов для компании. Идея: у каждого сотрудника есть ассистент, с которым он общается в Telegram и/или через локальный OpenClaw agent на компьютере. Ассистент помогает с рабочим днём, задачами, отчётами, календарями, документами и контролем активности.

Главная бизнес-цель:

- помочь руководителю видеть реальную картину по сотрудникам;
- помочь старшему PM контролировать младших PM;
- помочь PM вести задачи, отчёты и план дня;
- собирать данные из разных систем в один понятный AI-отчёт;
- не просто отдавать сырые данные, а анализировать эффективность, тренды и проблемы.

Сейчас система строится вокруг централизованного Linux-сервера. Ранее рассматривалась VPN-схема с устройством Николая как центральным узлом, но от неё ушли. Теперь всё должно идти через сервер.

## 2. Роли и иерархия

В проекте есть 3 основных типа пользователей.

### OWNER

Главный руководитель. Сейчас это Николай.

Права:

- видит всех нижестоящих пользователей;
- может создавать регистрационные коды;
- может перевыпускать коды сотрудников;
- может смотреть отчёты всех PM и старшего PM;
- может смотреть устройства локальных агентов;
- должен получать управленческие отчёты.

### SENIOR_PM

Старший проектный менеджер. Сейчас это Максат.

Права:

- не управляет OWNER;
- может отчитываться OWNER;
- может смотреть своих младших PM;
- может собирать данные по подчинённым PM и проектам;
- может получать аналитику по задачам, календарю, активности.

### PM

Младшие проектные менеджеры. Сейчас один активный пример - Бегайым / Project Manager 1.

Права:

- видит свою работу и свои проекты;
- ведёт план дня;
- отмечает выполненное;
- получает утренние/вечерние подсказки;
- может подключать Google;
- может пользоваться Telegram-ассистентом;
- потенциально имеет локального OpenClaw agent на рабочем устройстве.

## 3. Главная архитектура

Упрощённо:

```text
Telegram user
  -> Telegram bot
    -> control-plane Node.js API
      -> Claude API
      -> Google OAuth / Calendar / Drive / Gmail / Docs / Sheets
      -> Metricon API
      -> Platrum API
      -> Bitrix legacy API
      -> Device agent command queue
      -> local JSON state + encrypted setup secrets

n8n
  -> отдельные workflows / automation
  -> может вызывать control-plane API

Local OpenClaw / Starlab device agent
  -> регистрируется регистрационным кодом
  -> получает device token
  -> шлёт heartbeat
  -> забирает команды из очереди
  -> выполняет действия на устройстве
```

Сервер - центральная точка. Telegram bot и API работают как systemd-сервисы. n8n работает в Docker.

## 4. Основные папки локально

Корень проекта:

```text
C:\Users\dasmu\agent
```

Важные элементы:

```text
C:\Users\dasmu\agent\control-plane
```

Основной backend/control-plane. Это главное приложение на Node.js.

```text
C:\Users\dasmu\agent\n8n
```

Локальная папка с n8n-материалами/экспортами/рабочими файлами.

```text
C:\Users\dasmu\agent\openclaw
```

Оригинальный upstream OpenClaw checkout. По умолчанию не коммитить в наш репозиторий, если специально не решили делать submodule/fork.

```text
C:\Users\dasmu\agent\openclaw-starlab-2026.6.5
```

Рабочая/адаптированная версия OpenClaw под Starlab, связанная с локальным agent/download работами.

```text
C:\Users\dasmu\agent\kickidler
```

Проприетарная/внутренняя разработка компании. **Не трогать и не пушить.**

```text
C:\Users\dasmu\agent\CODEX_WORKLOG_FOR_CLAUDE.md
```

Очень важный журнал работ. Каждый раз, когда Codex что-то делает, сюда нужно писать, что сделано и что проверять Claude.

## 5. Git и что нельзя пушить

Репозиторий: `dasbkdev/openclawagent.git`

Текущая рабочая ветка, которая использовалась для серверных работ: `server`.

В `.gitignore` уже добавлено:

```text
kickidler/
metricon/
Metricon/
openclaw/
**/.env
**/secrets.json
**/secrets.key
**/runtime-config.json
control-plane/public/downloads/*.exe
control-plane/public/downloads/*.dmg
control-plane/public/downloads/*.deb
```

Нельзя случайно пушить:

- `kickidler/`;
- реальные `.env`;
- `secrets.json`;
- `secrets.key`;
- большие `.exe/.dmg` установщики;
- любые API keys / tokens / passwords;
- приватные runtime state файлы.

Перед пушем всегда:

```powershell
cd C:\Users\dasmu\agent
git status
git diff --check
```

## 6. Структура control-plane

Папка:

```text
C:\Users\dasmu\agent\control-plane
```

`package.json`:

```json
{
  "name": "company-control-plane",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "bot": "node src/telegram-bot.js",
    "start": "node src/server.js",
    "test": "node --test test/*.test.js"
  },
  "engines": {
    "node": ">=22.19.0"
  }
}
```

Основные директории:

```text
control-plane/src/api
control-plane/src/assistant
control-plane/src/connectors
control-plane/src/domain
control-plane/src/infra
control-plane/src/integrations
control-plane/src/setup
control-plane/src/telegram
control-plane/src/server.js
control-plane/src/telegram-bot.js
control-plane/src/device-agent.js
control-plane/test
control-plane/scripts
control-plane/public
control-plane/desktop-agent
```

## 7. Основные backend-файлы

### `src/server.js`

Запускает HTTP API control-plane.

На сервере слушает:

```text
127.0.0.1:3099
```

Публично не всё открыто напрямую. Для `/setup` лучше использовать SSH tunnel.

### `src/telegram-bot.js`

Запускает Telegram polling loop.

Он:

- читает Telegram updates;
- синхронизирует меню команд;
- отправляет ежедневные token reports;
- отправляет утренние/вечерние daily assistant messages;
- обрабатывает текст, команды и voice;
- вызывает Claude, Google, Metricon, Platrum, device command queue.

### `src/api/router.js`

Главный роутер API:

- `/health`
- `/setup`
- `/download`
- `/privacy`
- `/terms`
- Google OAuth callback/start/status
- setup save/status
- token usage endpoints
- device agent endpoints
- report endpoints
- Metricon/Platrum/Bitrix report endpoints

### `src/setup/setup-service.js`

Хранит runtime setup:

- обычные настройки в `runtime-config.json`;
- секреты в encrypted `secrets.json`;
- ключ шифрования в `secrets.key`.

Важно: секреты нельзя руками писать в `.env`, лучше через `/setup`.

### `src/setup/secret-store.js`

Шифрование/маскирование секретов.

### `src/setup/setup-page.js`

HTML `/setup` wizard.

Через него задаются:

- Telegram bot token;
- Claude API key;
- Google OAuth JSON;
- Metricon base URL/access/refresh/login/password;
- Platrum login/password;
- Bitrix webhook legacy;
- ElevenLabs/STT voice settings;
- token analytics recipient.

### `src/setup/download-page.js`

HTML для:

- `/download`
- `/privacy`
- `/terms`

Google verification использует `/privacy` и `/terms`.

### `src/assistant/company-assistant.js`

Большой “мозг” Telegram free-form assistant. Собирает context по пользователю, Google, Metricon, Platrum, Bitrix, memory, device agents и передаёт Claude.

### `src/assistant/claude-client.js`

Обёртка над Anthropic Claude API.

Важно: по политике проекта используется Sonnet последней закреплённой версии:

```text
claude-sonnet-4-6
```

### `src/domain/policy.js`

RBAC / иерархия доступа:

- OWNER видит всех;
- SENIOR_PM видит подчинённых PM, не видит OWNER;
- PM видит себя/свои проекты.

### `src/domain/invite-codes.js`

Регистрационные коды сотрудников:

- создать;
- redeem;
- reissue/reset.

### `src/domain/device-agents.js`

Локальные агенты устройств:

- активация по invite code;
- heartbeat;
- очередь команд;
- claim/complete command;
- видимость устройств по иерархии.

### `src/domain/natural-device-actions.js`

Парсинг естественных команд типа:

```text
открой Chrome
запусти YouTube
поставь XXXTENTACION Moonlight
```

Если локальный agent поддерживает нужные capabilities, команда ставится в очередь.

### `src/domain/daily-assistant.js`

План дня, прогресс, blockers, daily report.

### `src/domain/work-schedule.js`

Определение расписания:

1. Platrum primary source;
2. Google Calendar fallback;
3. если оба пустые - alert разработчику/админу.

### `src/domain/token-usage.js`

Учёт токенов:

- кто потратил;
- на какие действия;
- сколько input/output tokens;
- ежедневный/недельный/месячный summary.

### `src/connectors/kickidler-client.js`

Несмотря на имя файла, это сейчас Metricon connector.

Исторически назывался Kickidler, но user-facing название - **Metricon**.

Текущий рабочий endpoint:

```text
POST https://metriconapp.com/api/v1/reports/activity
```

Коннектор:

- логинится;
- refresh-ит token;
- умеет fallback login/password, если refresh token умер;
- нормализует `totalActiveTime`, `totalIdleTime`, app/web time, top apps;
- не валит весь отчёт, если один employee ID сломан.

### `src/connectors/platrum-client.js`

Read-only connector к Platrum:

- сотрудники;
- проекты;
- задачи;
- канбан;
- отчёты;
- schedule.

Запись/удаление заблокированы read-only guard.

### `src/connectors/bitrix-client.js`

Legacy fallback для Bitrix.

Сейчас новые отчёты должны идти через Platrum, но Bitrix ещё есть как старый alias/fallback.

### `src/connectors/yougile-client.js`

YouGile зарезервирован. Пока отключён по умолчанию.

Цель на будущее: добавлять задачи в YouGile/Google Calendar с подтверждением пользователя.

### `src/integrations/google-oauth.js`

Google OAuth:

- `/google_connect` в Telegram;
- OAuth redirect;
- хранение user refresh tokens;
- Calendar/Drive/Gmail/Docs/Sheets readonly context.

### `src/integrations/voice-service.js`

Voice:

- STT для Telegram voice;
- TTS через ElevenLabs;
- voice reply only on request, если режим `on_request`.

## 8. Тесты

Папка:

```text
C:\Users\dasmu\agent\control-plane\test
```

Запуск локально:

```powershell
cd C:\Users\dasmu\agent\control-plane
npm test
```

Последнее состояние после Metricon repair:

```text
local: 95/95 passed
server: 66/66 passed
```

Почему разное число тестов: на сервере часть новых файлов/тестов могла быть синхронизирована в другом наборе; перед релизом лучше синхронизировать весь `control-plane/test`.

Ключевые тесты:

- `metricon-client.test.js` - Metricon auth/refresh/login fallback/activity endpoint.
- `google-oauth.test.js` - Google connect/disconnect/tokens.
- `telegram.test.js` - Telegram commands, free-form assistant, voice.
- `daily-assistant.test.js` - план дня/прогресс.
- `work-schedule.test.js` - расписания Platrum/Google.
- `device-agents.test.js` - local agent registration/commands.
- `platrum.test.js` - Platrum read-only reports.
- `setup-service.test.js` - encrypted setup secrets.

## 9. Сервер

Основной сервер:

```text
IP: 195.238.122.228
Domain: starlabagent.pp.ua
OS: Linux / Ubuntu
Project path: /opt/company-control-plane
Runtime state: /var/lib/company-control-plane
System env: /etc/company-control-plane/control-plane.env
n8n path: /opt/starlab-n8n
```

SSH:

```bash
ssh root@195.238.122.228
```

Windows PuTTY/plink пример:

```powershell
& "C:\Program Files\PuTTY\plink.exe" `
  -ssh root@195.238.122.228 `
  -hostkey "SHA256:yb/AtQRMBCn+sOxGG4iX4oLI3o1AHIlo+xAhsIbygyU"
```

Пароль/секреты не нужно хранить в Git или handoff-документах. Выдавать новому сотруднику отдельно через владельца/менеджер паролей.

Проверенный hostkey:

```text
SHA256:yb/AtQRMBCn+sOxGG4iX4oLI3o1AHIlo+xAhsIbygyU
```

## 10. Systemd services

На сервере два главных сервиса:

```text
company-control-plane-api.service
company-control-plane-telegram-bot.service
```

Проверка:

```bash
systemctl status company-control-plane-api.service
systemctl status company-control-plane-telegram-bot.service
```

Коротко:

```bash
systemctl is-active company-control-plane-api.service
systemctl is-active company-control-plane-telegram-bot.service
```

Перезапуск:

```bash
systemctl restart company-control-plane-api.service company-control-plane-telegram-bot.service
```

Логи:

```bash
journalctl -u company-control-plane-api.service -n 100 --no-pager
journalctl -u company-control-plane-telegram-bot.service -n 100 --no-pager
journalctl -u company-control-plane-api.service -u company-control-plane-telegram-bot.service -f
```

Unit API:

```text
WorkingDirectory=/opt/company-control-plane
ExecStart=/usr/bin/node /opt/company-control-plane/src/server.js
User=company-control-plane
Group=company-control-plane
EnvironmentFile=/etc/company-control-plane/control-plane.env
ReadWritePaths=/var/lib/company-control-plane
```

Unit bot:

```text
WorkingDirectory=/opt/company-control-plane
ExecStart=/usr/bin/node /opt/company-control-plane/src/telegram-bot.js
User=company-control-plane
Group=company-control-plane
EnvironmentFile=/etc/company-control-plane/control-plane.env
ReadWritePaths=/var/lib/company-control-plane
```

Важно: если руками редактировать `/var/lib/company-control-plane/*` от `root`, потом вернуть владельца:

```bash
chown company-control-plane:company-control-plane /var/lib/company-control-plane/control-plane.json
chown company-control-plane:company-control-plane /var/lib/company-control-plane/runtime-config.json
chown company-control-plane:company-control-plane /var/lib/company-control-plane/secrets.json
chown company-control-plane:company-control-plane /var/lib/company-control-plane/secrets.key
chmod 600 /var/lib/company-control-plane/control-plane.json
chmod 600 /var/lib/company-control-plane/runtime-config.json
chmod 600 /var/lib/company-control-plane/secrets.json
chmod 600 /var/lib/company-control-plane/secrets.key
```

Иначе сервисы падают с:

```text
EACCES: permission denied, open '/var/lib/company-control-plane/runtime-config.json'
```

## 11. Runtime files на сервере

```text
/var/lib/company-control-plane/control-plane.json
```

Основное состояние:

- users;
- projects;
- invite codes;
- device agents;
- queued device commands;
- memory events;
- daily plans;
- token usage;
- audit log.

```text
/var/lib/company-control-plane/runtime-config.json
```

Обычные настройки из `/setup`, без секретов.

```text
/var/lib/company-control-plane/secrets.json
```

Encrypted secrets.

```text
/var/lib/company-control-plane/secrets.key
```

Ключ для encrypted secrets.

Нельзя коммитить/пересылать эти файлы.

## 12. Setup wizard

Локальный API сервера слушает:

```text
127.0.0.1:3099
```

Безопасный доступ к `/setup` через SSH tunnel:

```powershell
& "C:\Program Files\PuTTY\plink.exe" `
  -ssh root@195.238.122.228 `
  -hostkey "SHA256:yb/AtQRMBCn+sOxGG4iX4oLI3o1AHIlo+xAhsIbygyU" `
  -N `
  -L 13099:127.0.0.1:3099
```

После туннеля открыть локально:

```text
http://127.0.0.1:13099/setup
```

Через `/setup` обновляются:

- Telegram bot token;
- Claude API key;
- Google OAuth JSON;
- Metricon access/refresh/login/password;
- Platrum login/password;
- Bitrix webhook legacy;
- ElevenLabs API key/Voice ID/STT settings;
- token usage report recipient.

Пустые поля не должны перезаписывать старые секреты.

## 13. Public URLs

```text
https://starlabagent.pp.ua/download
https://starlabagent.pp.ua/privacy
https://starlabagent.pp.ua/terms
```

`/download` - страница скачивания локального агента.

`/privacy` и `/terms` добавлены для Google OAuth verification.

Google OAuth callback:

```text
https://starlabagent.pp.ua/api/v1/google/oauth/callback
```

## 14. Download installers

На сервере:

```text
/opt/company-control-plane/public/downloads
```

Текущее содержимое:

```text
releases.json
starlab-openclaw-agent-linux.sh
starlab-openclaw-agent-macos.sh
starlab-openclaw-agent-macos-universal.dmg
starlab-openclaw-agent-macos.zip
starlab-openclaw-agent-windows.exe
```

Важное состояние:

- Windows installer был обновлён до версии `2026.6.7`.
- macOS DMG существует, но macOS часть всё ещё требует осторожной проверки на реальном Mac.
- Linux installer shell script есть.

Публично это доступно через:

```text
https://starlabagent.pp.ua/download
```

## 15. n8n

n8n стоит на том же сервере в Docker.

Папка:

```text
/opt/starlab-n8n
```

Compose:

```text
/opt/starlab-n8n/docker-compose.yml
/opt/starlab-n8n/.env
```

Workflows:

```text
/opt/starlab-n8n/workflows
```

Admin credentials файл на сервере:

```text
/opt/starlab-n8n/admin-credentials.txt
```

Не коммитить этот файл.

Контейнеры:

```text
starlab-n8n_n8n_1
starlab-n8n_postgres_1
```

Проверка:

```bash
cd /opt/starlab-n8n
docker ps
docker compose ps
docker compose logs -f n8n
```

На момент проверки:

```text
n8n: 127.0.0.1:5678->5678/tcp
postgres: healthy
```

n8n нужен для automation/workflow слоя. Пользователь хотел, чтобы workflow был не одним большим JS-файлом, а понятным деревом из n8n nodes. Это направление ещё нужно улучшать.

## 16. Telegram bot

Telegram bot - главный пользовательский интерфейс.

Пользователь пишет в Telegram:

- команды;
- обычные вопросы;
- voice messages.

Bot:

1. определяет Telegram user;
2. проверяет регистрацию/роль;
3. собирает context;
4. при необходимости ставит device command;
5. при необходимости вызывает Claude;
6. возвращает красивый структурированный ответ;
7. при запросе может ответить voice через ElevenLabs.

Основные команды:

```text
/help
/invite
/reset_code
/users
/agents
/device
/projects
/today
/plan
/progress
/blocker
/done
/daily_report
/platrum
/bitrix
/report
/google_connect
/google_status
/tokens
/ai_status
```

Особые команды:

- `/invite` - OWNER создаёт код сотруднику.
- `/reset_code` - OWNER перевыпускает код.
- developer Telegram ID `984834133` имеет recovery-возможность для кода Николая.
- `/google_connect` - пользователь подключает Google.
- `/google_status` - проверить Google.
- `/report` - отчёты активности/трекера.
- `/platrum` - задачи и канбан из Platrum.
- `/bitrix` сейчас фактически legacy alias.
- обычный текст может вызвать AI-ассистента.
- voice message проходит STT.
- если пользователь просит "ответь голосом", используется TTS.

## 17. Claude / Anthropic

Claude используется как AI-мозг.

Текущая политика модели:

```text
claude-sonnet-4-6
```

Файлы:

```text
src/setup/claude-model-policy.js
src/assistant/claude-client.js
```

Ранее была ошибка:

```text
HTTP 403
Type: forbidden
Message: Request not allowed
```

Проверять:

- Anthropic Console;
- API key active;
- billing/credits;
- workspace limits;
- регион/permissions.

Telegram команда:

```text
/ai_status
```

## 18. Google OAuth

Google нужен для:

- Calendar;
- Drive;
- Gmail;
- Docs;
- Sheets.

Текущий redirect URI:

```text
https://starlabagent.pp.ua/api/v1/google/oauth/callback
```

OAuth client JSON загружается через `/setup`.

Если Google OAuth client меняется, всем пользователям нужно заново:

```text
/google_connect
```

Потому что refresh tokens привязаны к конкретному OAuth client.

Google Console значения:

```text
Application home page: https://starlabagent.pp.ua/download
Privacy policy: https://starlabagent.pp.ua/privacy
Terms of service: https://starlabagent.pp.ua/terms
Authorized domain: starlabagent.pp.ua
Authorized JavaScript origin: https://starlabagent.pp.ua
Redirect URI: https://starlabagent.pp.ua/api/v1/google/oauth/callback
```

Нужные APIs:

- Google Calendar API;
- Gmail API;
- Google Drive API;
- Google Docs API;
- Google Sheets API.

Нужные scopes:

- `openid`
- `email`
- `profile`
- calendar readonly;
- gmail readonly;
- drive readonly;
- docs readonly;
- sheets readonly.

Важно по shared calendars:

У PM в Google Calendar есть "Другие календари" с расписаниями сотрудников. Ассистент должен искать не только основной календарь пользователя, но и shared calendars по имени сотрудника: например "Бегайым ПМ", "Даниел UX/UI", "Максат".

Это уже частично дорабатывалось.

## 19. Metricon

Официальное название - Metricon. В коде ещё есть старые имена `kickidler`.

Metricon site:

```text
https://metriconapp.com
```

Swagger/API:

```text
http://85.239.49.208:8080/swagger-ui/index.html
http://85.239.49.208:8080/v3/api-docs
```

Текущий base URL в setup:

```text
https://metriconapp.com
```

Рабочий login проверен через:

```text
POST /api/v1/auth/login
```

Рабочий отчёт активности:

```text
POST /api/v1/reports/activity
```

Тело:

```json
{
  "employeeId": 32,
  "from": "2026-06-10T00:00:00Z",
  "to": "2026-06-11T23:59:59Z",
  "groupBy": "DAY",
  "onlyWorkTime": false
}
```

Поля ответа:

- `employeeId`
- `employeeName`
- `totalActiveTime`
- `totalAppTime`
- `totalWebTime`
- `totalIdleTime`
- `topApplications`

Важный recent fix:

- старый refresh token был заблокирован ошибкой `REFRESH_TOKEN_REUSE_DETECTED`;
- коннектор теперь умеет fallback login/password;
- старый endpoint заменён на `POST /reports/activity`;
- mock Metricon IDs `1..5` заменены/очищены.

Текущие подтверждённые Metricon mappings:

```text
u-nikolay -> 74
u-pm-1 / Бегайым -> 32
u-maksat -> null, потому что API не вернул сотрудника "Максат"
u-pm-2 -> null
u-pm-3 -> null
```

Direct API список employees показал:

```text
32 Бегайым Ниязбекова
74 Николай Маслов
```

Проверка через control-plane API уже вернула данные:

```text
Nikolay / Metricon ID 74: activeSeconds and idleSeconds present
Project Manager 1 / Metricon ID 32: activeSeconds and idleSeconds present
```

Если Metricon снова не показывает данные:

1. Проверить `/setup`, что Metricon login/password/access/refresh configured.
2. Проверить `journalctl`.
3. Проверить, есть ли реальный employee ID в Metricon:

```text
GET /api/v1/employees/available
GET /api/v1/employees/company/23
GET /api/v1/employees/company/23/report-options
```

4. Если сотрудника нет в Metricon API, агент не сможет показать активность.
5. Не ставить fake ID.

## 20. Platrum

Platrum заменяет Bitrix как основной источник задач/проектов/канбана.

Site:

```text
https://platrum.starlabit.com
```

Docs:

```text
https://platrum.starlabit.com/api/docs/
```

Локальный исходник:

```text
C:\Users\dasmu\platrum
```

Connector:

```text
control-plane/src/connectors/platrum-client.js
```

Reports:

```text
control-plane/src/domain/platrum-reports.js
```

Read-only guard:

- агент не должен создавать/редактировать/удалять в Platrum без отдельного будущего дизайна;
- сейчас Platrum используется для чтения сотрудников, проектов, задач, графиков, канбана.

Настройки хранятся в `/setup`:

- `platrumBaseUrl`
- `platrumUsername`
- `platrumPassword`

## 21. Bitrix

Bitrix сейчас legacy.

Раньше была задача читать Bitrix:

- task;
- sonet;
- user_brief.

Потом бизнес-решение изменилось: вместо Bitrix основной источник задач - Platrum.

В коде Bitrix оставлен:

```text
src/connectors/bitrix-client.js
src/domain/bitrix-reports.js
```

Команда `/bitrix` сейчас может быть legacy alias/fallback.

Важно:

- Bitrix webhook может иметь высокие права.
- В коде должен быть read-only guard.
- Нельзя разрешать delete/update/create через AI без подтверждения.

## 22. YouGile

YouGile пока reserved / disabled.

Цель:

- принимать задачи текстом/голосом;
- с подтверждением добавлять в YouGile;
- дополнять Google Calendar.

Текущий принцип:

- `yougileEnabled=false`;
- delete заблокирован;
- write требует явного подтверждения.

## 23. Voice / ElevenLabs

Цель:

- Telegram user может отправить voice;
- bot делает STT;
- дальше обрабатывает как обычный текст;
- если пользователь просит ответить голосом, bot делает TTS и отправляет audio/voice.

Файл:

```text
src/integrations/voice-service.js
```

Настройки через `/setup`:

- `voiceAssistantEnabled`
- `voiceReplyMode`
- `sttProvider`
- `sttApiKey`
- `sttModel`
- `sttLanguageCode`
- `elevenLabsApiKey`
- `elevenLabsVoiceId`
- `elevenLabsTtsModel`
- `elevenLabsOutputFormat`

Текущий voice ID:

```text
dxhwlBCxCrnzRlP4wDeE
```

API key не хранить в документах.

## 24. Token usage analytics

Цель:

- понимать, кто сколько токенов тратит;
- на какие действия;
- какие пользователи самые дорогие;
- ежедневно/недельно/ежемесячно отправлять summary владельцу.

Файлы:

```text
src/domain/token-usage.js
src/telegram/token-usage-reporter.js
```

Получатель отчётов:

```text
984834133
```

Это Telegram ID разработчика/админа.

## 25. Daily assistant

Задача:

- утром прислать план дня как черновик на одобрение;
- вечером собрать отчёт;
- спрашивать мягкие уточнения;
- учитывать расписание сотрудника;
- вести память и договорённости;
- делать weekly digest по трендам.

Расписание:

- рабочая неделя обычно ПН-ПТ;
- у некоторых может быть суббота;
- у всех график может отличаться;
- primary source - Platrum;
- fallback - Google Calendar;
- если и там, и там пусто - сообщить Telegram ID `984834133`.

Timing:

- утренний prompt: через 10 минут после начала рабочего дня;
- вечерний prompt: за 20 минут до окончания рабочего дня.

## 26. Assistant memory

Память нужна, потому что раньше бот забывал контекст:

- "я сказал открой Chrome, он сказал если не откроется напиши, я написал - он уже не помнит";
- PM отмечала половину задач, потом вторую половину, первая забывалась.

Файл:

```text
src/domain/assistant-memory.js
```

Память хранится в `control-plane.json`.

Нужно развивать:

- conversation memory;
- unresolved command context;
- task state memory;
- per-user commitments;
- project facts;
- last device action and result.

## 27. Local OpenClaw / device agent

Идея:

Telegram bot - это "мозг и интерфейс".  
Локальный OpenClaw/Starlab agent на компьютере сотрудника - это "руки".

Пользователь пишет:

```text
открой Chrome на моем Mac
поставь XXXTENTACION Moonlight на YouTube
завтра в 12 сделай ...
```

Bot:

1. понимает пользователя;
2. выбирает его устройство;
3. создаёт command в очереди;
4. local agent забирает command;
5. выполняет действие;
6. отправляет result/heartbeat.

Device endpoints в control-plane:

- activation через invite code;
- heartbeat;
- claim commands;
- complete command.

Файлы:

```text
src/domain/device-agents.js
src/domain/natural-device-actions.js
src/device-agent.js
control-plane/desktop-agent
control-plane/scripts/install-device-agent-windows.ps1
control-plane/scripts/macos/install-device-agent.sh
control-plane/scripts/linux/install-local-openclaw-agent.sh
```

Текущий статус:

- базовая команда open_app/open_url/play_youtube была сделана;
- Windows installer есть на `/download`;
- macOS DMG есть, но macOS часть нужно отдельно стабилизировать;
- настоящая кастомизация upstream OpenClaw под компанию ещё не полностью завершена.

## 28. n8n vs control-plane

Важно понимать, что сейчас в проекте есть два слоя:

### control-plane

Node.js backend, который уже делает основную логику:

- RBAC;
- Telegram;
- Google OAuth;
- Metricon;
- Platrum;
- Bitrix legacy;
- device agents;
- memory;
- token usage;
- setup.

### n8n

Workflow/automation layer.

Пользователь хочет, чтобы n8n workflows были визуальными и понятными, а не одним большим JS node. Это ещё нужно доработать.

Правильная стратегия:

- тяжелую бизнес-логику держать в control-plane;
- n8n использовать как понятный workflow orchestration:
  - Telegram trigger;
  - HTTP Request to control-plane;
  - AI Agent node;
  - Google nodes;
  - conditional branches;
  - report formatting;
  - scheduler/cron.

Не нужно переносить всё в один JS node.

## 29. Как деплоить изменения control-plane

Безопасный простой flow:

1. Локально:

```powershell
cd C:\Users\dasmu\agent\control-plane
npm test
node --check src\server.js
node --check src\telegram-bot.js
```

2. Скопировать изменённые файлы на сервер через `pscp`.

Пример:

```powershell
& "C:\Program Files\PuTTY\pscp.exe" `
  -hostkey "SHA256:yb/AtQRMBCn+sOxGG4iX4oLI3o1AHIlo+xAhsIbygyU" `
  C:\Users\dasmu\agent\control-plane\src\connectors\kickidler-client.js `
  root@195.238.122.228:/opt/company-control-plane/src/connectors/kickidler-client.js
```

3. На сервере:

```bash
cd /opt/company-control-plane
npm test
systemctl restart company-control-plane-api.service company-control-plane-telegram-bot.service
systemctl is-active company-control-plane-api.service
systemctl is-active company-control-plane-telegram-bot.service
```

4. Проверить логи:

```bash
journalctl -u company-control-plane-api.service -u company-control-plane-telegram-bot.service -n 120 --no-pager
```

5. Обновить `CODEX_WORKLOG_FOR_CLAUDE.md`.

## 30. Как проверить живой Metricon через control-plane

Через SSH tunnel:

```powershell
& "C:\Program Files\PuTTY\plink.exe" `
  -ssh root@195.238.122.228 `
  -hostkey "SHA256:yb/AtQRMBCn+sOxGG4iX4oLI3o1AHIlo+xAhsIbygyU" `
  -N `
  -L 13099:127.0.0.1:3099
```

Потом в другом PowerShell:

```powershell
$body = @{
  from = "2026-06-10T00:00:00.000Z"
  to = "2026-06-11T23:59:59.000Z"
} | ConvertTo-Json -Compress

Invoke-RestMethod `
  -Uri "http://127.0.0.1:13099/api/v1/reports/metricon/activity-summary" `
  -Method Post `
  -Headers @{ "X-Actor-Telegram-Id" = "8859688650" } `
  -ContentType "application/json" `
  -Body $body
```

`8859688650` - Telegram ID Николая в runtime state.

## 31. Как проверить health

Через tunnel:

```powershell
Invoke-RestMethod http://127.0.0.1:13099/health
```

Ожидаемо:

```json
{
  "ok": true,
  "service": "company-control-plane"
}
```

## 32. Частые проблемы и решения

### Telegram пишет "неизвестная команда"

Причины:

- Telegram menu stale;
- команда не входит в `TELEGRAM_BOT_COMMANDS`;
- bot не перезапущен;
- пользователь вводит старую команду.

Решение:

```bash
systemctl restart company-control-plane-telegram-bot.service
journalctl -u company-control-plane-telegram-bot.service -n 100 --no-pager
```

### Google OAuth `disabled_client`

Причина:

- Google OAuth client disabled;
- Google account owner заблокирован;
- OAuth project/client недоступен.

Решение:

1. Создать/восстановить OAuth Web Client.
2. Проверить redirect URI.
3. Скачать JSON.
4. Загрузить JSON в `/setup`.
5. Все пользователи заново делают:

```text
/google_connect
```

### Metricon `REFRESH_TOKEN_REUSE_DETECTED`

Причина:

- refresh token был использован повторно двумя процессами;
- старая token chain инвалидирована.

Решение теперь встроено:

- setup хранит Metricon login/password;
- connector делает login fallback;
- новые access/refresh tokens сохраняются.

Если всё равно не работает:

- проверить `/setup`;
- проверить логи;
- проверить employee ID.

### Сервис падает с `EACCES`

Причина:

- runtime файлы перезаписаны root.

Решение:

```bash
chown company-control-plane:company-control-plane /var/lib/company-control-plane/*.json /var/lib/company-control-plane/secrets.key
chmod 600 /var/lib/company-control-plane/*.json /var/lib/company-control-plane/secrets.key
systemctl restart company-control-plane-api.service company-control-plane-telegram-bot.service
```

### Claude 403 `Request not allowed`

Проверить:

- API key;
- billing;
- credits;
- workspace permissions;
- limits;
- region/security settings.

Команда:

```text
/ai_status
```

### Локальный agent не выполняет команду

Проверить:

- `/agents`;
- device online;
- capabilities;
- heartbeat;
- command queue;
- local app permissions;
- macOS accessibility/background permissions;
- Windows autostart/firewall.

## 33. Что уже сделано крупно

- Централизованный Linux server вместо Radmin VPN.
- Node.js control-plane.
- Telegram registration через invite code.
- Иерархия OWNER/SENIOR_PM/PM.
- `/setup` wizard с encrypted secrets.
- Claude API integration.
- Google OAuth integration.
- Google privacy/terms/download pages.
- Metricon integration repaired.
- Platrum read-only integration.
- Bitrix legacy read-only integration.
- Token usage analytics.
- Daily assistant план/прогресс.
- Voice STT/TTS support.
- Device agent registration/commands.
- Download page для локального агента.
- Windows installer.
- macOS/Linux download artifacts.
- n8n server deployed.

## 34. Что ещё нужно сделать

### Высокий приоритет

1. Найти реальные Metricon employee IDs для Максата, PM2, PM3 и записать mapping.
2. Довести n8n workflows до визуального дерева nodes, не одного JS blob.
3. Проверить Google OAuth после нового client JSON: все пользователи должны сделать `/google_connect`.
4. Улучшить AI report formatting: меньше мусора, больше понятных таблиц/выводов.
5. Довести локальный OpenClaw agent на macOS.
6. Проверить Windows local agent autostart и auto-update.
7. Доработать device actions: YouTube not only open/search, but actually play selected result reliably.
8. Расширить memory, чтобы ассистент помнил незавершённые команды и контекст.

### Средний приоритет

1. Стабилизировать Platrum mappings по всем сотрудникам/проектам.
2. Вывести отдельную админскую страницу status/debug.
3. Добавить backup/restore runtime state.
4. Сделать нормальный deployment script.
5. Добавить healthcheck для Metricon/Google/Claude/Platrum.
6. Разделить legacy `kickidler` names на user-facing `metricon`.

### Низкий приоритет

1. Почистить старые документы.
2. Привести encoding русских строк в некоторых файлах.
3. Переработать README.
4. Уменьшить dirty worktree перед полноценным PR.

## 35. Правила безопасности

- Не писать API keys/passwords в Git.
- Не коммитить `kickidler/`.
- Не коммитить `openclaw/`, если это не оформленный submodule/fork.
- Не трогать production runtime state без backup.
- Перед изменением `/var/lib/company-control-plane/control-plane.json` делать copy backup.
- После ручных правок runtime файлов проверять владельца.
- Все интеграции с Bitrix/Platrum/Metricon держать read-only, если нет явного подтверждения на write.
- Delete operations должны быть заблокированы.
- Google scopes должны соответствовать privacy/terms и реальному поведению приложения.

## 36. Минимальный onboarding нового разработчика

1. Прочитать этот файл.
2. Прочитать:

```text
C:\Users\dasmu\agent\README.md
C:\Users\dasmu\agent\CODEX_WORKLOG_FOR_CLAUDE.md
C:\Users\dasmu\agent\control-plane\README.md
C:\Users\dasmu\agent\control-plane\docs\METRICON_API.md
```

3. Локально запустить тесты:

```powershell
cd C:\Users\dasmu\agent\control-plane
npm test
```

4. Зайти на сервер:

```bash
ssh root@195.238.122.228
```

5. Проверить сервисы:

```bash
systemctl is-active company-control-plane-api.service
systemctl is-active company-control-plane-telegram-bot.service
docker ps
```

6. Открыть `/setup` через SSH tunnel.

7. Не менять production secrets без согласования.

8. Любую работу записывать в:

```text
C:\Users\dasmu\agent\CODEX_WORKLOG_FOR_CLAUDE.md
```

## 37. Быстрый список важных путей

Локально:

```text
C:\Users\dasmu\agent
C:\Users\dasmu\agent\control-plane
C:\Users\dasmu\agent\CODEX_WORKLOG_FOR_CLAUDE.md
C:\Users\dasmu\agent\n8n
C:\Users\dasmu\agent\openclaw
C:\Users\dasmu\agent\openclaw-starlab-2026.6.5
C:\Users\dasmu\platrum
```

На сервере:

```text
/opt/company-control-plane
/var/lib/company-control-plane
/etc/company-control-plane/control-plane.env
/etc/systemd/system/company-control-plane-api.service
/etc/systemd/system/company-control-plane-telegram-bot.service
/etc/nginx/sites-available/starlabagent.pp.ua
/opt/starlab-n8n
/opt/starlab-n8n/docker-compose.yml
/opt/starlab-n8n/.env
/opt/starlab-n8n/admin-credentials.txt
/opt/company-control-plane/public/downloads
```

## 38. Проверочный чеклист перед тем, как сказать "всё работает"

```bash
systemctl is-active company-control-plane-api.service
systemctl is-active company-control-plane-telegram-bot.service
docker ps
curl http://127.0.0.1:3099/health
cd /opt/company-control-plane && npm test
```

Проверить в Telegram:

```text
/help
/ai_status
/google_status
/agents
/report
/platrum
```

Проверить публично:

```text
https://starlabagent.pp.ua/download
https://starlabagent.pp.ua/privacy
https://starlabagent.pp.ua/terms
```

Проверить Metricon:

- Бегайым должна возвращать activity через Metricon ID `32`;
- Николай должен возвращать activity через Metricon ID `74`;
- Максат пока не должен показывать fake Metricon activity, пока не найден real employee ID.

## 39. Последний важный контекст

Проект быстро менялся. Некоторые старые названия и решения остались в коде:

- `kickidler` в коде = Metricon в продукте;
- `/bitrix` частично legacy, основной task/project source должен быть Platrum;
- n8n есть, но часть логики всё ещё в control-plane;
- локальный OpenClaw agent ещё не полностью доведён;
- Google OAuth был пересоздан/обновлён, пользователям нужен reconnect;
- Metricon уже починен для подтверждённых real employee IDs.

Новый сотрудник должен сначала стабилизировать текущую архитектуру, а не начинать всё переписывать.

