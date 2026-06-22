import assert from "node:assert/strict";
import test from "node:test";
import { ClaudeApiError } from "../src/assistant/claude-client.js";
import { MockBitrixClient } from "../src/connectors/bitrix-client.js";
import { MockKickidlerClient } from "../src/connectors/kickidler-client.js";
import { createInviteCode } from "../src/domain/invite-codes.js";
import { getUserById } from "../src/domain/policy.js";
import { createInitialState } from "../src/infra/seed.js";
import { TELEGRAM_BOT_COMMANDS } from "../src/telegram/bot-commands.js";
import { parseTelegramCommand, resolveReportPeriod } from "../src/telegram/commands.js";
import { handleTelegramMessage } from "../src/telegram/handler.js";

test("parseTelegramCommand strips bot username and args", () => {
  assert.deepEqual(parseTelegramCommand("/report@company_bot week"), {
    name: "report",
    args: ["week"],
    raw: "/report@company_bot week",
  });
});

test("resolveReportPeriod supports week", () => {
  const now = new Date("2026-06-02T12:00:00Z");
  const period = resolveReportPeriod("week", now);
  assert.equal(period.to, "2026-06-02T12:00:00.000Z");
  assert.equal(period.from, "2026-05-26T12:00:00.000Z");
});

test("Telegram command menu exposes only useful product commands", () => {
  const commandNames = TELEGRAM_BOT_COMMANDS.map(({ command }) => command);
  assert.deepEqual(commandNames, [
    "help",
    "invite",
    "reset_code",
    "users",
    "agents",
    "device",
    "task",
    "projects",
    "today",
    "plan",
    "progress",
    "blocker",
    "done",
    "daily_report",
    "week_report",
    "platrum",
    "bitrix",
    "report",
    "google_connect",
    "google_status",
    "tokens",
    "ai_status",
    "status",
  ]);
  assert.equal(commandNames.includes("tools"), false);
  assert.equal(commandNames.includes("between"), false);
  assert.equal(commandNames.includes("side"), false);
  assert.equal(commandNames.includes("project"), false);
  assert.equal(commandNames.includes("google_disconnect"), false);
});

test("Telegram help mirrors the cleaned command menu", async () => {
  const telegram = createFakeTelegram();

  await handleTelegramMessage({
    telegram,
    message: message({ text: "/help", telegramUserId: 999, chatId: 10 }),
  });

  assert.match(telegram.messages[0].text, /Starlab Agent: команды/);
  assert.match(telegram.messages[0].text, /\/invite - создать код сотруднику/);
  assert.match(telegram.messages[0].text, /\/reset_code - перевыпустить код сотруднику/);
  assert.match(telegram.messages[0].text, /\/today - мой план и прогресс/);
  assert.match(telegram.messages[0].text, /\/platrum - задачи и канбан Platrum/);
  assert.match(telegram.messages[0].text, /\/bitrix - старый алиас для Platrum/);
  assert.doesNotMatch(telegram.messages[0].text, /\/tools/u);
  assert.doesNotMatch(telegram.messages[0].text, /\/between/u);
  assert.doesNotMatch(telegram.messages[0].text, /\/side/u);
  assert.doesNotMatch(telegram.messages[0].text, /\/project PROJECT_ID/u);
});

test("Telegram unknown slash command explains stale menu cache", async () => {
  const telegram = createFakeTelegram();

  await handleTelegramMessage({
    telegram,
    message: message({ text: "/tools", telegramUserId: 999, chatId: 10 }),
  });

  assert.match(telegram.messages[0].text, /Неизвестная команда/);
  assert.match(telegram.messages[0].text, /старый кеш меню/);
  assert.match(telegram.messages[0].text, /\/help/);
});

