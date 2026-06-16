const TELEGRAM_VOICE_MIME_TYPE = "audio/ogg";
const DEFAULT_ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
const VOICE_REQUEST_RE = /(голосом|голосовое|голосовым|войсом|voice|audio|аудио)/iu;

export function createVoiceServiceFromEnv(env = process.env) {
  const enabled = env.VOICE_ASSISTANT_ENABLED !== "false";
  const replyMode = env.VOICE_REPLY_MODE || "on_request";
  const sttProvider = (env.STT_PROVIDER || "elevenlabs").toLowerCase();
  const sttModel = env.STT_MODEL || (sttProvider === "openai" ? "gpt-4o-transcribe" : "scribe_v2");
  const sttLanguageCode = env.STT_LANGUAGE_CODE || "";
  const elevenLabsApiKey = env.ELEVENLABS_API_KEY || "";
  const sttApiKey = env.STT_API_KEY || "";
  const ttsClient = new ElevenLabsTtsClient({
    apiKey: elevenLabsApiKey,
    voiceId: env.ELEVENLABS_VOICE_ID || "",
    model: env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2",
    outputFormat: env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128",
    baseUrl: env.ELEVENLABS_BASE_URL || DEFAULT_ELEVENLABS_BASE_URL,
  });

  const sttClient =
    sttProvider === "openai"
      ? new OpenAiSttClient({
          apiKey: sttApiKey || env.OPENAI_API_KEY || "",
          model: sttModel,
          languageCode: sttLanguageCode,
          baseUrl: env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL,
        })
      : new ElevenLabsSttClient({
          apiKey: sttApiKey || elevenLabsApiKey,
          model: sttModel,
          languageCode: sttLanguageCode,
          baseUrl: env.ELEVENLABS_BASE_URL || DEFAULT_ELEVENLABS_BASE_URL,
        });

  return new VoiceService({ enabled, replyMode, sttClient, ttsClient });
}

export class VoiceService {
  constructor({ enabled = true, replyMode = "on_request", sttClient, ttsClient }) {
    this.enabled = enabled;
    this.replyMode = replyMode;
    this.sttClient = sttClient;
    this.ttsClient = ttsClient;
  }

  get canTranscribe() {
    return Boolean(this.enabled && this.sttClient?.configured);
  }

  get canSynthesize() {
    return Boolean(this.enabled && this.ttsClient?.configured);
  }

  wantsVoiceReply(text) {
    if (this.replyMode === "always_text") {
      return false;
    }
    if (this.replyMode === "always_voice") {
      return true;
    }
    return VOICE_REQUEST_RE.test(String(text || ""));
  }

  async transcribeTelegramVoice({ telegram, voice }) {
    if (!this.enabled) {
      throw new VoiceServiceError("Голосовой режим отключен в /setup.");
    }
    if (!this.sttClient?.configured) {
      throw new VoiceServiceError("STT не настроен. Укажи STT API Key или ElevenLabs API Key в /setup.");
    }

    const file = await telegram.getFile({ fileId: voice.file_id });
    const bytes = await telegram.downloadFile({ filePath: file.file_path });
    return await this.sttClient.transcribe({
      bytes,
      filename: "telegram-voice.ogg",
      mimeType: voice.mime_type || TELEGRAM_VOICE_MIME_TYPE,
    });
  }

  /**
   * Transcribe arbitrary audio/video bytes (e.g. a Telegram video). STT
   * providers (ElevenLabs Scribe, OpenAI transcribe) accept a video file and
   * use its audio track, so no local ffmpeg is needed.
   */
  async transcribeMedia({ bytes, filename = "media.mp4", mimeType = "video/mp4" }) {
    if (!this.enabled) {
      throw new VoiceServiceError("Голосовой режим отключен в /setup.");
    }
    if (!this.sttClient?.configured) {
      throw new VoiceServiceError("STT не настроен. Укажи STT API Key или ElevenLabs API Key в /setup.");
    }
    return await this.sttClient.transcribe({ bytes, filename, mimeType });
  }

  async synthesize(text) {
    if (!this.enabled) {
      throw new VoiceServiceError("Голосовой режим отключен в /setup.");
    }
    if (!this.ttsClient?.configured) {
      throw new VoiceServiceError("ElevenLabs TTS не настроен. Укажи ElevenLabs API Key и Voice ID в /setup.");
    }
    return await this.ttsClient.synthesize({ text });
  }
}

