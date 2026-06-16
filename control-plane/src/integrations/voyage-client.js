// Voyage AI embeddings client (zero-dependency, fetch-based). Used by the
// semantic memory layer to embed memory items + questions and retrieve the
// most relevant facts by cosine similarity. Read-only external call.

const DEFAULT_ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const DEFAULT_MODEL = "voyage-3.5";
const MAX_BATCH = 128;

export function createVoyageClientFromEnv(env = process.env) {
  const apiKey = env.VOYAGE_API_KEY || "";
  if (!apiKey) {
    return new MissingVoyageClient();
  }
  return new HttpVoyageClient({
    apiKey,
    model: env.VOYAGE_MODEL || DEFAULT_MODEL,
    timeoutMs: Number(env.VOYAGE_TIMEOUT_MS || 30000),
  });
}

export class MissingVoyageClient {
  constructor() {
    this.configured = false;
    this.model = DEFAULT_MODEL;
  }

  async embed() {
    return { configured: false, embeddings: [], model: this.model, usage: null };
  }
}

export class HttpVoyageClient {
  constructor({ apiKey, model = DEFAULT_MODEL, endpoint = DEFAULT_ENDPOINT, timeoutMs = 30000 }) {
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
    this.configured = true;
  }

  /**
   * Embed one string or a list of strings.
   * `inputType` is "document" (stored memory) or "query" (the question) — Voyage
   * uses it to tune retrieval. Returns vectors aligned to the input order.
   */
  async embed(input, { inputType = "document" } = {}) {
    const texts = (Array.isArray(input) ? input : [input])
      .map((t) => String(t ?? "").trim())
      .filter((t) => t.length > 0);
    if (texts.length === 0) {
      return { configured: true, embeddings: [], model: this.model, usage: null };
    }

    const embeddings = [];
    let totalTokens = 0;
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const batch = texts.slice(i, i + MAX_BATCH);
      const payload = await this.request({ input: batch, model: this.model, input_type: inputType });
      const ordered = (payload.data || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      for (const item of ordered) {
        embeddings.push(item.embedding);
      }
      totalTokens += Number(payload.usage?.total_tokens || 0);
    }
    return { configured: true, embeddings, model: this.model, usage: { totalTokens } };
  }

  async request(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(`Voyage API failed: HTTP ${response.status} ${payload?.detail || payload?.error || ""}`.trim());
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }
}

// Cosine similarity between two equal-length numeric vectors.
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Rank candidate items (each { ...; embedding }) against a query embedding and
 * return the top-K with a similarity score, highest first.
 */
export function topKBySimilarity(queryEmbedding, candidates, k = 8, minScore = 0.2) {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    return [];
  }
  return candidates
    .map((item) => ({ item, score: cosineSimilarity(queryEmbedding, item.embedding) }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