test("Telegram handler registers user and answers project/bitrix commands", async () => {
  const state = createInitialState();
  const owner = getUserById(state, "u-nikolay");
  const { code } = createInviteCode(state, {
    issuer: owner,
    userId: "u-pm-1",
    code: "TGPM1111",
  });
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();
  const deps = {
    store,
    telegram,
    kickidlerClient: new MockKickidlerClient(),
    bitrixClient: new MockBitrixClient(),
  };

  await handleTelegramMessage({
    ...deps,
    message: message({ text: `/register ${code}`, telegramUserId: 777, chatId: 10 }),
  });
  await handleTelegramMessage({
    ...deps,
    message: message({ text: "/projects", telegramUserId: 777, chatId: 10 }),
  });
  await handleTelegramMessage({
    ...deps,
    message: message({ text: "/bitrix project-alpha", telegramUserId: 777, chatId: 10 }),
  });

  assert.match(telegram.messages[0].text, /Регистрация завершена/);
  assert.match(telegram.messages[0].text, /Project Manager 1/);
  assert.match(telegram.messages[1].text, /project-alpha/);
  assert.match(telegram.messages[2].text, /Bitrix: задачи проекта/);
  assert.match(telegram.messages[2].text, /Project Alpha/);
});

test("Telegram owner can create invite code from bot and target can register with it", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();

  await handleTelegramMessage({
    store,
    telegram,
    message: message({ text: "/invite u-maksat", telegramUserId: 999, chatId: 10 }),
  });

  assert.match(telegram.messages[0].text, /Invite-код создан/);
  assert.match(telegram.messages[0].text, /Maksat/);
  assert.match(telegram.messages[0].text, /\/register [A-Z2-9]{8}/u);
  assert.equal(state.inviteCodes.length, 1);
  assert.equal(state.auditLog.at(-1).action, "telegram.invite.create");

  const code = telegram.messages[0].text.match(/Код:<\/b> ([A-Z2-9]{8})/u)[1];
  await handleTelegramMessage({
    store,
    telegram,
    message: message({ text: `/register ${code}`, telegramUserId: 888, chatId: 20 }),
  });

  assert.match(telegram.messages[1].text, /Регистрация завершена/);
  assert.match(telegram.messages[1].text, /Maksat/);
  assert.equal(getUserById(state, "u-maksat").telegram.telegramUserId, "888");
});

test("Telegram owner can reset employee registration code", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const owner = getUserById(state, "u-nikolay");
  createInviteCode(state, {
    issuer: owner,
    userId: "u-maksat",
    code: "OLDM1234",
  });
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();

  await handleTelegramMessage({
    store,
    telegram,
    message: message({ text: "/reset_code u-maksat", telegramUserId: 999, chatId: 10 }),
  });

  assert.match(telegram.messages[0].text, /Registration code перевыпущен/);
  assert.match(telegram.messages[0].text, /Maksat/);
  assert.match(telegram.messages[0].text, /\/register [A-Z2-9]{8}/u);
  assert.equal(state.inviteCodes.length, 2);
  assert.ok(state.inviteCodes.find((invite) => invite.codeLast4 === "1234").revokedAt);
  assert.equal(state.auditLog.at(-1).action, "telegram.invite.reissue");
  assert.equal(state.auditLog.at(-1).metadata.revokedCount, 1);

  const code = telegram.messages[0].text.match(/register ([A-Z2-9]{8})/u)[1];
  await handleTelegramMessage({
    store,
    telegram,
    message: message({ text: `/register ${code}`, telegramUserId: 888, chatId: 20 }),
  });

  assert.match(telegram.messages[1].text, /Регистрация завершена/);
  assert.equal(getUserById(state, "u-maksat").telegram.telegramUserId, "888");
});

test("Developer can reissue Nikolay registration code with two-step confirmation", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();
  const now = new Date("2026-06-11T06:00:00.000Z");

  await handleTelegramMessage({
    store,
    telegram,
    now,
    message: message({ text: "/reset_owner_code", telegramUserId: 984834133, chatId: 10 }),
  });

  const nonce = telegram.messages[0].text.match(/Код подтверждения: ([A-Z2-9]{6})/u)?.[1];
  assert.ok(nonce);
  assert.equal(state.inviteCodes.length, 0);

  await handleTelegramMessage({
    store,
    telegram,
    now: new Date("2026-06-11T06:01:00.000Z"),
    message: message({
      text: `/reset_owner_code confirm ${nonce}`,
      telegramUserId: 984834133,
      chatId: 10,
    }),
  });

  assert.equal(state.inviteCodes.length, 1);
  assert.equal(state.inviteCodes[0].userId, "u-nikolay");
  assert.equal(state.auditLog.at(-1).action, "telegram.owner_invite.recovery_reissue");
  assert.match(telegram.messages[1].text, /Новый registration code Николая создан/u);
  assert.equal(telegram.messages[2].chatId, "999");
});

