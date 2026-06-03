export function parseTelegramCommand(text) {
  if (typeof text !== "string") {
    return { name: "unknown", args: [], raw: "" };
  }

  const raw = text.trim();
  if (!raw.startsWith("/")) {
    return { name: "unknown", args: [], raw };
  }

  const [commandToken, ...args] = raw.split(/\s+/u);
  const command = commandToken.slice(1).split("@")[0].toLowerCase();
  return { name: command, args, raw };
}

export function resolveReportPeriod(kind, now = new Date()) {
  const normalized = (kind || "today").toLowerCase();
  if (normalized === "week") {
    const to = now;
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString(), label: "last 7 days" };
  }

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString(), label: "today" };
}
