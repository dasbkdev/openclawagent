import {
  buildTokenUsageSummary,
  ensureTokenUsageState,
  formatTokenUsageSummary,
  isTokenUsageReportDue,
  resolveTokenUsagePeriod,
} from "../domain/token-usage.js";

const REPORT_PERIODS = ["day", "week", "month"];

export async function sendDueTokenUsageReports({
  store,
  telegram,
  recipientTelegramId = process.env.TOKEN_USAGE_REPORT_TELEGRAM_ID || "984834133",
  now = new Date(),
} = {}) {
  const sent = await store.update(async (state) => {
    ensureTokenUsageState(state, { TOKEN_USAGE_REPORT_TELEGRAM_ID: recipientTelegramId }, now);
    const schedule = state.tokenReportSchedule;
    const reports = [];

    for (const periodName of REPORT_PERIODS) {
      const period = resolveTokenUsagePeriod(periodName, now);
      if (!isTokenUsageReportDue(schedule[period.key], period, now, schedule.startedAt)) {
        continue;
      }

      const summary = buildTokenUsageSummary(state, period);
      const text = formatTokenUsageSummary(summary, { label: period.label });
      await telegram.sendMessage({
        chatId: schedule.recipientTelegramId,
        text,
      });
      schedule[period.key].lastSentAt = now.toISOString();
      reports.push({ key: period.key, recipientTelegramId: schedule.recipientTelegramId });
    }

    return reports;
  });

  return sent;
}

export async function sendTokenUsageReportNow({
  store,
  telegram,
  chatId,
  periodName = "day",
  now = new Date(),
}) {
  const state = await store.load();
  ensureTokenUsageState(state, process.env, now);
  const period = resolveTokenUsagePeriod(periodName, now);
  const summary = buildTokenUsageSummary(state, period);
  await telegram.sendMessage({
    chatId,
    text: formatTokenUsageSummary(summary, { label: period.label }),
  });
  return summary;
}
