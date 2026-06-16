/**
 * Classify an incoming Telegram media message (photo / document / video /
 * audio) into a normalized descriptor. Pure: the handler does the download,
 * forwarding and analysis. Voice messages are handled by the voice pipeline,
 * not here.
 */

// Telegram bot getFile/download is limited to 20 MB.
export const TELEGRAM_DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

export function extractIncomingMedia(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    // Photos come in several sizes; the last is the largest.
    const largest = message.photo[message.photo.length - 1];
    return {
      kind: "image",
      telegramType: "photo",
      fileId: largest.file_id,
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
      fileSize: Number(largest.file_size || 0),
      durationSec: 0,
    };
  }

  if (message.document) {
    const doc = message.document;
    const mime = String(doc.mime_type || "").toLowerCase();
    let kind = "document";
    if (mime.startsWith("image/")) {
      kind = "image";
    } else if (mime === "application/pdf" || String(doc.file_name || "").toLowerCase().endsWith(".pdf")) {
      kind = "pdf";
    }
    return {
      kind,
      telegramType: "document",
      fileId: doc.file_id,
      mimeType: doc.mime_type || (kind === "pdf" ? "application/pdf" : "application/octet-stream"),
      fileName: doc.file_name || "file",
      fileSize: Number(doc.file_size || 0),
      durationSec: 0,
    };
  }

  if (message.video || message.video_note || message.animation) {
    const v = message.video || message.video_note || message.animation;
    return {
      kind: "video",
      telegramType: message.video ? "video" : message.video_note ? "video_note" : "animation",
      fileId: v.file_id,
      mimeType: v.mime_type || "video/mp4",
      fileName: v.file_name || "video.mp4",
      fileSize: Number(v.file_size || 0),
      durationSec: Number(v.duration || 0),
    };
  }

  if (message.audio) {
    const a = message.audio;
    return {
      kind: "audio",
      telegramType: "audio",
      fileId: a.file_id,
      mimeType: a.mime_type || "audio/mpeg",
      fileName: a.file_name || "audio.mp3",
      fileSize: Number(a.file_size || 0),
      durationSec: Number(a.duration || 0),
    };
  }

  return null;
}

// Which Telegram send method re-sends this media kind by file_id.
export function forwardMethodFor(media) {
  if (!media) {
    return "sendDocument";
  }
  if (media.kind === "image" && media.telegramType === "photo") {
    return "sendPhoto";
  }
  if (media.kind === "video") {
    return "sendVideo";
  }
  // images sent as a file, pdfs and other documents keep their file form
  return "sendDocument";
}

export function isAnalyzableByVision(media) {
  return media?.kind === "image" || media?.kind === "pdf";
}

export function isTranscribable(media) {
  return media?.kind === "video" || media?.kind === "audio";
}
