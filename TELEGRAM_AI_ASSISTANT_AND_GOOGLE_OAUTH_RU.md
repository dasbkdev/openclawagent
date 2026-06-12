# Telegram AI assistant и Google OAuth - что меняется

Дата: 2026-06-04

---

## 1. Что изменилось в Telegram-боте

Раньше Telegram-бот работал только по командам:

```text
/agents
/report today
/bitrix project-alpha
/tokens day
```

Теперь добавлен MVP AI-ассистента.
Также добавлена удобная команда для Николая:

```text
/invite
/invite u-maksat
/invite u-pm-1
```

`/invite` показывает список сотрудников и их статус привязки Telegram.
`/invite USER_ID` создает одноразовый код, который сотрудник вводит через
`/register CODE`.

Это значит: если пользователь пишет обычный текст без `/`, бот отправляет
вопрос в Claude API и дает Claude только тот контекст, который разрешен этому
пользователю по иерархии.

Пример:

```text
Максат пишет:
Как сегодня работала Бегайым?
```

Бот:

1. Определяет Telegram-пользователя.
2. Находит его роль в системе.
3. Проверяет, кого он имеет право видеть.
4. Собирает контекст:
   - доступные пользователи;
   - видимые устройства;
   - Metricon activity за период;
   - Bitrix задачи по связанным проектам;
   - Google Calendar/Gmail/Drive/Docs/Sheets по подключенным сотрудникам;
   - роли и проекты.
5. Отправляет этот контекст в Claude.
6. Возвращает ответ пользователю в Telegram.
7. Записывает расход токенов ответа в token analytics.

---

## 2. Как бот должен отвечать в будущем

Целевая логика:

```text
Пользователь:
Как сегодня работала Бегайым?

Бот:
Бегайым сегодня была активна примерно 5 часов.
По Bitrix у нее было 8 задач на день: 5 выполнено, 2 в работе, 1 просрочена.
Эффективность по задачам: 62.5%.
Главный риск: просрочена задача по ...
```

Но такой точный ответ возможен только если подключены реальные данные:

- Metricon реально отдает активность и рабочие интервалы;
- Bitrix проекты правильно сопоставлены с нашими внутренними project IDs;
- задачи в Bitrix имеют понятные статусы/deadline;
- Google Calendar/Gmail/Docs/Sheets/Drive подключены через OAuth каждого сотрудника;
- OpenClaw начнет отправлять token usage events.

---

## 3. Какие данные Claude получает сейчас

Claude получает только рабочий контекст, без секретов:

- текущий пользователь и его роль;
- кого пользователь может видеть;
- видимые устройства;
- `lastSeenAt` агентов;
- проекты;
- Bitrix summaries/tasks, если Bitrix доступен;
- Metricon activity, если Metricon доступен;
- Google Workspace snapshot, если сотрудник подключил Google:
  - события Calendar за период;
  - последние письма Gmail за период;
  - последние измененные файлы Drive;
  - короткие фрагменты Google Docs;
  - первые строки Google Sheets;
- labels устройств, например `person=Begayym`;
- capabilities, например `heartbeat`, `openclaw-client`.

Claude не получает:

- пароли;
- токены;
- Bitrix webhook URL;
- Telegram bot token;
- Claude API key;
- Google OAuth JSON;
- Metricon access/refresh token.

---

## 4. Защита по иерархии

AI-ассистент использует ту же иерархию:

```text
Николай OWNER
  -> видит всех

Максат SENIOR_PM
  -> видит себя и подчиненных ПМ

ПМ
  -> видит только себя и свои проекты
```

Если ПМ спросит про Николая или Максата вне своего scope, бот не должен
раскрывать данные.

---

## 5. Что уже реализовано в коде

Добавлены файлы:

```text
control-plane/src/assistant/claude-client.js
control-plane/src/assistant/company-assistant.js
control-plane/src/integrations/google-oauth.js
```

Изменены:

```text
control-plane/src/telegram/handler.js
control-plane/src/telegram-bot.js
control-plane/test/telegram.test.js
```

Что делает реализация:

- обычный Telegram-текст без `/` идет в AI assistant;
- Claude client берется из `CLAUDE_API_KEY` / `ANTHROPIC_API_KEY`;
- модель берется из `CLAUDE_MODEL`;
- контекст собирается только по разрешенным пользователям/проектам;
- Metricon и Bitrix данные добавляются в контекст;
- Google Calendar/Gmail/Drive/Docs/Sheets данные добавляются в контекст, если сотрудник
  подключил Google через `/google_connect`;
- access token Google автоматически обновляется через refresh token перед API
  calls;
- Claude отвечает на русском;
- ответ записывает token usage event с action `telegram.assistant`;
- audit log получает событие `telegram.assistant.ask`;
- если Claude API key не настроен, бот не падает, а пишет, что ключ не задан.

---

## 6. Важный момент по Google OAuth

