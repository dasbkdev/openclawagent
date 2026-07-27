// Voice for SAI — ElevenLabs speech-to-text (microphone) and text-to-speech (spoken
// replies). Direct to the ElevenLabs API using a key kept in SAI settings, the same
// self-contained pattern as the direct-Anthropic provider. Empty key = voice disabled.

const EL = "https://api.elevenlabs.io/v1";

/** Transcribe a recorded audio blob to text (Scribe v1). */
export async function transcribe(blob: Blob, apiKey: string): Promise<string> {
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("file", blob, "speech.webm");
  const res = await fetch(`${EL}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Распознавание речи ${res.status}: ${detail.slice(0, 160)}`);
  }
  const json = await res.json();
  return String(json?.text ?? "").trim();
}

let playCtx: AudioContext | null = null;
let currentSrc: AudioBufferSourceNode | null = null;

/** Loudness multiplier for spoken replies (>1 = louder than source, for clarity). */
const PLAYBACK_GAIN = 2.4;

/** Stop any reply currently being spoken. */
export function stopSpeaking(): void {
  if (currentSrc) {
    try {
      currentSrc.stop();
    } catch {
      // already stopped
    }
    currentSrc = null;
  }
}

/**
 * Speak a reply aloud, loud and clear. Uses ElevenLabs speaker-boost for intelligibility and
 * a Web Audio gain stage to lift the volume above 100%. Resolves when playback ends (or is
 * interrupted), so the caller can track the "speaking" state.
 */
export async function speak(text: string, apiKey: string, voiceId: string): Promise<void> {
  const clean = text
    .replace(/```[\s\S]*?```/g, " код ")
    .replace(/`[^`]*`/g, "")
    .replace(/[#*_>|]/g, "")
    .replace(/\n{2,}/g, ". ")
    .trim();
  if (!clean) return;
  const res = await fetch(`${EL}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: clean.slice(0, 2500),
      model_id: "eleven_multilingual_v2",
      // Tuned for clarity + a strong, even voice; speaker boost lifts intelligibility.
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.9,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) throw new Error(`Озвучка ${res.status}`);
  const buf = await res.arrayBuffer();

  playCtx = playCtx ?? new AudioContext();
  if (playCtx.state === "suspended") await playCtx.resume().catch(() => {});
  const decoded = await playCtx.decodeAudioData(buf);
  stopSpeaking();
  const src = playCtx.createBufferSource();
  src.buffer = decoded;
  const gain = playCtx.createGain();
  gain.gain.value = PLAYBACK_GAIN;
  src.connect(gain).connect(playCtx.destination);
  currentSrc = src;
  await new Promise<void>((resolve) => {
    src.onended = () => {
      if (currentSrc === src) currentSrc = null;
      resolve();
    };
    src.start();
  });
}

// ---- Hands-free realtime voice: continuous listening with energy-based VAD ----

export type HandsFreeHandle = { stop: () => void };

type HandsFreeOpts = {
  // Called with the recorded clip when a speech segment ends (trailing silence).
  onSegment: (blob: Blob) => Promise<void> | void;
  // True while the assistant is busy — capture is paused so we don't record over ourselves.
  isBusy: () => boolean;
  // Fired the moment the user starts talking (used for barge-in: stop any spoken reply).
  onSpeechStart?: () => void;
  onState?: (s: "idle" | "listening" | "recording") => void;
};

const START_RMS = 0.06; // loudness above which a new speech segment begins (noise gate)
const KEEP_RMS = 0.04; // loudness that counts as "still talking" inside a segment
const SILENCE_MS = 850; // trailing quiet that ends a segment (snappier auto-send)
const MIN_SEGMENT_MS = 350; // shorter blips are ignored (coughs, clicks)

/** Start hands-free listening. Returns a handle whose stop() tears everything down. */
export async function startHandsFree(opts: HandsFreeOpts): Promise<HandsFreeHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  let stopped = false;
  let rec: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let segStart = 0;
  let lastVoice = 0;

  const rms = (): number => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  };

  const startSeg = () => {
    chunks = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.start();
    segStart = performance.now();
    lastVoice = segStart;
    opts.onState?.("recording");
    opts.onSpeechStart?.();
  };

  const endSeg = () => {
    if (!rec) return;
    const r = rec;
    rec = null;
    const dur = performance.now() - segStart;
    r.onstop = () => {
      opts.onState?.("listening");
      if (dur >= MIN_SEGMENT_MS) void opts.onSegment(new Blob(chunks, { type: "audio/webm" }));
    };
    r.stop();
  };

  const loop = window.setInterval(() => {
    if (stopped) return;
    const level = rms();
    if (rec) {
      if (level > KEEP_RMS) lastVoice = performance.now();
      if (performance.now() - lastVoice > SILENCE_MS) endSeg();
    } else if (!opts.isBusy() && level > START_RMS) {
      startSeg();
    } else {
      opts.onState?.(opts.isBusy() ? "idle" : "listening");
    }
  }, 100);

  return {
    stop: () => {
      stopped = true;
      window.clearInterval(loop);
      try {
        rec?.stop();
      } catch {
        // recorder may already be inactive
      }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
    },
  };
}

export type Recorder = { stop: () => Promise<Blob> };

/** Start recording from the default microphone; resolve to a handle whose stop() yields the clip. */
export async function recordOnce(): Promise<Recorder> {
  // Aggressive browser-side cleanup so background noise doesn't get transcribed.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const rec = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.start();
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: "audio/webm" }));
        };
        rec.stop();
      }),
  };
}