test("Owner recovery command rejects an unrelated Telegram account", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const telegram = createFakeTelegram();

  await handleTelegramMessage({
    store: createMemoryStore(state),
    telegram,
    message: message({ text: "/reset_owner_code", telegramUserId: 123456, chatId: 10 }),
  });

  assert.match(telegram.messages[0].text, /только разработчику/u);
  assert.equal(state.ownerRecoveryRequests.length, 0);
});

test("Telegram invite command shows help and rejects non-owner issuers", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  getUserById(state, "u-pm-1").telegram = {
    telegramUserId: "777",
    username: "pm1",
    linkedAt: "2026-06-04T10:00:00.000Z",
  };
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();

  await handleTelegramMessage({
    store,
    telegram,
    message: message({ text: "/invite", telegramUserId: 999, chatId: 10 }),
  });
  await handleTelegramMessage({
    store,
    telegram,
    message: message({ text: "/invite u-maksat", telegramUserId: 777, chatId: 20 }),
  });

  assert.match(telegram.messages[0].text, /Доступные пользователи/);
  assert.match(telegram.messages[0].text, /u-maksat/);
  assert.match(telegram.messages[1].text, /Only OWNER can issue invite codes/);
  assert.equal(state.inviteCodes.length, 0);
});

test("Telegram ai_status reports Claude API availability problems", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();

  await handleTelegramMessage({
    store,
    telegram,
    claudeClient: {
      async healthCheck() {
        return {
          ok: false,
          configured: true,
          model: "claude-sonnet-4-6",
          status: 403,
          type: "forbidden",
          message: "Request not allowed",
        };
      },
    },
    message: message({ text: "/ai_status", telegramUserId: 999, chatId: 10 }),
  });

  assert.match(telegram.messages[0].text, /Claude API недоступен/);
  assert.match(telegram.messages[0].text, /HTTP:<\/b> 403/);
  assert.match(telegram.messages[0].text, /Request not allowed/);
});

test("Telegram free-form Claude API errors are explained clearly", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();

  await handleTelegramMessage({
    store,
    telegram,
    kickidlerClient: new MockKickidlerClient(),
    bitrixClient: new MockBitrixClient(),
    googleOAuthService: null,
    claudeClient: {
      async complete() {
        throw new ClaudeApiError({
          status: 403,
          type: "forbidden",
          message: "Request not allowed",
        });
      },
    },
    message: message({ text: "привет", telegramUserId: 999, chatId: 10 }),
  });

  assert.match(telegram.messages[0].text, /Ошибка Claude API/);
  assert.match(telegram.messages[0].text, /\/ai_status/);
  assert.match(telegram.messages[0].text, /\/bitrix/);
});

test("Telegram natural language desktop command queues a real device command before Claude", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  state.deviceAgents.push({
    id: "device-asik-mac-mini.local",
    deviceId: "asik-mac-mini.local",
    userId: "u-maksat",
    displayName: "asik on Mac mini",
    hostname: "Mac mini",
    platform: "darwin",
    arch: "arm64",
    status: "online",
    firstSeenAt: "2026-06-10T10:00:00.000Z",
    lastSeenAt: "2026-06-10T10:01:00.000Z",
    heartbeatCount: 5,
    capabilities: ["heartbeat", "command-polling", "open_app", "open_url"],
    labels: {},
  });
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();

  await handleTelegramMessage({
    store,
    telegram,
    claudeClient: {
      async complete() {
        throw new Error("Claude should not be called for desktop action intents");
      },
    },
    message: message({ text: "открой Chrome на asik mac mini", telegramUserId: 999, chatId: 10 }),
  });

  assert.equal(state.deviceCommands.length, 1);
  assert.equal(state.deviceCommands[0].deviceId, "asik-mac-mini.local");
  assert.equal(state.deviceCommands[0].type, "open_app");
  assert.deepEqual(state.deviceCommands[0].args, { app: "Google Chrome" });
  assert.match(telegram.messages[0].text, /Команда отправлена/);
});

