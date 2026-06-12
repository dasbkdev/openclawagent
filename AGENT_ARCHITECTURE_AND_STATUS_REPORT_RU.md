# Starlab Agent - подробный отчет по серверу и агентам

Дата: 2026-06-04  
Что описано: центральный серверный агент, агент Максата на macOS, агент ПМ на Windows, текущая польза, ограничения и дальнейшие шаги.  
Важно: в этом документе нет паролей, токенов, webhook URL, Claude API key, Google OAuth JSON или других секретов.

---

## 1. Коротко: что у нас сейчас работает

Сейчас у нас построена централизованная схема.

Главный компонент - Linux VPS сервер. На нем работает `company-control-plane`.
Он отвечает за API, Telegram-бота, иерархию пользователей, настройки сервисов,
шифрование секретов, отчеты, аудит, аналитику токенов и список подключенных
устройств.

Компьютеры сотрудников не являются отдельными серверами. На них стоит легкий
device-agent. Его задача сейчас - автоматически запускаться, собирать базовую
информацию о компьютере и каждые 60 секунд отправлять heartbeat на центральный
сервер.

Текущее состояние устройств по данным VPS:

| Устройство | Пользователь | Роль | Хост | ОС | Режим запуска | Последний heartbeat UTC |
|---|---|---|---|---|---|---|
| `maksat-mac-mini` | `u-maksat` | SENIOR_PM | `Mac-mini.local` | macOS arm64 | LaunchDaemon | `2026-06-04T10:02:40.757Z` |
| `nikolay-windows` | `u-nikolay` | OWNER | `WIN-5IMJD8NIIM7` | Windows x64 | SYSTEM task | `2026-06-04T10:02:40.496Z` |
| `begayym-windows` | `u-pm-1` | PM | `DESKTOP-M780PPS` | Windows x64 | SYSTEM task | `2026-06-04T10:01:59.229Z` |

Главный вывод: установка уже работает. Николай через центральный сервер видит
свой компьютер, компьютер Максата и ноут ПМ. На Mac и Windows агенты стоят в
production-режиме автозапуска.

---

## 2. Что такое центральный серверный агент

Центральный серверный агент - это наш основной control-plane.

Он установлен на Linux VPS:

```text
/opt/company-control-plane
```

Рабочие данные лежат здесь:

```text
/var/lib/company-control-plane
```

Главные файлы состояния:

```text
/var/lib/company-control-plane/control-plane.json
/var/lib/company-control-plane/runtime-config.json
/var/lib/company-control-plane/secrets.json
/var/lib/company-control-plane/secrets.key
```

Сервисы:

```text
company-control-plane-api.service
company-control-plane-telegram-bot.service
nginx
```

API слушает локально:

```text
127.0.0.1:3099
```

Снаружи доступ идет через:

```text
https://starlabagent.pp.ua
```

Nginx защищает публичный UI/API Basic Auth. Endpoint heartbeat для локальных
агентов открыт без Basic Auth, но защищен отдельным ingest token через header
`X-Device-Agent-Token`.

---

## 3. Общая схема работы

```text
Telegram / Web UI / будущий OpenClaw bridge
             |
             v
https://starlabagent.pp.ua
             |
           Nginx
             |
             v
Linux VPS: company-control-plane API
             |
   +---------+----------+----------------+
   |         |          |                |
   v         v          v                v
Metricon   Bitrix   JSON state   encrypted secrets
```

Компьютеры сотрудников:

```text
Николай Windows  -> POST /api/v1/device-agents/heartbeat
Максат Mac       -> POST /api/v1/device-agents/heartbeat
ПМ Windows       -> POST /api/v1/device-agents/heartbeat
```

Почему так лучше, чем старая идея с Radmin VPN:

- Radmin VPN не ставится нормально на macOS.
- VPS дает одну центральную точку управления.
- Все устройства могут общаться по HTTPS.
- Не нужно держать частную VPN-сеть для каждого устройства.
- Легче проверять логи, аудит и доступы.
- Удобнее масштабировать на других сотрудников.

---

## 4. Что умеет сервер уже сейчас

