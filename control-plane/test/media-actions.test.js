import test from "node:test";
import assert from "node:assert/strict";
import {
  extractIncomingMedia,
  forwardMethodFor,
  isAnalyzableByVision,
  isTranscribable,
} from "../src/domain/media-actions.js";

test("extractIncomingMedia: photo -> largest image", () => {
  const m = extractIncomingMedia({ photo: [{ file_id: "small", file_size: 100 }, { file_id: "big", file_size: 9000 }] });
  assert.equal(m.kind, "image");
  assert.equal(m.fileId, "big");
  assert.equal(forwardMethodFor(m), "sendPhoto");
  assert.ok(isAnalyzableByVision(m));
});

test("extractIncomingMedia: pdf document", () => {
  const m = extractIncomingMedia({ document: { file_id: "d1", mime_type: "application/pdf", file_name: "report.pdf", file_size: 2048 } });
  assert.equal(m.kind, "pdf");
  assert.equal(forwardMethodFor(m), "sendDocument");
  assert.ok(isAnalyzableByVision(m));
});

test("extractIncomingMedia: image sent as a document is still an image", () => {
  const m = extractIncomingMedia({ document: { file_id: "d2", mime_type: "image/png", file_name: "shot.png" } });
  assert.equal(m.kind, "image");
  // sent as document, so forwarded as a document (keeps quality)
  assert.equal(forwardMethodFor(m), "sendDocument");
});

test("extractIncomingMedia: video and audio are transcribable", () => {
  const v = extractIncomingMedia({ video: { file_id: "v1", mime_type: "video/mp4", duration: 30 } });
  assert.equal(v.kind, "video");
  assert.equal(forwardMethodFor(v), "sendVideo");
  assert.ok(isTranscribable(v));

  const a = extractIncomingMedia({ audio: { file_id: "a1", mime_type: "audio/mpeg", duration: 12 } });
  assert.equal(a.kind, "audio");
  assert.ok(isTranscribable(a));
});

test("extractIncomingMedia: other document is forward-only", () => {
  const m = extractIncomingMedia({ document: { file_id: "d3", mime_type: "application/zip", file_name: "x.zip" } });
  assert.equal(m.kind, "document");
  assert.equal(isAnalyzableByVision(m), false);
  assert.equal(isTranscribable(m), false);
});

test("extractIncomingMedia: no media -> null", () => {
  assert.equal(extractIncomingMedia({ text: "hello" }), null);
  assert.equal(extractIncomingMedia(null), null);
});