test("Telegram natural language remaining tasks marks only open daily plan items done", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  getUserById(state, "u-pm-1").telegram = {
    telegramUserId: "777",
    username: "pm1",
    linkedAt: "2026-06-10T08:00:00.000Z",
  };
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();
  const now = new Date("2026-06-10T09:00:00.000Z");

  await handleTelegramMessage({
    store,
    telegram,
    now,
    message: message({ text: "/plan задача 1; задача 2; задача 3", telegramUserId: 777, chatId: 10 }),
  });
  await handleTelegramMessage({
    store,
    telegram,
    now: new Date("2026-06-10T10:00:00.000Z"),
    message: message({ text: "/done 1", telegramUserId: 777, chatId: 10 }),
  });
  await handleTelegramMessage({
    store,
    telegram,
    now: new Date("2026-06-10T11:00:00.000Z"),
    claudeClient: {
      async complete() {
        throw new Error("Claude should not be called for remaining-task updates");
      },
    },
    message: message({ text: "сделала оставшиеся задачи", telegramUserId: 777, chatId: 10 }),
  });

  const plan = state.dailyWorkPlans[0];
  assert.deepEqual(plan.items.map((item) => item.status), ["done", "done", "done"]);
  assert.match(telegram.messages[2].text, /Новых выполненных пунктов:<\/b> 2/);
  assert.equal(state.assistantMemory.some((event) => event.kind === "daily_plan_remaining_done_request"), true);
});

test("Telegram handler answers free-form assistant questions through Claude", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  state.deviceAgents.push({
    id: "device-begayym-windows",
    deviceId: "begayym-windows",
    userId: "u-pm-1",
    displayName: "Begayym Windows",
    hostname: "DESKTOP-M780PPS",
    platform: "win32",
    arch: "x64",
    osRelease: "10.0.26200",
    agentVersion: "0.1.0",
    status: "online",
    firstSeenAt: "2026-06-04T09:13:55.542Z",
    lastSeenAt: "2026-06-04T10:01:59.229Z",
    heartbeatCount: 48,
    capabilities: ["heartbeat", "openclaw-client"],
    labels: { role: "PM", person: "Begayym", mode: "system" },
  });
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();
  const claudeClient = {
    async complete({ user }) {
      assert.match(user, /Бегайым|Begayym/u);
      assert.match(user, /project-alpha/u);
      assert.match(user, /bitrixUserTasks/u);
      assert.match(user, /googleWorkspace/u);
      assert.match(user, /Daily sync/u);
      return {
        text: "Бегайым сегодня активна, задачи вижу в контексте.",
        model: "claude-test-sonnet",
        configured: true,
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      };
    },
  };

  await handleTelegramMessage({
    store,
    telegram,
    kickidlerClient: new MockKickidlerClient(),
    bitrixClient: new MockBitrixClient(),
    googleOAuthService: {
      async readWorkspaceSnapshot({ userId }) {
        assert.equal(userId, "u-pm-1");
        return {
          source: "google",
          configured: true,
          connected: true,
          userId,
          calendar: {
            ok: true,
            data: {
              count: 1,
              events: [{ title: "Daily sync", start: "2026-06-04T10:00:00Z" }],
            },
          },
          gmail: { ok: true, data: { resultSizeEstimate: 0, messages: [] } },
          drive: { ok: true, data: { count: 0, files: [] } },
        };
      },
    },
    claudeClient,
    now: new Date("2026-06-04T10:00:00Z"),
    message: message({ text: "Как сегодня работала Бегайым?", telegramUserId: 999, chatId: 10 }),
  });

  assert.match(telegram.messages[0].text, /Бегайым сегодня активна/);
  assert.equal(state.tokenUsageEvents.length, 1);
  assert.equal(state.tokenUsageEvents[0].action, "telegram.assistant");
  assert.equal(state.tokenUsageEvents[0].totalTokens, 120);
  assert.equal(state.auditLog.at(-1).action, "telegram.assistant.ask");
  assert.equal(state.assistantMemory.filter((event) => event.kind === "assistant_question").length, 1);
  assert.equal(state.assistantMemory.filter((event) => event.kind === "assistant_answer").length, 1);
});

