// Semantic recall over a user's distilled memory facts: embed facts (cached in
// the embedding store), embed the question, return the most relevant facts by
// cosine similarity. Safe no-op when Voyage is not configured.
import { topKBySimilarity } from "../integrations/voyage-client.js";

export async function retrieveRelevantFacts({
  embeddingStore,
  voyage,
  facts,
  question,
  k = 6,
  minScore = 0.25,
}) {
  if (!voyage?.configured || !embeddingStore || !Array.isArray(facts) || facts.length === 0) {
    return [];
  }
  const cleanQuestion = String(question || "").trim();
  if (!cleanQuestion) {
    return [];
  }

  const ids = facts.map((fact) => fact.id);
  let cached;
  try {
    cached = await embeddingStore.getMany(ids);
  } catch {
    return [];
  }

  // Embed any facts we have not embedded yet, and persist them.
  const missing = facts.filter((fact) => !cached.has(fact.id));
  if (missing.length > 0) {
    try {
      const { embeddings } = await voyage.embed(missing.map((fact) => fact.text), { inputType: "document" });
      if (embeddings.length === missing.length) {
        const rows = missing.map((fact, i) => ({
          id: fact.id,
          userId: fact.userId ?? null,
          content: fact.text,
          embedding: embeddings[i],
          model: voyage.model,
        }));
        await embeddingStore.upsertMany(rows);
        rows.forEach((row) => cached.set(row.id, row.embedding));
      }
    } catch {
      // fall through with whatever is already cached
    }
  }

  let queryEmbedding;
  try {
    const q = await voyage.embed(cleanQuestion, { inputType: "query" });
    queryEmbedding = q.embeddings[0];
  } catch {
    return [];
  }
  if (!queryEmbedding) {
    return [];
  }

  const candidates = facts
    .filter((fact) => cached.has(fact.id))
    .map((fact) => ({ ...fact, embedding: cached.get(fact.id) }));

  return topKBySimilarity(queryEmbedding, candidates, k, minScore).map(({ item, score }) => ({
    id: item.id,
    text: item.text,
    category: item.category ?? null,
    userId: item.userId ?? null,
    score: Number(score.toFixed(3)),
  }));
}