Google OAuth JSON не надо загружать отдельно для каждого сотрудника.

Google OAuth JSON - это credentials приложения, то есть файл от Google Cloud
для нашего сервера/продукта. Он загружается один раз в setup wizard.

То, что нужно каждому сотруднику, называется не JSON, а OAuth authorization:

1. Мы загружаем один Google OAuth client JSON для приложения.
2. Каждый сотрудник нажимает кнопку или команду типа `/google_connect`.
3. Сервер отправляет сотрудника на Google consent screen.
4. Сотрудник разрешает доступ к Calendar/Gmail/Drive/Docs/Sheets.
5. Google возвращает authorization code на callback URL.
6. Сервер меняет code на access token + refresh token.
7. Refresh token сохраняется зашифрованно за конкретным `userId`.
8. После этого сервер может читать Google-данные именно этого сотрудника.

---

## 7. Куда сейчас загружать Google OAuth JSON

Сейчас в системе есть только загрузка общего Google OAuth client JSON.

Открыть setup:

```text
https://starlabagent.pp.ua/setup
```

Там есть блок:

```text
Google OAuth JSON
```

Туда загружается JSON из Google Cloud Console.

Это не подключает автоматически каждого сотрудника. Это только дает серверу
credentials приложения, чтобы потом можно было сделать OAuth flow для каждого
сотрудника.

---

## 8. Что уже реализовано для Google каждого сотрудника

Теперь реализовано:

- `/google_connect` в Telegram;
- `/google_status` в Telegram;
- `/google_disconnect` в Telegram;
- endpoint `GET /api/v1/google/oauth/start`;
- endpoint `GET /api/v1/google/oauth/callback`;
- endpoint `GET /api/v1/google/status`;
- endpoint `GET /api/v1/google/workspace-snapshot`;
- endpoint `POST /api/v1/google/oauth/disconnect`;
- encrypted per-user Google refresh tokens;
- сохранение Google account email/name без раскрытия токенов;
- защита callback через signed `state`;
- audit events для connect/disconnect;
- чтение Google Calendar за выбранный период;
- чтение последних Gmail messages metadata за выбранный период;
- чтение последних файлов Google Drive;
- чтение коротких фрагментов Google Docs;
- чтение первых строк Google Sheets;
- добавление Google data в AI assistant context;
- автоматическое обновление access token перед Google API calls.

Все еще не реализовано:

- чтение Google Docs/Sheets без лимитов;
- отправка писем или редактирование Google файлов;
- отдельный web dashboard для управления подключениями.

---

## 9. Как сотруднику подключить Google

1. Админ один раз загружает Google OAuth client JSON в setup wizard.
2. В Google Cloud Console нужно добавить redirect URI:

```text
https://starlabagent.pp.ua/api/v1/google/oauth/callback
```

3. Сотрудник пишет боту:

```text
/google_connect
```

4. Бот отправляет ссылку Google OAuth.
5. Сотрудник открывает ссылку и дает разрешения.
6. Google возвращает пользователя на callback URL.
7. Сервер сохраняет refresh token зашифрованно за его `userId`.
8. Проверить можно командой:

```text
/google_status
```

9. Отключить можно командой:

```text
/google_disconnect
```

Refresh token хранится не в plain JSON state, а в encrypted secrets.

---

## 10. Какие Google scopes нужны

Минимально для MVP:

```text
Google Calendar read-only
Google Drive metadata/read-only
Google Docs read-only
Google Sheets read-only
Gmail read-only
```

Лучше начинать read-only, без права отправлять письма или редактировать файлы.
Так безопаснее.

---

## 11. Следующий правильный этап разработки

1. Загружаем Google OAuth client JSON в setup wizard.
2. Проверяем `/google_connect` на Николае.
3. Регистрируем Telegram Максата и ПМ через invite codes.
4. Каждый сотрудник подключает Google через `/google_connect`.
5. Проверяем, что `GET /api/v1/google/workspace-snapshot` видит Calendar/Gmail/Drive/Docs/Sheets.
6. Следующим этапом настраиваем project/user mapping так, чтобы ассистент точнее понимал,
   какие документы относятся к какому проекту.
7. После этого бот сможет отвечать еще полнее:
   - что было в календаре;
   - какие письма важные;
   - какие документы/таблицы обновлялись;
   - какие задачи были в Bitrix;
   - какая активность была в Metricon.

---

## 12. Итог

Telegram-бот должен стать универсальным рабочим ассистентом.

Текущий новый MVP уже делает два шага:

```text
обычный текст в Telegram -> контекст по иерархии -> Claude -> ответ -> token analytics
Google OAuth client JSON -> /google_connect -> encrypted per-user refresh token -> Calendar/Gmail/Drive/Docs/Sheets context
```

Правильная схема остается такой:

```text
один OAuth client JSON для приложения
+ индивидуальная авторизация каждого сотрудника через Google OAuth flow
+ encrypted refresh token на каждого userId
```
