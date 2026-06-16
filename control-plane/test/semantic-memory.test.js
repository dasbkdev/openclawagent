import test from "node:test";
import assert from "node:assert/strict";
import { retrieveRelevantFacts } from "../src/domain/semantic-memory.js";

// Tiny deterministic "embedding": map keywords to axes so cosine is meaningful.
function fakeEmbed(text) {
  const t = String(text).toLowerCase();
  return [
    /встреч|собрани|14:00|когда/.test(t) ? 1 : 0,
    /отпуск|отдых|отгул/.test(t) ? 1 : 0,
    /кофе|обед|еда/.test(t) ? 1 : 0,
  ];
}

function fakeVoyage() {
  return {
    configured: true,
    model: "fake",
    async embed(input) {
      const texts = Array.isArray(input) ? input : [input];
      return { configured: true, embeddings: texts.map(fakeEmbed), model: "fake" };
    },
  };
}

function memStore() {
  const map = new Map();
  return {
    upserts: 0,
    async getMany(ids) {
      const out = new Map();
      for (const id of ids) if (map.has(id)) out.set(id, map.get(id));
      return out;
    },
    async upsertMany(rows) {
      this.upserts += rows.length;
      for (const r of rows) map.set(r.id, r.embedding);
    },
  };
}

const FACTS = [
  { id: "f1", userId: "u1", category: "commitment", text: "Собрание команды в 14:00" },
  { id: "f2", userId: "u1", category: "preference", text: "Хочет взять отпуск летом" },
  { id: "f3", userId: "u1", category: "habit", text: "Любит кофе по утрам" },
];

test("retrieveRelevantFacts returns the most relevant fact for a question", async () => {
  const store = memStore();
  const voyage = fakeVoyage();
  const out = await retrieveRelevantFacts({ embeddingStore: store, voyage, facts: FACTS, question: "когда у нас встреча?", k: 2, minScore: 0.1 });
  assert.equal(out[0].id, "f1");
  assert.equal(store.upserts, 3); // all three embedded + cached on first call

  // second call reuses cache (no new embeds of facts)
  const before = store.upserts;
  const out2 = await retrieveRelevantFacts({ embeddingStore: store, voyage, facts: FACTS, question: "хочу в отпуск", k: 1, minScore: 0.1 });
  assert.equal(out2[0].id, "f2");
  assert.equal(store.upserts, before); // facts already cached
});

test("retrieveRelevantFacts is a safe no-op without Voyage", async () => {
  const out = await retrieveRelevantFacts({ embeddingStore: memStore(), voyage: { configured: false }, facts: FACTS, question: "встреча" });
  assert.deepEqual(out, []);
});