Сервер умеет:

- принимать heartbeat от локальных агентов;
- хранить список устройств;
- показывать устройства по иерархии;
- хранить пользователей и проекты;
- проверять роли OWNER / SENIOR_PM / PM;
- регистрировать Telegram-пользователей через одноразовые коды;
- работать с Telegram-ботом;
- хранить настройки сервисов;
- шифровать секреты;
- подключаться к Bitrix через incoming webhook;
- подключаться к Metricon через access/refresh token;
- принимать события расхода токенов;
- строить отчеты по токенам;
- отправлять daily/weekly/monthly отчеты по токенам в Telegram;
- вести audit log важных действий.

Сервер пока не умеет:

- автоматически управлять OpenClaw на устройствах;
- удаленно выполнять команды на компьютерах сотрудников;
- читать локальные файлы сотрудников;
- снимать скриншоты;
- автоматически собирать токены из OpenClaw;
- автоматически считать устройство offline/stale;
- работать на PostgreSQL, пока используется JSON state.

---

## 5. Главные API endpoints

### Health

```text
GET /health
```

Проверяет, что API живой.

### Setup wizard

```text
GET /setup
GET /api/v1/setup/status
POST /api/v1/setup/services
GET /api/v1/setup/model-policy
```

Используется для первичной настройки Telegram, Google OAuth, Claude, Metricon,
Bitrix и token analytics.

### Device agents

```text
POST /api/v1/device-agents/heartbeat
GET /api/v1/device-agents
```

Первый endpoint принимает heartbeat от устройств. Второй показывает устройства,
доступные конкретному actor-у по иерархии.

### Telegram registration

```text
POST /api/v1/invite-codes
POST /api/v1/telegram/register
```

OWNER создает invite code. Пользователь регистрируется через код.

### Metricon

```text
POST /api/v1/reports/metricon/activity-summary
```

Собирает activity summary по сотрудникам или проектам.

### Bitrix

```text
POST /api/v1/reports/bitrix/project-status
```

Собирает статус задач проекта из Bitrix.

### Token usage

```text
POST /api/v1/token-usage/events
GET /api/v1/token-usage/summary?period=day|week|month
```

Принимает события расхода токенов и строит аналитику.

### Audit

```text
GET /api/v1/audit-log
```

OWNER может смотреть аудит.

---

## 6. Что принимает heartbeat от локального агента

Endpoint:

```text
POST /api/v1/device-agents/heartbeat
```

Защита:

```text
X-Device-Agent-Token: <секретный ingest token>
```

Пример тела запроса:

```json
{
  "userId": "u-maksat",
  "deviceId": "maksat-mac-mini",
  "displayName": "Maksat Mac Mini",
  "hostname": "Mac-mini.local",
  "platform": "darwin",
  "arch": "arm64",
  "osRelease": "25.5.0",
  "agentVersion": "0.1.0",
  "capabilities": ["heartbeat", "openclaw-client"],
  "labels": {
    "role": "SENIOR_PM",
    "person": "Maksat",
    "mode": "daemon"
  }
}
```

Сервер делает следующее:

- проверяет ingest token;
- проверяет, что `userId` существует;
- проверяет, что `deviceId` передан;
- создает или обновляет запись устройства;
- сохраняет hostname, platform, arch, osRelease;
- сохраняет `firstSeenAt`;
- обновляет `lastSeenAt`;
- увеличивает `heartbeatCount`;
- сохраняет labels и capabilities;
- при первом появлении устройства пишет audit event.

Что heartbeat НЕ отправляет:

- пароли;
- токены;
- файлы;
- скриншоты;
- содержимое документов;
- историю браузера;
- активные окна;
- нажатия клавиш;
- данные Claude/OpenClaw запросов.

---

## 7. Иерархия и права доступа

Текущая иерархия:

```text
Николай (OWNER)
  |
  +-- Максат (SENIOR_PM)
        |
        +-- ПМ 1 / Бегайым (PM)
        +-- ПМ 2 (PM)
        +-- ПМ 3 (PM)
```

Правила:

| Роль | Что видит |
|---|---|
| OWNER | всех пользователей, все проекты, все устройства, audit, token reports |
| SENIOR_PM | себя и подчиненных ПМ, проекты своей группы |
| PM | только себя и свои проекты |

Практически это значит:

- Николай видит Максата, ПМ и их устройства.
- Максат после регистрации Telegram должен видеть себя и подчиненных ПМ.
- ПМ после регистрации Telegram должен видеть только себя и свой scope.

Сейчас Telegram linked:

- Николай: да.
- Максат: пока нет.
- ПМ: пока нет.

---

## 8. Telegram-бот

Telegram-бот работает long polling-ом. То есть Telegram webhook не нужен.

Команды:

```text
/register CODE
/me
/users
/agents
/projects
/report today
/report week
/project PROJECT_ID today
/project PROJECT_ID week
/bitrix PROJECT_ID
/tokens day
/tokens week
/tokens month
```

Назначение:

| Команда | Что делает |
|---|---|
| `/register CODE` | привязывает Telegram к пользователю |
| `/me` | показывает профиль |
| `/users` | показывает доступных пользователей |
| `/agents` | показывает видимые устройства |
| `/projects` | показывает доступные проекты |
| `/report today/week` | отчет Metricon |
| `/project PROJECT_ID today/week` | Metricon по проекту |
| `/bitrix PROJECT_ID` | статус задач Bitrix |
| `/tokens day/week/month` | отчет по токенам |

Команда `/tokens` ограничена получателем, заданным в настройках. Это сделано,
чтобы аналитику расходов видел только нужный пользователь.

---

## 9. Metricon

Metricon подключается через:

- base URL;
- access token;
- refresh token.

Refresh token предпочтителен, потому что access token может жить недолго.

Серверный connector умеет:

- ходить в Metricon API;
- использовать Bearer access token;
- получать access token через refresh token;
- при 401/403 обновить token и повторить запрос один раз.

Отчет Metricon строится по:

- конкретному пользователю;
- проекту;
- всем доступным пользователям actor-а.

Ограничение:

- точную форму production endpoint Metricon еще нужно окончательно подтвердить
  по Swagger/OpenAPI и реальным правам аккаунта.

---

## 10. Bitrix

Bitrix подключается через incoming webhook URL.

Сервер вызывает:

```text
tasks.task.list
```

Фильтр:

```text
GROUP_ID = project.bitrixGroupId
```

Сервер нормализует задачи:

- ID;
- title;
- status;
- deadline;
- responsible user;
- changed date;
- closed date;
- overdue flag.

В отчете считает:

- всего задач;
- открытые;
- завершенные;
- просроченные;
- распределение по статусам.

Ограничение:

- текущие `bitrixGroupId` в проектах являются MVP placeholders: `101`, `102`,
  `103`. Для реальной пользы нужно заменить их на настоящие ID групп/проектов
  Bitrix.

---

## 11. Token analytics

Сервер уже умеет принимать события расхода токенов.

Пример:

```json
{
  "userId": "u-pm-1",
  "projectId": "project-alpha",
  "action": "openclaw.chat",
  "source": "openclaw",
  "provider": "anthropic",
  "model": "anthropic/claude-sonnet-4-6",
  "inputTokens": 1000,
  "outputTokens": 500,
  "totalTokens": 1500,
  "costUsd": 0.01
}
```

Сервер агрегирует:

- по пользователям;
- по действиям;
- по моделям;
- по проектам;
- за день;
- за неделю;
- за месяц.

Также Telegram bot может отправлять daily/weekly/monthly отчеты.

Ограничение:

- OpenClaw пока не подключен к автоматической отправке token usage events.
  Значит, аналитика готова как backend, но пока не будет полной, пока мы не
  встроим отправку событий из OpenClaw/Claude wrapper.

---

## 12. Агент Максата

Компьютер:

```text
Mac-mini.local
```

ОС:

```text
macOS/Darwin 25.5.0 arm64
```

Пользователь:

```text
asik
```

Identity:

```text
deviceId=maksat-mac-mini
userId=u-maksat
role=SENIOR_PM
person=Maksat
mode=daemon
```