test("Telegram assistant searches shared Google calendars for schedule questions", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();
  const googleCalls = [];
  const claudeClient = {
    async complete({ user }) {
      assert.match(user, /sharedCalendars/u);
      assert.match(user, /Бегайым PM/u);
      assert.match(user, /2026-06-01\.\.2026-06-05/u);
      return {
        text: "График Бегайым найден в календаре Бегайым PM.",
        model: "claude-test-sonnet",
        configured: true,
        usage: {
          inputTokens: 120,
          outputTokens: 30,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      };
    },
  };

  await handleTelegramMessage({
    store,
    telegram,
    kickidlerClient: new MockKickidlerClient(),
    bitrixClient: new MockBitrixClient(),
    googleOAuthService: {
      async readWorkspaceSnapshot({ userId, period, limits }) {
        googleCalls.push({ userId, period, limits });
        return {
          source: "google",
          configured: true,
          connected: userId === "u-pm-1",
          userId,
          account: { email: userId === "u-pm-1" ? "starlabpm@gmail.com" : null, name: null },
          period,
          calendar: { ok: true, data: { count: 0, events: [] } },
          calendarList: { ok: true, data: { count: userId === "u-pm-1" ? 1 : 0, calendars: [] } },
          sharedCalendars: {
            ok: true,
            data: {
              searchTerms: limits.calendarSearchTerms,
              matchedCalendars: userId === "u-pm-1" ? 1 : 0,
              calendars: userId === "u-pm-1"
                ? [{
                    calendar: { name: "Бегайым PM" },
                    matchedTerms: ["Бегайым"],
                    events: {
                      count: 1,
                      events: [{
                        title: "Рабочий день",
                        start: "2026-06-02T10:00:00+06:00",
                        end: "2026-06-02T18:00:00+06:00",
                      }],
                    },
                  }]
                : [],
            },
          },
          gmail: { ok: true, data: { resultSizeEstimate: 0, messages: [] } },
          drive: { ok: true, data: { count: 0, files: [] } },
          documents: { ok: true, data: { count: 0, documents: [], sheets: [] } },
        };
      },
    },
    claudeClient,
    now: new Date("2026-06-05T08:00:00.000Z"),
    message: message({ text: "Покажи график Бегайым с 1 по 5 июня", telegramUserId: 999, chatId: 10 }),
  });

  const begayymCall = googleCalls.find((call) => call.userId === "u-pm-1");
  assert.ok(begayymCall);
  assert.equal(begayymCall.period.label, "2026-06-01..2026-06-05");
  assert.equal(begayymCall.period.from, "2026-05-31T18:00:00.000Z");
  assert.equal(begayymCall.period.to, "2026-06-05T17:59:59.999Z");
  assert.equal(begayymCall.limits.calendarSearchTerms.some((term) => term.includes("Бегайым")), true);
  assert.match(telegram.messages[0].text, /График Бегайым найден/);
});

test("Telegram assistant resolves Cyrillic Maksat mentions to Bitrix user tasks", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();
  const bitrixUserTaskCalls = [];
  const claudeClient = {
    async complete({ user }) {
      assert.match(user, /"id": "u-maksat"/u);
      assert.match(user, /"bitrixUserId": 1/u);
      assert.match(user, /Контроль проекта/u);
      assert.match(user, /bitrixUserTasks/u);
      return {
        text: "Максат найден, задачи Bitrix загружены по bitrixUserId.",
        model: "claude-test-sonnet",
        configured: true,
        usage: {
          inputTokens: 80,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      };
    },
  };
  const bitrixClient = {
    async getProjectTasks({ project }) {
      return {
        source: "bitrix",
        configured: true,
        projectId: project.id,
        tasks: [],
      };
    },
    async getUserTasks({ user }) {
      bitrixUserTaskCalls.push(user.id);
      return {
        source: "bitrix",
        configured: true,
        userId: user.id,
        bitrixUserId: user.bitrixUserId,
        tasks: [
          {
            id: "maksat-task-1",
            title: "Контроль проекта",
            status: 3,
            statusLabel: "in_progress",
            deadline: "2026-06-05T12:00:00.000Z",
          },
        ],
      };
    },
  };

  await handleTelegramMessage({
    store,
    telegram,
    kickidlerClient: new MockKickidlerClient(),
    bitrixClient,
    googleOAuthService: null,
    claudeClient,
    now: new Date("2026-06-05T08:00:00.000Z"),
    message: message({
      text: "Дай сводку максата за неделю с 1 по 5 июня и что у него по проектам в битриксе",
      telegramUserId: 999,
      chatId: 10,
    }),
  });

  assert.deepEqual(bitrixUserTaskCalls, ["u-maksat"]);
  assert.match(telegram.messages[0].text, /Максат найден/);
});

