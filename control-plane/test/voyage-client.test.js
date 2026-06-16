import test from "node:test";
import assert from "node:assert/strict";
import {
  HttpVoyageClient,
  MissingVoyageClient,
  cosineSimilarity,
  topKBySimilarity,
  createVoyageClientFromEnv,
} from "../src/integrations/voyage-client.js";

test("createVoyageClientFromEnv returns Missing client without a key", async () => {
  const client = createVoyageClientFromEnv({});
  assert.equal(client.configured, false);
  assert.deepEqual((await client.embed("hi")).embeddings, []);
});

test("HttpVoyageClient.embed batches and preserves input order", async () => {
  const client = new HttpVoyageClient({ apiKey: "k" });
  const calls = [];
  client.request = async (body) => {
    calls.push(body);
    // return out-of-order to verify sorting by index
    return {
      data: body.input.map((_, i) => ({ index: body.input.length - 1 - i, embedding: [body.input.length - 1 - i] })).reverse(),
      usage: { total_tokens: 3 },
    };
  };
  const res = await client.embed(["a", "b", "c"], { inputType: "query" });
  assert.equal(res.configured, true);
  assert.equal(calls[0].input_type, "query");
  assert.deepEqual(res.embeddings, [[0], [1], [2]]);
});

test("cosineSimilarity and topKBySimilarity rank correctly", () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);

  const candidates = [
    { id: "near", embedding: [0.9, 0.1] },
    { id: "far", embedding: [-1, 0] },
    { id: "mid", embedding: [0.5, 0.5] },
  ];
  const ranked = topKBySimilarity([1, 0], candidates, 2, 0);
  assert.equal(ranked[0].item.id, "near");
  assert.equal(ranked.length, 2);
});

test("MissingVoyageClient is a safe no-op", async () => {
  const r = await new MissingVoyageClient().embed(["x"]);
  assert.equal(r.configured, false);
});