export class ElevenLabsSttClient {
  constructor({
    apiKey,
    model = "scribe_v2",
    languageCode = "",
    baseUrl = DEFAULT_ELEVENLABS_BASE_URL,
    timeoutMs = 60000,
  }) {
    this.apiKey = apiKey;
    this.model = model;
    this.languageCode = languageCode;
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    this.timeoutMs = timeoutMs;
    this.configured = Boolean(apiKey);
  }

  async transcribe({ bytes, filename = "voice.ogg", mimeType = TELEGRAM_VOICE_MIME_TYPE }) {
    const form = new FormData();
    form.append("model_id", this.model);
    if (this.languageCode) {
      form.append("language_code", this.languageCode);
    }
    form.append("file", new Blob([bytes], { type: mimeType }), filename);

    const payload = await postMultipartJson(`${this.baseUrl}/v1/speech-to-text`, form, {
      "xi-api-key": this.apiKey,
    }, this.timeoutMs);
    return {
      text: String(payload.text || "").trim(),
      provider: "elevenlabs",
      model: this.model,
      raw: payload,
    };
  }
}

export class OpenAiSttClient {
  constructor({
    apiKey,
    model = "gpt-4o-transcribe",
    languageCode = "",
    baseUrl = DEFAULT_OPENAI_BASE_URL,
    timeoutMs = 60000,
  }) {
    this.apiKey = apiKey;
    this.model = model;
    this.languageCode = languageCode;
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    this.timeoutMs = timeoutMs;
    this.configured = Boolean(apiKey);
  }

  async transcribe({ bytes, filename = "voice.ogg", mimeType = TELEGRAM_VOICE_MIME_TYPE }) {
    const form = new FormData();
    form.append("model", this.model);
    if (this.languageCode) {
      form.append("language", this.languageCode);
    }
    form.append("file", new Blob([bytes], { type: mimeType }), filename);

    const payload = await postMultipartJson(`${this.baseUrl}/v1/audio/transcriptions`, form, {
      Authorization: `Bearer ${this.apiKey}`,
    }, this.timeoutMs);
    return {
      text: String(payload.text || "").trim(),
      provider: "openai",
      model: this.model,
      raw: payload,
    };
  }
}

export class ElevenLabsTtsClient {
  constructor({
    apiKey,
    voiceId,
    model = "eleven_multilingual_v2",
    outputFormat = "mp3_44100_128",
    baseUrl = DEFAULT_ELEVENLABS_BASE_URL,
    timeoutMs = 60000,
  }) {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
    this.model = model;
    this.outputFormat = outputFormat;
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    this.timeoutMs = timeoutMs;
    this.configured = Boolean(apiKey && voiceId);
  }

  async synthesize({ text }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(
        `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(this.voiceId)}?output_format=${encodeURIComponent(this.outputFormat)}`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Accept: readAcceptMimeType(this.outputFormat),
            "xi-api-key": this.apiKey,
          },
          body: JSON.stringify({
            text: String(text || "").slice(0, 4000),
            model_id: this.model,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new VoiceServiceError(`ElevenLabs TTS failed: HTTP ${response.status} ${errorText.slice(0, 300)}`);
      }

      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        mimeType: readAcceptMimeType(this.outputFormat),
        filename: readAudioFilename(this.outputFormat),
        provider: "elevenlabs",
        model: this.model,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class VoiceServiceError extends Error {
  constructor(message) {
    super(message);
    this.name = "VoiceServiceError";
  }
}

async function postMultipartJson(url, form, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: form,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new VoiceServiceError(`STT request failed: HTTP ${response.status} ${text.slice(0, 300)}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function readAcceptMimeType(outputFormat) {
  const value = String(outputFormat || "");
  if (value.startsWith("opus")) {
    return "audio/ogg";
  }
  if (value.startsWith("pcm")) {
    return "audio/wav";
  }
  return "audio/mpeg";
}

function readAudioFilename(outputFormat) {
  const mimeType = readAcceptMimeType(outputFormat);
  if (mimeType === "audio/ogg") {
    return "assistant-reply.ogg";
  }
  if (mimeType === "audio/wav") {
    return "assistant-reply.wav";
  }
  return "assistant-reply.mp3";
}
