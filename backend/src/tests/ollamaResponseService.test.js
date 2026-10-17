import assert from "node:assert/strict";
import test from "node:test";
import { generateOllamaResponse } from "../services/ollamaResponseService.js";

const env = { OLLAMA_BASE_URL: "http://127.0.0.1:11434", OLLAMA_MODEL: "qwen3:1.7b" };
const prompt = "Appointment focus: sleep. The student reported poor sleep. A mood score of 2/5 was recorded.";
const instructions = "Use only the supplied records. Keep the briefing concise.";
const metadata = { details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] };
const reply = (content, extra = {}) => ({ done: true, done_reason: "stop", message: { role: "assistant", content, ...extra } });

function transport(t, result) {
  return t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).origin, "http://127.0.0.1:11434");
    const request = JSON.parse(options.body);
    assert.equal(request.model, "qwen3:1.7b");
    if (url.endsWith("/api/show")) {
      assert.deepEqual(request, { model: "qwen3:1.7b" });
      return { ok: true, json: async () => metadata };
    }
    assert.ok(url.endsWith("/api/chat"));
    assert.equal(request.stream, false);
    assert.equal(request.think, false);
    assert.deepEqual(request.messages, [{ role: "system", content: instructions }, { role: "user", content: prompt }]);
    return { ok: true, json: async () => result };
  });
}

test("accepts a completed concise Qwen3 briefing with separated Markdown sections", async t => {
  const content = [
    "**Student-reported concerns**\nThe student reported poor sleep.",
    "**Relevant context**\nA mood score of 2/5 was recorded.",
    "**Suggested discussion topics**\nAsk how sleep has felt recently.",
    "**Information gaps**\nNo further details were recorded."
  ].join("\n\n");
  transport(t, reply(content));
  assert.equal(await generateOllamaResponse({ prompt, instructions, env }), content);
});

test("empty, thinking-only, oversized-section, malformed and incomplete output still fail closed", async t => {
  const invalid = [
    reply(""),
    reply("", { thinking: "private reasoning must never be returned" }),
    reply(Array.from({ length: 9 }, (_, index) => `Section ${index + 1}`).join("\n\n")),
    { ...reply("partial"), done: false },
    { ...reply("truncated"), done_reason: "length" },
    { done: true, done_reason: "stop", message: { role: "assistant", content: "<think>private reasoning</think>" } }
  ];
  for (const result of invalid) {
    const mocked = transport(t, result);
    try { await assert.rejects(generateOllamaResponse({ prompt, instructions, env }), /incomplete or invalid briefing/); }
    finally { mocked.mock.restore(); }
  }
});
