import { userTokenMatchesValue } from "../connectors/platrum-client.js";
import { appendAuditEvent } from "../infra/audit.js";

/**
 * Auto-resolve external system IDs (Platrum, Bitrix, Metricon) for a
 * control-plane user through the company-wide service accounts, then
 * persist discovered mappings into state.
 *
 * Resolution is conservative: a mapping is only written when the
 * directory search produced exactly one unambiguous match. Existing
 * mappings are never overwritten.
 *
 * Network lookups run BEFORE `store.update` so the state file lock is
 * not held during external API calls.
 */
export async function autoResolveUserMappings({
  store,
  userId,
  platrumClient,
  bitrixClient,
  kickidlerClient,
  now = new Date(),
}) {
  const state = await store.load();
  const user = (state.users || []).find((item) => item.id === userId);
  if (!user) {
    return { userId, updated: {} };
  }

  const discovered = {};

  if (!user.platrumUserId && platrumClient?.resolvePlatrumUser) {
    try {
      const match = await platrumClient.resolvePlatrumUser(user);
      if (match?.id) {
        discovered.platrumUserId = Number(match.id);
        discovered.platrumUsername = match.username ?? null;
      }
    } catch {
      // Best-effort: connector unavailable must not break the caller.
    }
  }

  if (!user.bitrixUserId && bitrixClient?.resolveBitrixUser) {
    try {
      const match = await bitrixClient.resolveBitrixUser(user);
      if (match?.id && match.resolvedByName) {
        discovered.bitrixUserId = Number(match.id);
      }
    } catch {
      // Best-effort.
    }
  }

  if (!user.kickidlerEmployeeId && kickidlerClient?.listEmployees) {
    try {
      const employees = await kickidlerClient.listEmployees();
      const match = matchMetriconEmployee(user, employees);
      if (match) {
        discovered.kickidlerEmployeeId = Number(match.id);
      }
    } catch {
      // Best-effort.
    }
  }

  if (Object.keys(discovered).length === 0) {
    return { userId, updated: {} };
  }

  await store.update((currentState) => {
    const currentUser = (currentState.users || []).find((item) => item.id === userId);
    if (!currentUser) {
      return;
    }
    const applied = {};
    for (const [key, value] of Object.entries(discovered)) {
      if (currentUser[key] === null || currentUser[key] === undefined) {
        currentUser[key] = value;
        applied[key] = value;
      }
    }
    if (Object.keys(applied).length > 0) {
      appendAuditEvent(currentState, {
        actorUserId: userId,
        actorTelegramUserId: currentUser.telegram?.telegramUserId ?? null,
        action: "user.mapping.autoresolved",
        target: { userId },
        metadata: { ...applied, resolvedAt: now.toISOString() },
      });
    }
  });

  return { userId, updated: discovered };
}

export function matchMetriconEmployee(user, employees) {
  const tokens = buildNameTokens(user);
  if (tokens.length === 0) {
    return null;
  }
  const matches = (employees || []).filter((employee) => {
    if (!employee?.id || !employee?.name) {
      return false;
    }
    return tokens.some((token) => userTokenMatchesValue(token, employee.name));
  });
  return matches.length === 1 ? matches[0] : null;
}

function buildNameTokens(user) {
  const telegramFullName = [user?.telegram?.firstName, user?.telegram?.lastName]
    .filter(Boolean)
    .join(" ");
  return [
    user?.displayName,
    telegramFullName,
    user?.telegram?.firstName,
  ]
    .map((value) => String(value || "").toLowerCase().replace(/ё/gu, "е").trim())
    .filter((value) => value.length >= 3 && !/^(project manager|pm)\s*\d+$/u.test(value));
}
