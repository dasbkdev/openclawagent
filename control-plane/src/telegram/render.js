const SUPPORTED_TAGS = ["b", "i", "code", "pre", "a"];

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Render structured blocks into Telegram HTML.
 *
 * Supported block types:
 *  - { type: "title", text, emoji? }
 *  - { type: "section", heading, lines: string[] }
 *  - { type: "kv", label, value }
 *  - { type: "list", items: string[] }
 *  - { type: "divider" }
 *  - { type: "text", text }
 */
export function renderBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    return "";
  }
  const out = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }
    switch (block.type) {
      case "title": {
        const prefix = block.emoji ? `${block.emoji} ` : "";
        out.push(`<b>${prefix}${escapeHtml(block.text)}</b>`);
        break;
      }
      case "section": {
        const sectionLines = [];
        if (block.heading) {
          sectionLines.push(`<b>${escapeHtml(block.heading)}</b>`);
        }
        for (const line of block.lines || []) {
          sectionLines.push(escapeHtml(line));
        }
        out.push(sectionLines.join("\n"));
        break;
      }
      case "kv": {
        out.push(`<b>${escapeHtml(block.label)}:</b> ${escapeHtml(block.value ?? "n/a")}`);
        break;
      }
      case "list": {
        out.push((block.items || []).map((item) => `• ${escapeHtml(item)}`).join("\n"));
        break;
      }
      case "divider": {
        out.push("―――――");
        break;
      }
      case "text": {
        out.push(escapeHtml(block.text));
        break;
      }
      default:
        break;
    }
  }
  return out.filter((chunk) => chunk !== "").join("\n\n");
}

/**
 * Convert a limited subset of Markdown into Telegram-safe HTML.
 * Anything not recognized is escaped. Unbalanced/truncated markup is
 * closed defensively so the produced HTML is always well-formed.
 */
export function markdownToTelegramHtml(text) {
  const value = String(text ?? "");
  if (!value) {
    return "";
  }

  // Extract fenced code blocks first so their contents are not touched
  // by inline markdown rules.
  const segments = [];
  const fenceRegex = /```(?:[^\n`]*\n)?([\s\S]*?)```/gu;
  let lastIndex = 0;
  let match;
  while ((match = fenceRegex.exec(value)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }
    segments.push({ type: "pre", value: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) {
    segments.push({ type: "text", value: value.slice(lastIndex) });
  }

  // Handle an unterminated fence at the end (``` opened but never closed).
  const rendered = [];
  for (const segment of segments) {
    if (segment.type === "pre") {
      rendered.push(`<pre>${escapeHtml(segment.value)}</pre>`);
      continue;
    }
    rendered.push(renderMarkdownText(segment.value));
  }

  return closeUnbalancedTags(rendered.join(""));
}

function renderMarkdownText(text) {
  const lines = String(text).split("\n");
  const out = [];
  for (const rawLine of lines) {
    out.push(renderMarkdownLine(rawLine));
  }
  return out.join("\n");
}

function renderMarkdownLine(rawLine) {
  let line = rawLine;

  // Headings: "### Title", "## Title", "# Title"
  const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/u);
  if (headingMatch) {
    return `<b>${renderInline(headingMatch[2].trim())}</b>`;
  }

  // List items: "- item", "* item", "1. item"
  const listMatch = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/u);
  if (listMatch) {
    return `• ${renderInline(listMatch[1])}`;
  }

  return renderInline(line);
}

/**
 * Render inline markdown: bold (**), italic (* or _), code (backticks),
 * and links ([text](url)).
 * Everything else is escaped. Handles dangling/unbalanced markers by
 * treating the leftover marker as literal text.
 */
