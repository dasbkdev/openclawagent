import crypto from "node:crypto";

export function appendAuditEvent(state, event) {
  const entry = {
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    actorUserId: event.actorUserId ?? null,
    actorTelegramUserId: event.actorTelegramUserId ?? null,
    action: event.action,
    target: event.target ?? null,
    decision: event.decision ?? "ALLOW",
    metadata: event.metadata ?? {},
  };

  state.auditLog.push(entry);
  return entry;
}
