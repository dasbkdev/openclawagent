import assert from "node:assert/strict";
import test from "node:test";
import { processTelegramUpdate } from "../src/telegram/handler.js";
import {
  escapeHtml,
  markdownToTelegramHtml,
  renderBlocks,
  sendLongMessage,
  splitTelegramMessage,
} from "../src/telegram/render.js";

test("escapeHtml escapes ampersand, less-than and greater-than", () => {
  assert.equal(escapeHtml("<b>a & b</b>"), "&lt;b&gt;a &amp; b&lt;/b&gt;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("renderBlocks renders title, section, kv, list, divider and text blocks", () => {
  const html = renderBlocks([
    { type: "title", text: "Отчёт", emoji: "📊" },
    { type: "section", heading: "Коротко", lines: ["Все хорошо", "5 < 10 задач"] },
    { type: "kv", label: "Сотрудник", value: "Бегайым" },
    { type: "list", items: ["Проверить отчёт", "Написать PM"] },
    { type: "divider" },
    { type: "text", text: "Просто текст" },
  ]);

  assert.match(html, /^<b>📊 Отчёт<\/b>/u);
  assert.match(html, /<b>Коротко<\/b>\nВсе хорошо\n5 &lt; 10 задач/u);
  assert.match(html, /<b>Сотрудник:<\/b> Бегайым/u);
  assert.match(html, /• Проверить отчёт/u);
  assert.match(html, /• Написать PM/u);
  assert.match(html, /―――――/u);
  assert.match(html, /Просто текст/u);
});

test("renderBlocks ignores unknown block types and empty blocks", () => {
  const html = renderBlocks([
    { type: "title", text: "X" },
    { type: "unknown", text: "should be skipped" },
    null,
    { type: "section", heading: "", lines: [] },
  ]);
  assert.equal(html, "<b>X</b>");
});

test("renderBlocks returns empty string for non-array input", () => {
  assert.equal(renderBlocks(null), "");
  assert.equal(renderBlocks(undefined), "");
});

test("markdownToTelegramHtml converts bold, italic, code and headings", () => {
  assert.equal(markdownToTelegramHtml("**bold**"), "<b>bold</b>");
  assert.equal(markdownToTelegramHtml("*italic*"), "<i>italic</i>");
  assert.equal(markdownToTelegramHtml("_italic_"), "<i>italic</i>");
  assert.equal(markdownToTelegramHtml("`code`"), "<code>code</code>");
  assert.equal(markdownToTelegramHtml("### Заголовок"), "<b>Заголовок</b>");
  assert.equal(markdownToTelegramHtml("## Заголовок"), "<b>Заголовок</b>");
  assert.equal(markdownToTelegramHtml("# Заголовок"), "<b>Заголовок</b>");
});

test("markdownToTelegramHtml converts list markers to bullet points", () => {
  assert.equal(markdownToTelegramHtml("- первое\n- второе"), "• первое\n• второе");
  assert.equal(markdownToTelegramHtml("* первое\n* второе"), "• первое\n• второе");
  assert.equal(markdownToTelegramHtml("1. первое\n2. второе"), "• первое\n• второе");
});

test("markdownToTelegramHtml converts fenced code blocks to <pre>", () => {
  const html = markdownToTelegramHtml("До\n```\nconst x = 1;\n```\nПосле");
  assert.match(html, /<pre>const x = 1;\n<\/pre>/u);
  assert.match(html, /^До\n/u);
  assert.match(html, /\nПосле$/u);
});

test("markdownToTelegramHtml converts markdown links with http/https only", () => {
  assert.equal(
    markdownToTelegramHtml("[Сайт](https://example.com)"),
    '<a href="https://example.com">Сайт</a>',
  );
  // Non-http(s) scheme is not converted to a link; left as escaped text.
  const html = markdownToTelegramHtml("[Файл](file:///etc/passwd)");
  assert.doesNotMatch(html, /<a /u);
  assert.match(html, /\[Файл\]\(file:\/\/\/etc\/passwd\)/u);
});

test("markdownToTelegramHtml escapes plain text and HTML-special characters", () => {
  assert.equal(markdownToTelegramHtml("5 < 10 & 20 > 1"), "5 &lt; 10 &amp; 20 &gt; 1");
});

test("markdownToTelegramHtml produces well-formed HTML for unbalanced/truncated markdown", () => {
  // Unterminated bold marker: no closing "**" found, so the asterisks
  // are treated as literal text rather than opening a <b> tag that is
  // never closed.
  const bold = markdownToTelegramHtml("**bold text without closing");
  assertBalancedTags(bold);
  assert.doesNotMatch(bold, /<b>/u);
  assert.match(bold, /bold text without closing/u);

  // Unterminated fenced code block: still wrapped in <pre>, balanced.
  const fenced = markdownToTelegramHtml("До\n```\nconst x = 1;\nбез закрытия");
  assertBalancedTags(fenced);

  // Mixed unterminated italic and bold: no closing markers, treated as text.
  const mixed = markdownToTelegramHtml("**bold *and italic without closing");
  assertBalancedTags(mixed);
});

test("markdownToTelegramHtml closes a dangling tag produced by a real conversion", () => {
  // **bold** followed by an unterminated *italic that never closes.
  const html = markdownToTelegramHtml("**done** and *open italic");
  assertBalancedTags(html);
  assert.match(html, /<b>done<\/b>/u);
});

test("splitTelegramMessage returns single part when within limit", () => {
  const parts = splitTelegramMessage("short text", 4096);
  assert.deepEqual(parts, ["short text"]);
});

test("splitTelegramMessage returns a single empty part for empty input", () => {
  assert.deepEqual(splitTelegramMessage("", 4096), [""]);
});

test("splitTelegramMessage splits long text on paragraph boundaries", () => {
  const paragraphA = "A".repeat(30);
  const paragraphB = "B".repeat(30);
  const text = `${paragraphA}\n\n${paragraphB}`;
  const parts = splitTelegramMessage(text, 35);
  assert.equal(parts.length, 2);
  assert.equal(parts[0], paragraphA);
  assert.equal(parts[1], paragraphB);
});

test("splitTelegramMessage splits long text on line boundaries when no paragraph break fits", () => {
  const lineA = "A".repeat(20);
  const lineB = "B".repeat(20);
  const text = `${lineA}\n${lineB}`;
  const parts = splitTelegramMessage(text, 25);
  assert.equal(parts.length, 2);
  assert.equal(parts[0], lineA);
  assert.equal(parts[1], lineB);
});

test("splitTelegramMessage hard-splits a single very long line and respects the limit", () => {
  const text = "X".repeat(10000);
  const parts = splitTelegramMessage(text, 4096);
  assert.ok(parts.length >= 3);
  for (const part of parts) {
    assert.ok(part.length <= 4096);
  }
  assert.equal(parts.join(""), text);
});

test("splitTelegramMessage does not break an HTML tag across parts", () => {
  // Build text where a <b>...</b> span crosses the natural split point.
  const filler = "x".repeat(20);
  const text = `${filler}\n\n<b>${"y".repeat(20)}</b>\n\nz`;
  const parts = splitTelegramMessage(text, 25);
  for (const part of parts) {
    assertBalancedTags(part);
  }
  // The bold content should still be present (possibly reopened) across parts.
  assert.match(parts.join(""), /y{20}/u);
});

test("sendLongMessage sends each split part through telegram.sendMessage", async () => {
  const sent = [];
  const telegram = {
    async sendMessage({ chatId, text }) {
      sent.push({ chatId, text });
      return { ok: true };
    },
  };
  const text = `${"A".repeat(30)}\n\n${"B".repeat(30)}`;
  await sendLongMessage({ telegram, chatId: 42, text, limit: 35 });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].chatId, 42);
  assert.equal(sent[1].chatId, 42);
  assert.equal(sent[0].text, "A".repeat(30));
  assert.equal(sent[1].text, "B".repeat(30));
});

