import test from "node:test";
import assert from "node:assert/strict";
import { PersonalMemStore, emptyPersonalState } from "../src/personal/personal-store.js";
import { PersonalIdentityMemStore, hashPersonalToken } from "../src/personal/personal-identity.js";
import { answerPersonalAssistant, parsePersonalFacts } from "../src/personal/personal-assistant.js";

test("personal store is strictly per-user and isolated", async () => {
  const store = new PersonalMemStore();
  await store.updateUser("u-nikolay", (s) => { s.facts.push({ text: "плохо спит", category: "health" }); });
  await store.updateUser("u-anastasia", (s) => { s.facts.push({ text: "бегает по утрам", category: "habit" }); });

  const nik = await store.loadUser("u-nikolay");
  const ana = await store.loadUser("u-anastasia");
  assert.equal(nik.facts.length, 1);
  assert.equal(nik.facts[0].text, "плохо спит");
  assert.equal(ana.facts.length, 1);
  assert.equal(ana.facts[0].text, "бегает по утрам");
  // a fresh user has an empty, independent state
  assert.deepEqual((await store.loadUser("u-new")).facts, []);
  assert.equal(emptyPersonalState("x").userId, "x");
});

test("personal identity: code -> token -> single user", async () => {
  const id = new PersonalIdentityMemStore();
  const { code } = await id.issueCode({ userId: "u-nikolay", displayName: "Николай" });
  const redeemed = await id.redeemCode(code);
  assert.equal(redeemed.userId, "u-nikolay");
  assert.ok(redeemed.token);
  const who = await id.resolveToken(redeemed.token);
  assert.equal(who.userId, "u-nikolay");
  assert.equal(await id.resolveToken("wrong"), null);
  // hash is stable
  assert.equal(hashPersonalToken("a"), hashPersonalToken("a"));
});

test("parsePersonalFacts extracts categorized personal facts", () => {
  const facts = parsePersonalFacts('ok {"facts":[{"category":"health","text":"мало спит"},{"category":"weird","text":"цель — выучить англ"}]} end');
  assert.equal(facts.length, 2);
  assert.equal(facts[0].category, "health");
  assert.equal(facts[1].category, "other"); // unknown category normalized
  assert.equal(parsePersonalFacts("no json").length, 0);
});

test("answerPersonalAssistant replies, stores the turn, and distills facts (no work data)", async () => {
  const store = new PersonalMemStore();
  let distillCall = 0;
  const claudeClient = {
    configured: true,
    async complete({ system }) {
      // The distiller system prompt mentions "личной памяти"; the answer prompt is the persona.
      if (/модуль личной памяти/u.test(system)) {
        distillCall += 1;
        return { text: '{"facts":[{"category":"mood","text":"чувствует тревогу перед сном"}]}' };
      }
      // persona prompt must be personal, not the work assistant
      assert.match(system, /личный ассистент|психолог|здоровь/iu);
      assert.doesNotMatch(system, /Platrum|Metricon|Bitrix|канбан/iu);
      return { text: "Понимаю тебя. Давай разберёмся, что тревожит перед сном." };
    },
  };
  const res = await answerPersonalAssistant({
    store, userId: "u-nikolay", displayName: "Николай",
    question: "не могу уснуть, тревожно",
    claudeClient, voyageClient: null,
  });
  assert.match(res.plainText, /тревожит|разберёмся/u);
  const state = await store.loadUser("u-nikolay");
  assert.equal(state.dialogue.length, 2); // user + assistant turn stored
  // give the background distiller a tick
  await new Promise((r) => setTimeout(r, 20));
  const after = await store.loadUser("u-nikolay");
  assert.ok(after.facts.some((f) => /тревог/u.test(f.text)), "personal fact distilled");
  assert.equal(distillCall, 1);
});
