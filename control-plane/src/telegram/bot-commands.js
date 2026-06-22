export const TELEGRAM_BOT_COMMANDS = Object.freeze([
  { command: "help", description: "список основных команд" },
  { command: "invite", description: "создать код сотруднику" },
  { command: "reset_code", description: "перевыпустить код сотруднику" },
  { command: "users", description: "доступные сотрудники" },
  { command: "agents", description: "агенты устройств сотрудников" },
  { command: "device", description: "команда локальному OpenClaw" },
  { command: "task", description: "поручить агенту многошаговую задачу на ПК" },
  { command: "projects", description: "доступные проекты" },
  { command: "today", description: "мой план и прогресс" },
  { command: "plan", description: "задать план дня" },
  { command: "progress", description: "прогресс сотрудника" },
  { command: "blocker", description: "записать проблему" },
  { command: "done", description: "отметить пункт плана" },
  { command: "daily_report", description: "дневной отчет команды" },
  { command: "week_report", description: "недельный отчёт команды" },
  { command: "platrum", description: "задачи и канбан Platrum" },
  { command: "bitrix", description: "старый алиас для Platrum" },
  { command: "report", description: "отчет активности трекера" },
  { command: "google_connect", description: "подключить Google аккаунт" },
  { command: "google_status", description: "статус Google подключения" },
  { command: "tokens", description: "расход токенов" },
  { command: "ai_status", description: "проверка Claude API" },
  { command: "status", description: "статус интеграций (только владелец)" },
]);

export function formatCommandMenuHelp(commands = TELEGRAM_BOT_COMMANDS) {
  return commands.map(({ command, description }) => `/${command} - ${description}`).join("\n");
}