Установка:

```text
/Users/asik/Library/Application Support/CompanyControlPlaneAgent
```

LaunchDaemon:

```text
/Library/LaunchDaemons/com.company.control-plane.device-agent.plist
```

Сервис:

```text
system/com.company.control-plane.device-agent
```

Запускается как пользователь:

```text
asik
```

Логи:

```text
/Users/asik/Library/Application Support/CompanyControlPlaneAgent/logs/device-agent.out.log
/Users/asik/Library/Application Support/CompanyControlPlaneAgent/logs/device-agent.err.log
```

Почему LaunchDaemon - это хорошо:

- стартует из system launchd domain;
- не зависит от GUI LaunchAgent;
- надежнее для production;
- подходит для устройства, которое должно репортиться после загрузки системы.

Текущее состояние:

```text
lastSeenAt=2026-06-04T10:02:40.757Z
heartbeatCount=124
capabilities=heartbeat, openclaw-client
```

Статус: работает.

---

## 13. Агент ПМ

Компьютер:

```text
DESKTOP-M780PPS
```

ОС:

```text
Windows 11 Pro x64
```

Identity:

```text
deviceId=begayym-windows
userId=u-pm-1
role=PM
person=Begayym
mode=system
```

Установка:

```text
C:\ProgramData\CompanyControlPlaneAgent
```

Windows Scheduled Task:

```text
CompanyControlPlaneDeviceAgent
```

Запускается от:

```text
SYSTEM
```

Trigger:

```text
At startup
```

Логи:

```text
C:\ProgramData\CompanyControlPlaneAgent\logs\device-agent.out.log
C:\ProgramData\CompanyControlPlaneAgent\logs\device-agent.err.log
```

Почему SYSTEM task - это хорошо:

- запускается при старте Windows;
- не зависит от ручного запуска приложения;
- не требует открытой консоли;
- надежнее, чем user-level запуск.

Текущее состояние:

```text
lastSeenAt=2026-06-04T10:01:59.229Z
heartbeatCount=48
capabilities=heartbeat, openclaw-client
```

Статус: работает.

---

## 14. Агент Николая

Компьютер:

```text
WIN-5IMJD8NIIM7
```

Identity:

```text
deviceId=nikolay-windows
userId=u-nikolay
role=OWNER
person=Nikolay
mode=system
```

Установка:

```text
C:\ProgramData\CompanyControlPlaneAgent
```

Запуск:

```text
Windows SYSTEM scheduled task
```

Текущее состояние:

```text
lastSeenAt=2026-06-04T10:02:40.496Z
heartbeatCount=172
```

Статус: работает.

---

## 15. Насколько это полезно уже сейчас

Уже полезно:

- есть рабочая централизованная архитектура;
- устройства Windows и macOS подключаются без Radmin VPN;
- Николай видит компьютеры сотрудников;
- можно проверить, жив ли агент на устройстве;
- есть база для будущего управления OpenClaw;
- есть иерархия доступа;
- есть Telegram-бот;
- есть зашифрованное хранение секретов;
- есть подготовка к Bitrix/Metricon отчетам;
- есть подготовка к аналитике токенов.

Самая важная польза сейчас:

```text
Мы доказали, что сервер может централизованно видеть устройства сотрудников
и применять иерархию доступа.
```

Это фундамент. Без него дальнейший “умный агент” был бы неуправляемым.

---

## 16. Что пока не готово

Пока не готово:

- полноценный OpenClaw bridge;
- удаленные команды с сервера на устройство;
- автоматическая отправка token usage из OpenClaw;
- автоматическая offline/stale логика;
- реальные Bitrix group IDs;
- финальная проверка Metricon production endpoint;
- PostgreSQL;
- полноценный web dashboard;
- безопасные очереди задач для локальных агентов.

Важно: `openclaw-client` в capabilities сейчас означает “устройство подготовлено
под будущую интеграцию”, а не то, что OpenClaw уже полностью управляется
сервером.

---

## 17. Что нужно делать дальше

