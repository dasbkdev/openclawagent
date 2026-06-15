/**
 * Task lifecycle diffing → timeline events.
 *
 * Connectors (Platrum/Bitrix) return a user's current tasks on every read.
 * To capture "what did X create / get assigned / complete" we diff each
 * fresh task list against a small per-user snapshot kept in
 * `state.taskSyncState` and emit timeline events for changes.
 *
 * This is a PURE function: it mutates `state.taskSyncState` and RETURNS the
 * timeline events to append. The caller writes them via appendTimelineEvent
 * AFTER store.update returns, so no file I/O happens under the state lock
 * (same pattern as drainEvictedMemoryEvents).
 */
export function syncTasksToTimeline(state, { userId, tasks, source = "platrum", now = new Date() }) {
  if (!userId || !Array.isArray(tasks)) {
    return [];
  }
  ensureTaskSyncState(state);
  const snapshot = state.taskSyncState[userId] || (state.taskSyncState[userId] = {});
  const nowIso = now.toISOString();
  const events = [];

  for (const task of tasks) {
    const taskId = String(task.id ?? task.taskId ?? "").trim();
    if (!taskId) {
      continue;
    }
    const status = normalizeStatus(task.statusLabel ?? task.status);
    const title = String(task.title ?? "Задача").slice(0, 200);
    const projectId = task.projectId ? String(task.projectId) : null;
    const assigneeKey = task.assigneeId ?? task.assigneeUsername ?? task.responsibleId ?? null;
    const prev = snapshot[taskId];
    const links = {
      taskIds: [taskId],
      projectIds: projectId ? [projectId] : [],
      userIds: [userId],
    };

    if (!prev) {
      // First time we see this task assigned to/visible for this user.
      events.push(makeEvent(userId, {
        kind: "task_created",
        title,
        detail: `Задача «${title}» (${status})`,
        links,
        source,
        nowIso,
        metadata: { taskId, status, projectId },
      }));
    } else if (prev.status !== status) {
      const completed = status === "completed";
      events.push(makeEvent(userId, {
        kind: completed ? "task_completed" : "task_status_change",
        title: completed ? `Завершила: ${title}` : `${title}: ${prev.status} → ${status}`,
        detail: `Задача «${title}» сменила статус ${prev.status} → ${status}`,
        links,
        source,
        nowIso,
        metadata: { taskId, from: prev.status, to: status, projectId },
      }));
    }

    snapshot[taskId] = { status, assignee: assigneeKey ? String(assigneeKey) : null, ts: nowIso, title };
  }

  pruneSnapshot(snapshot);
  return events;
}

function ensureTaskSyncState(state) {
  if (!state.taskSyncState || typeof state.taskSyncState !== "object") {
    state.taskSyncState = {};
  }
  return state.taskSyncState;
}

function makeEvent(userId, { kind, title, detail, links, source, nowIso, metadata }) {
  return {
    userId,
    event: { ts: nowIso, kind, actorUserId: userId, title, detail, links, source, metadata },
  };
}

function normalizeStatus(value) {
  const v = String(value ?? "unknown").toLowerCase().trim();
  return v || "unknown";
}

const MAX_SNAPSHOT_TASKS = 1000;

function pruneSnapshot(snapshot) {
  const ids = Object.keys(snapshot);
  if (ids.length <= MAX_SNAPSHOT_TASKS) {
    return;
  }
  ids
    .sort((a, b) => String(snapshot[a].ts || "").localeCompare(String(snapshot[b].ts || "")))
    .slice(0, ids.length - MAX_SNAPSHOT_TASKS)
    .forEach((id) => delete snapshot[id]);
}
