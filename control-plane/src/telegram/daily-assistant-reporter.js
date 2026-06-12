import {
  buildDailyManagerReport,
  formatManagerReport,
  isManagerReportDue,
  markManagerReportSent,
} from "../domain/daily-assistant.js";
import { collectDueScheduledAssistantMessages } from "../domain/work-schedule.js";

export async function sendDueDailyAssistantMessages({
  store,
  telegram,
  kickidlerClient,
  bitrixClient,
  platrumClient,
  googleOAuthService,
  now = new Date(),
  enabled = process.env.DAILY_ASSISTANT_AUTOMATION_ENABLED !== "false",
}) {
  if (!enabled) {
    return { sent: 0, skipped: "disabled" };
  }

  let sent = 0;
  const prompts = await store.update((state) =>
    collectDueScheduledAssistantMessages(state, {
      now,
      platrumClient,
      googleOAuthService,
      developerTelegramId: process.env.DEVELOPER_TELEGRAM_IDS || "984834133",
    }),
  );
  for (const prompt of prompts) {
    await telegram.sendMessage(prompt);
    sent += 1;
  }

  const managerMessages = await store.update(async (state) => {
    const dueManagers = state.users.filter((user) => isManagerReportDue(state, user, { now }));
    const messages = [];
    for (const manager of dueManagers) {
      const report = await buildDailyManagerReport(state, {
        actor: manager,
        now,
        kickidlerClient,
        bitrixClient,
        platrumClient,
      });
      markManagerReportSent(report, now);
      messages.push({
        chatId: manager.telegram.telegramUserId,
        text: formatManagerReport(report),
      });
    }
    return messages;
  });

  for (const message of managerMessages) {
    await telegram.sendMessage(message);
    sent += 1;
  }

  return { sent };
}