### 1. Добавить stale/offline статус

Сейчас сервер хранит `lastSeenAt`, но не пересчитывает offline автоматически.

Нужно:

- online: heartbeat младше 2 минут;
- stale: 2-10 минут;
- offline: старше 10 минут.

### 2. Зарегистрировать Telegram Максата и ПМ

Николай должен создать invite codes.

Потом:

- Максат делает `/register CODE`;
- ПМ делает `/register CODE`.

После этого проверяем:

- Максат видит себя и ПМ;
- ПМ видит только себя;
- Николай видит всех.

### 3. Настроить настоящие Bitrix project IDs

Нужно заменить:

```text
project-alpha -> реальный Bitrix group/project id
project-beta  -> реальный Bitrix group/project id
project-gamma -> реальный Bitrix group/project id
```

### 4. Проверить Metricon API

Нужно подтвердить:

- endpoint отчетов;
- employee ID mapping;
- access/refresh token flow;
- поля active/idle/lock/app usage.

### 5. Подключить OpenClaw bridge

Будущий local bridge должен:

- запускать/контролировать OpenClaw;
- читать model policy;
- использовать последнюю Sonnet;
- отправлять token usage events;
- репортить состояние OpenClaw;
- принимать только безопасные команды.

### 6. Подключить token usage auto-ingest

После интеграции OpenClaw все Claude вызовы должны отправлять:

```text
POST /api/v1/token-usage/events
```

Тогда можно будет реально видеть:

- кто тратит больше всего токенов;
- на какие действия уходят токены;
- какие проекты дороже;
- какие модели используются.

### 7. Перейти на PostgreSQL

JSON state подходит для MVP, но для production нужен PostgreSQL:

- надежнее;
- быстрее;
- проще бэкапить;
- лучше для аналитики;
- меньше риск конфликтов записи.

---

## 18. Что Claude должен проверить

Claude стоит проверить:

- `control-plane/src/api/router.js`
  - auth;
  - endpoints;
  - RBAC;
  - heartbeat ingest.
- `control-plane/src/domain/device-agents.js`
  - валидацию payload;
  - фильтрацию по иерархии;
  - public output.
- `control-plane/src/device-agent.js`
  - env parsing;
  - heartbeat payload;
  - timeout;
  - отсутствие утечки токенов в лог.
- `control-plane/scripts/install-device-agent-windows.ps1`
  - `-RunAsSystem`;
  - ProgramData path;
  - SYSTEM task.
- `control-plane/scripts/macos/install-device-agent.sh`
  - `--run-as-daemon`;
  - LaunchDaemon;
  - `UserName`;
  - удаление старого user LaunchAgent.
- `control-plane/src/connectors/bitrix-client.js`
  - shape `tasks.task.list`;
  - status mapping.
- `control-plane/src/connectors/kickidler-client.js`
  - refresh token;
  - retry on 401/403;
  - final Metricon endpoint.
- `control-plane/src/domain/token-usage.js`
  - корректность агрегации;
  - валидацию событий.

Отдельно по безопасности:

- нет секретов в отчетах/worklog;
- heartbeat endpoint закрыт ingest token;
- setup secrets шифруются;
- Telegram actor проверяется;
- OWNER-only функции не доступны другим ролям.

---

## 19. Итог

Сейчас у нас рабочий централизованный MVP.

Сервер:

- живой;
- принимает heartbeat;
- хранит устройства;
- применяет иерархию;
- работает с Telegram;
- хранит секреты зашифрованно;
- готовит Metricon/Bitrix отчеты;
- готовит token analytics.

Устройства:

- Максат Mac работает как production LaunchDaemon;
- ПМ Windows работает как SYSTEM scheduled task;
- Николай Windows работает как SYSTEM scheduled task;
- все трое видны Николаю через центральный сервер.

Главная оставшаяся задача - не установка. Установка уже в хорошем состоянии.

Главная оставшаяся задача - превратить heartbeat-клиентов в настоящих
OpenClaw-connected агентов, которые смогут отправлять token usage, показывать
состояние OpenClaw и выполнять безопасные role-scoped действия.
