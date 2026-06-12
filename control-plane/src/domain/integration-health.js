const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Builds a snapshot of integration health for Claude, Telegram, Metricon,
 * Platrum, Bitrix, voice and Google. Every check runs in parallel with its
 * own timeout, and a failing/timed-out check never throws - it is reported
 * as { ok: false, message }. No secrets are ever included in the output.
 */
export async function buildIntegrationsHealth({
  claudeClient,
  telegramApi,
  kickidlerClient,
  platrumClient,
  bitrixClient,
  voiceService,
  googleOAuthService,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => new Date(),
} = {}) {
  const [claude, telegram, metricon, platrum, bitrix, voice, google] = await Promise.all([
    checkClaude(claudeClient, timeoutMs),
    checkTelegram(telegramApi, timeoutMs),
    checkMetricon(kickidlerClient, timeoutMs),
    checkPlatrum(platrumClient, timeoutMs),
    checkBitrix(bitrixClient, timeoutMs),
    checkVoice(voiceService, timeoutMs),
    checkGoogle(googleOAuthService, timeoutMs),
  ]);

  return {
    checkedAt: now().toISOString(),
    integrations: { claude, telegram, metricon, platrum, bitrix, voice, google },
  };
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function notConfigured(message) {
  return { ok: false, configured: false, message };
}

function failureFromError(error, fallback) {
  return {
    ok: false,
    configured: true,
    message: error instanceof Error ? error.message : (fallback || String(error)),
  };
}

async function checkClaude(claudeClient, timeoutMs) {
  if (!claudeClient) {
    return notConfigured("Claude client is not enabled on this server");
  }
  if (!claudeClient.configured) {
    return notConfigured("Claude API key is not configured");
  }
  if (typeof claudeClient.healthCheck !== "function") {
    return failureFromError(null, "Claude client does not support healthCheck");
  }
  try {
    const result = await withTimeout(claudeClient.healthCheck(), timeoutMs, "Claude health check");
    return {
      ok: Boolean(result?.ok),
      configured: Boolean(result?.configured ?? claudeClient.configured),
      message: result?.message || (result?.ok ? "Claude API is available" : "Claude API is unavailable"),
    };
  } catch (error) {
    return failureFromError(error, "Claude health check failed");
  }
}

async function checkTelegram(telegramApi, timeoutMs) {
  if (!telegramApi) {
    return notConfigured("Telegram API is not enabled on this server");
  }
  try {
    const me = await withTimeout(telegramApi.getMe(), timeoutMs, "Telegram getMe");
    const username = me?.username ? `@${me.username}` : (me?.id ? `id ${me.id}` : "bot");
    return {
      ok: true,
      configured: true,
      message: `Telegram bot ${username} is reachable`,
    };
  } catch (error) {
    return failureFromError(error, "Telegram getMe failed");
  }
}

async function checkMetricon(kickidlerClient, timeoutMs) {
  if (!kickidlerClient) {
    return notConfigured("Metricon client is not enabled on this server");
  }
  if (!kickidlerClient.configured) {
    return notConfigured("Metricon is not configured (mock connector)");
  }
  // No cheap read-only endpoint is exposed by the Metricon client; report
  // configuration status only, without making a heavy activity request.
  void timeoutMs;
  return {
    ok: true,
    configured: true,
    message: `Metricon connector configured (source: ${kickidlerClient.source || "metricon"})`,
  };
}

async function checkPlatrum(platrumClient, timeoutMs) {
  if (!platrumClient) {
    return notConfigured("Platrum client is not enabled on this server");
  }
  if (!platrumClient.configured) {
    return notConfigured("Platrum is not configured (mock connector)");
  }
  if (typeof platrumClient.getMe !== "function") {
    return {
      ok: true,
      configured: true,
      message: `Platrum connector configured (source: ${platrumClient.source || "platrum"})`,
    };
  }
  try {
    await withTimeout(platrumClient.getMe(), timeoutMs, "Platrum getMe");
    return {
      ok: true,
      configured: true,
      message: "Platrum API is reachable",
    };
  } catch (error) {
    return failureFromError(error, "Platrum getMe failed");
  }
}

async function checkBitrix(bitrixClient, timeoutMs) {
  if (!bitrixClient) {
    return notConfigured("Bitrix client is not enabled on this server");
  }
  if (!bitrixClient.configured) {
    return notConfigured("Bitrix is not configured (mock connector)");
  }
  if (typeof bitrixClient.callMethod !== "function") {
    return {
      ok: true,
      configured: true,
      message: `Bitrix connector configured (source: ${bitrixClient.source || "bitrix"})`,
    };
  }
  try {
    await withTimeout(bitrixClient.callMethod("profile", {}), timeoutMs, "Bitrix profile");
    return {
      ok: true,
      configured: true,
      message: "Bitrix API is reachable",
    };
  } catch (error) {
    return failureFromError(error, "Bitrix profile request failed");
  }
}

async function checkVoice(voiceService, timeoutMs) {
  void timeoutMs;
  if (!voiceService) {
    return notConfigured("Voice service is not enabled on this server");
  }
  if (!voiceService.enabled) {
    return notConfigured("Voice service is disabled");
  }
  const canSynthesize = Boolean(voiceService.canSynthesize);
  const canTranscribe = Boolean(voiceService.canTranscribe);
  if (!canSynthesize && !canTranscribe) {
    return notConfigured("Voice service is enabled but no STT/TTS provider is configured");
  }
  return {
    ok: true,
    configured: true,
    message: `Voice service ready (synthesize: ${canSynthesize ? "yes" : "no"}, transcribe: ${canTranscribe ? "yes" : "no"})`,
  };
}

async function checkGoogle(googleOAuthService, timeoutMs) {
  if (!googleOAuthService) {
    return notConfigured("Google OAuth service is not enabled on this server");
  }
  if (typeof googleOAuthService.readClientConfig !== "function") {
    return notConfigured("Google OAuth client configuration is not available");
  }
  try {
    await withTimeout(googleOAuthService.readClientConfig(), timeoutMs, "Google OAuth client config");
    return {
      ok: true,
      configured: true,
      message: "Google OAuth client is configured",
    };
  } catch (error) {
    return notConfigured(error instanceof Error ? error.message : "Google OAuth client is not configured");
  }
}