function renderInline(text) {
  // Tokenize while respecting escaping. We process left to right,
  // greedily matching the longest known constructs.
  let result = "";
  let i = 0;
  const n = text.length;

  while (i < n) {
    const rest = text.slice(i);

    // Inline code: `code`
    const codeMatch = rest.match(/^`([^`]+)`/u);
    if (codeMatch) {
      result += `<code>${escapeHtml(codeMatch[1])}</code>`;
      i += codeMatch[0].length;
      continue;
    }

    // Link: [text](http(s)://...)
    const linkMatch = rest.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/u);
    if (linkMatch) {
      result += `<a href="${escapeAttribute(linkMatch[2])}">${escapeHtml(linkMatch[1])}</a>`;
      i += linkMatch[0].length;
      continue;
    }

    // Bold: **text**
    const boldMatch = rest.match(/^\*\*([^*]+)\*\*/u);
    if (boldMatch) {
      result += `<b>${renderInline(boldMatch[1])}</b>`;
      i += boldMatch[0].length;
      continue;
    }

    // Italic: *text* (single asterisk, not part of **)
    const italicStarMatch = rest.match(/^\*([^*]+)\*/u);
    if (italicStarMatch) {
      result += `<i>${renderInline(italicStarMatch[1])}</i>`;
      i += italicStarMatch[0].length;
      continue;
    }

    // Italic: _text_
    const italicUnderscoreMatch = rest.match(/^_([^_]+)_/u);
    if (italicUnderscoreMatch) {
      result += `<i>${renderInline(italicUnderscoreMatch[1])}</i>`;
      i += italicUnderscoreMatch[0].length;
      continue;
    }

    // Default: consume one character, escape it.
    result += escapeHtml(text[i]);
    i += 1;
  }

  return result;
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

/**
 * Ensure the HTML string has balanced supported tags. If the markdown
 * conversion produced an odd number of opening tags (e.g. due to
 * truncated input), close the dangling ones at the end.
 */
function closeUnbalancedTags(html) {
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
      const idx = stack.lastIndexOf(tagName);
      if (idx !== -1) {
        stack.splice(idx, 1);
      }
    }
  }
  if (stack.length === 0) {
    return html;
  }
  let closingTags = "";
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    closingTags += `</${stack[i]}>`;
  }
  return html + closingTags;
}

/**
 * Split a Telegram HTML message into parts that each fit within `limit`
 * characters, preferring to break on paragraph (\n\n) and line (\n)
 * boundaries. Open HTML tags spanning a split point are closed at the
 * end of one part and reopened at the start of the next.
 */
export function splitTelegramMessage(text, limit = 4096) {
  const value = String(text ?? "");
  if (value.length <= limit) {
    return value.length === 0 ? [""] : [value];
  }

  const rawParts = [];
  let remaining = value;
  while (remaining.length > limit) {
    const chunk = remaining.slice(0, limit);
    const split = findSplitPoint(chunk, limit);
    rawParts.push(remaining.slice(0, split.end));
    remaining = remaining.slice(split.next);
  }
  if (remaining.length > 0) {
    rawParts.push(remaining);
  }

  return rebalanceTags(rawParts);
}

/**
 * Find where to split `chunk`. Returns `{ end, next }`: `end` is the
 * exclusive end of the current part (separator trimmed off), `next` is
 * the index in the original remaining text where the next part starts
 * (separator skipped).
 */
function findSplitPoint(chunk, limit) {
  // Prefer breaking at a paragraph boundary.
  let idx = chunk.lastIndexOf("\n\n");
  if (idx > 0) {
    return { end: idx, next: idx + 2 };
  }
  // Then a line boundary.
  idx = chunk.lastIndexOf("\n");
  if (idx > 0) {
    return { end: idx, next: idx + 1 };
  }
  // Then a space.
  idx = chunk.lastIndexOf(" ");
  if (idx > 0) {
    return { end: idx, next: idx + 1 };
  }
  // Hard split at the limit, but never inside an HTML tag (e.g. "</b").
  const lastOpen = chunk.lastIndexOf("<");
  const lastClose = chunk.lastIndexOf(">");
  if (lastOpen > lastClose && lastOpen > 0) {
    return { end: lastOpen, next: lastOpen };
  }
  return { end: limit, next: limit };
}

/**
 * Given raw text parts that may each contain unbalanced supported tags
 * (because the split point fell inside a tag's span), close dangling
 * tags at the end of each part and reopen them at the start of the next.
 */
function rebalanceTags(parts) {
  const result = [];
  let openTags = [];
  for (const part of parts) {
    const prefix = openTags.map((tag) => `<${tag}>`).join("");
    let body = prefix + part;

    const stack = [];
    const tagRegex = /<(\/?)(\w+)(?:\s[^>]*)?>/gu;
    let match;
    while ((match = tagRegex.exec(body)) !== null) {
      const [, closing, tagName] = match;
      if (!SUPPORTED_TAGS.includes(tagName)) {
        continue;
      }
      if (!closing) {
        stack.push(tagName);
      } else {
        const idx = stack.lastIndexOf(tagName);
        if (idx !== -1) {
          stack.splice(idx, 1);
        }
      }
    }

    if (stack.length > 0) {
      let closingTags = "";
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        closingTags += `</${stack[i]}>`;
      }
      body += closingTags;
    }

    result.push(body);
    openTags = stack;
  }
  return result;
}

/**
 * Send a (possibly long) Telegram HTML message, splitting it into
 * multiple messages if it exceeds the Telegram length limit.
 */
export async function sendLongMessage({ telegram, chatId, text, limit = 4096 }) {
  const parts = splitTelegramMessage(text, limit);
  const results = [];
  for (const part of parts) {
    results.push(await telegram.sendMessage({ chatId, text: part }));
  }
  return results;
}