test("Telegram handler transcribes voice messages and can answer with voice", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();
  const voiceService = {
    canSynthesize: true,
    async transcribeTelegramVoice({ voice }) {
      assert.equal(voice.file_id, "VOICE_FILE_ID");
      return { text: "Как сегодня работала Бегайым? Ответь голосом" };
    },
    wantsVoiceReply(text) {
      return /голосом/u.test(text);
    },
    async synthesize(text) {
      assert.match(text, /Бегайым/u);
      return {
        bytes: Buffer.from([7, 8, 9]),
        filename: "reply.mp3",
        mimeType: "audio/mpeg",
      };
    },
  };
  const claudeClient = {
    async complete() {
      return {
        text: "Бегайым сегодня закрыла задачи и была активна.",
        model: "claude-test-sonnet",
        configured: true,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      };
    },
  };

  await handleTelegramMessage({
    store,
    telegram,
    kickidlerClient: new MockKickidlerClient(),
    bitrixClient: new MockBitrixClient(),
    googleOAuthService: null,
    claudeClient,
    voiceService,
    message: {
      voice: { file_id: "VOICE_FILE_ID", mime_type: "audio/ogg" },
      from: { id: 999, username: "owner" },
      chat: { id: 10 },
    },
  });

  assert.equal(telegram.voiceMessages.length, 1);
  assert.equal(telegram.messages.length, 1);
  assert.equal(Buffer.compare(telegram.voiceMessages[0].audioBytes, Buffer.from([7, 8, 9])), 0);
  assert.match(telegram.voiceMessages[0].caption, /Голосовой ответ/);
});

test("Telegram text command can request a voice report without treating voice as a user target", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();
  const voiceService = {
    canSynthesize: true,
    wantsVoiceReply(text) {
      return /голосом/u.test(text);
    },
    async synthesize(text) {
      assert.match(text, /план|Прогресс|Сегодня/iu);
      return {
        bytes: Buffer.from([1, 2, 3]),
        filename: "report.mp3",
        mimeType: "audio/mpeg",
      };
    },
  };

  await handleTelegramMessage({
    store,
    telegram,
    kickidlerClient: new MockKickidlerClient(),
    bitrixClient: new MockBitrixClient(),
    voiceService,
    now: new Date("2026-06-11T06:00:00.000Z"),
    message: message({ text: "/today голосом", telegramUserId: 999, chatId: 10 }),
  });

  assert.equal(telegram.messages.length, 1);
  assert.equal(telegram.voiceMessages.length, 1);
  assert.equal(telegram.voiceMessages[0].chatId, 10);
});

function createMemoryStore(state) {
  return {
    async load() {
      return state;
    },
    async update(mutator) {
      return await mutator(state);
    },
  };
}

function createFakeTelegram() {
  return {
    messages: [],
    voiceMessages: [],
    async sendMessage(messageToSend) {
      this.messages.push(messageToSend);
    },
    async sendVoice(messageToSend) {
      this.voiceMessages.push(messageToSend);
    },
  };
}

function message({ text, telegramUserId, chatId }) {
  return {
    text,
    from: { id: telegramUserId, username: `u${telegramUserId}` },
    chat: { id: chatId },
  };
}