test("sendLongMessage sends a single message for short text", async () => {
  const sent = [];
  const telegram = {
    async sendMessage(payload) {
      sent.push(payload);
      return { ok: true };
    },
  };
  await sendLongMessage({ telegram, chatId: 7, text: "hello" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "hello");
});

test("processTelegramUpdate isolates a failing update and notifies the chat", async () => {
  const sent = [];
  const telegram = {
    async sendMessage(payload) {
      sent.push(payload);
      return { ok: true };
    },
  };
  const store = {};

  await processTelegramUpdate({
    update: {
      update_id: 123,
      message: {
        text: "/help",
        from: { id: 1, username: "u1" },
        chat: { id: 10 },
      },
    },
    store,
    telegram,
    googleOAuthService: undefined,
    buildMessageDeps: async () => {
      throw new Error("boom");
    },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, 10);
  assert.match(sent[0].text, /Не получилось обработать сообщение/u);
});

test("processTelegramUpdate ignores updates without a message", async () => {
  const sent = [];
  const telegram = {
    async sendMessage(payload) {
      sent.push(payload);
    },
  };
  await processTelegramUpdate({
    update: { update_id: 1 },
    store: {},
    telegram,
    googleOAuthService: undefined,
    buildMessageDeps: async () => ({}),
  });
  assert.equal(sent.length, 0);
});

test("processTelegramUpdate swallows errors from the failure notice itself", async () => {
  const telegram = {
    async sendMessage() {
      throw new Error("network down");
    },
  };
  // Should not throw even though both the handler and the notice fail.
  await processTelegramUpdate({
    update: {
      update_id: 5,
      message: {
        text: "/help",
        from: { id: 1, username: "u1" },
        chat: { id: 10 },
      },
    },
    store: {},
    telegram,
    googleOAuthService: undefined,
    buildMessageDeps: async () => {
      throw new Error("boom");
    },
  });
});

const SUPPORTED_TAGS = ["b", "i", "code", "pre", "a"];

function assertBalancedTags(html) {
  const stack = [];
  const tagRegex = /<(\/?)(\w+)(?:\s[^>]*)?>/gu;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const [, closing, tagName] = match;
    if (!SUPPORTED_TAGS.includes(tagName)) {
      continue;
    }
    if (!closing) {
      stack.push(tagName);
    } else {
      const top = stack.pop();
      assert.equal(top, tagName, `unexpected closing tag </${tagName}> in: ${html}`);
    }
  }
  assert.equal(stack.length, 0, `unclosed tags ${stack.join(",")} in: ${html}`);
}
