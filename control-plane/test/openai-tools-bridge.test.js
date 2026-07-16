import assert from "node:assert/strict";
import test from "node:test";
import {
  toAnthropicTools,
  toAnthropicToolChoice,
  toAnthropicMessages,
  toOpenAiResponse,
  runAgentTurn,
} from "../src/assistant/openai-tools-bridge.js";

test("toAnthropicTools maps OpenAI function tools to Anthropic tools", () => {
  const out = toAnthropicTools([
    {
      type: "function",
      function: {
        name: "run_command",
        description: "run a shell command",
        parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
      },
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "run_command");
  assert.equal(out[0].description, "run a shell command");
  assert.deepEqual(out[0].input_schema.required, ["cmd"]);
});

test("toAnthropicToolChoice maps the common choices", () => {
  assert.equal(toAnthropicToolChoice("auto"), undefined);
  assert.equal(toAnthropicToolChoice("none"), undefined);
  assert.deepEqual(toAnthropicToolChoice("required"), { type: "any" });
  assert.deepEqual(toAnthropicToolChoice({ type: "function", function: { name: "x" } }), {
    type: "tool",
    name: "x",
  });
});

test("toAnthropicMessages splits system, maps tool_calls and tool results", () => {
  const { system, messages } = toAnthropicMessages([
    { role: "system", content: "ты агент" },
    { role: "user", content: "покажи файлы" },
    {
      role: "assistant",
      content: "смотрю",
      tool_calls: [{ id: "c1", type: "function", function: { name: "run_command", arguments: '{"cmd":"ls"}' } }],
    },
    { role: "tool", tool_call_id: "c1", content: "a.txt b.txt" },
  ]);

  assert.equal(system, "ты агент");
  // user, assistant(text+tool_use), user(tool_result)
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
  const toolUse = messages[1].content.find((b) => b.type === "tool_use");
  assert.equal(toolUse.name, "run_command");
  assert.deepEqual(toolUse.input, { cmd: "ls" });
  const toolResult = messages[2].content[0];
  assert.equal(toolResult.type, "tool_result");
  assert.equal(toolResult.tool_use_id, "c1");
  assert.equal(toolResult.content, "a.txt b.txt");
});

test("consecutive tool results merge into one user message", () => {
  const { messages } = toAnthropicMessages([
    { role: "assistant", tool_calls: [
      { id: "a", type: "function", function: { name: "t", arguments: "{}" } },
      { id: "b", type: "function", function: { name: "t", arguments: "{}" } },
    ] },
    { role: "tool", tool_call_id: "a", content: "r1" },
    { role: "tool", tool_call_id: "b", content: "r2" },
  ]);
  const userTurn = messages[messages.length - 1];
  assert.equal(userTurn.role, "user");
  assert.equal(userTurn.content.length, 2);
});

test("toOpenAiResponse converts text answers", () => {
  const res = toOpenAiResponse(
    { content: [{ type: "text", text: "готово" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } },
    "starlab-agent",
  );
  assert.equal(res.choices[0].message.content, "готово");
  assert.equal(res.choices[0].finish_reason, "stop");
  assert.equal(res.usage.total_tokens, 5);
});

test("toOpenAiResponse converts tool_use into tool_calls", () => {
  const res = toOpenAiResponse(
    {
      content: [{ type: "tool_use", id: "c9", name: "run_command", input: { cmd: "pwd" } }],
      stop_reason: "tool_use",
    },
    "m",
  );
  assert.equal(res.choices[0].finish_reason, "tool_calls");
  const call = res.choices[0].message.tool_calls[0];
  assert.equal(call.function.name, "run_command");
  assert.deepEqual(JSON.parse(call.function.arguments), { cmd: "pwd" });
});

test("runAgentTurn wires the translation through a fake claude client", async () => {
  const seen = {};
  const claudeClient = {
    async sendMessages(req) {
      seen.req = req;
      return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: {} };
    },
  };
  const res = await runAgentTurn({
    claudeClient,
    body: {
      model: "starlab-agent",
      messages: [{ role: "user", content: "привет" }],
      tools: [{ type: "function", function: { name: "t", parameters: { type: "object" } } }],
      tool_choice: "required",
    },
  });
  assert.equal(seen.req.tools.length, 1);
  assert.deepEqual(seen.req.toolChoice, { type: "any" });
  assert.equal(res.choices[0].message.content, "ok");
});
