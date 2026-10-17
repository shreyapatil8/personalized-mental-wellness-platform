import assert from "node:assert/strict";
import test from "node:test";
import { generateAssistantReply } from "./assistantService.js";
import { checkLocalAssistantAvailability, generateLocalAssistantResponse, getLocalAssistantConfig } from "./localAssistantProvider.js";

const env = { ASSISTANT_OLLAMA_MODEL: "qwen3:1.7b", ASSISTANT_OLLAMA_BASE_URL: "http://127.0.0.1:11434", ASSISTANT_OLLAMA_TIMEOUT_MS: "120000" };
const ollama = text => ({ done: true, done_reason: "stop", message: { role: "assistant", content: text } });
const modelInfo = { details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] };
const mockedLocal = chat => async (url, options) => url.endsWith("/api/show")
  ? ({ ok: true, json: async () => modelInfo }) : chat(url, options);

test("safe defaults use a local loopback Ollama endpoint and compact instruction model", () => {
  assert.deepEqual(getLocalAssistantConfig({}), { baseUrl: "http://127.0.0.1:11434", model: "qwen3:1.7b", timeoutMs: 180000 });
  for (const config of [
    { ASSISTANT_OLLAMA_BASE_URL: "https://ollama.com" },
    { ASSISTANT_OLLAMA_BASE_URL: "http://10.0.0.2:11434" },
    { ASSISTANT_OLLAMA_MODEL: "qwen3:1.7b-cloud" }
  ]) assert.throws(() => getLocalAssistantConfig(config));
});

test("startup availability check reports a missing local model with actionable setup guidance", async () => {
  const status = await checkLocalAssistantAvailability({ env, fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(status.available, false);
  assert.equal(status.code, "OLLAMA_MODEL_MISSING");
  assert.match(status.message, /ollama pull qwen3:1.7b/);
  const available = await checkLocalAssistantAvailability({ env, fetchImpl: mockedLocal(async () => ({ ok: true, json: async () => ollama("unused") })) });
  assert.deepEqual(available, { available: true, model: "qwen3:1.7b" });
});

test("mocked local Ollama API receives system instructions, selected context, conversation and one current message", async () => {
  const history = [{ role: "user", content: "My exams are stressful." }, { role: "assistant", content: "What part feels hardest?" }];
  let call;
  const result = await generateLocalAssistantResponse({ prompt: "Recent mood: low", userMessage: "The workload.", recentConversation: history,
    env, fetchImpl: mockedLocal(async (url, options) => {
      call = { url, options, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ollama("A mocked local model response; no live model was called.") };
    }) });
  assert.equal(result, "A mocked local model response; no live model was called.");
  assert.equal(call.url, "http://127.0.0.1:11434/api/chat");
  assert.equal(call.options.redirect, "error");
  assert.ok(call.options.signal instanceof AbortSignal);
  assert.equal(call.body.model, "qwen3:1.7b");
  assert.equal(call.body.stream, false);
  assert.equal(call.body.think, false);
  assert.equal(call.body.options.num_ctx, 4096);
  assert.equal(call.body.options.temperature, 0.2);
  assert.equal(call.body.messages[0].role, "system");
  assert.match(call.body.messages[0].content, /Do not diagnose/);
  assert.match(call.body.messages[0].content, /Backend-calculated dated summaries are authoritative/);
  assert.match(call.body.messages[0].content, /Never invent a feeling, symptom, event/);
  assert.match(call.body.messages[0].content, /Separate recorded facts from possibilities and general suggestions/);
  assert.match(call.body.messages[1].content, /Recent mood: low/);
  assert.deepEqual(call.body.messages.slice(-3), [...history, { role: "user", content: "The workload." }]);
  assert.equal(call.body.messages.filter(item => item.content === "The workload.").length, 1);
});

test("a single backend process rejects overlapping Ollama inference without returning a fake reply", async () => {
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  let finishInference;
  const pending = new Promise(resolve => { finishInference = resolve; });
  const fetchImpl = mockedLocal(async () => { markStarted(); return pending; });
  const first = generateLocalAssistantResponse({ userMessage: "First request", env, fetchImpl });
  await started;
  await assert.rejects(generateAssistantReply({ userMessage: "Second request",
    generateResponse: args => generateLocalAssistantResponse({ ...args, env, fetchImpl })
  }), error => error.statusCode === 503 && /handling another request/.test(error.message));
  finishInference({ ok: true, json: async () => ollama("One real-shaped mocked response") });
  assert.equal(await first, "One real-shaped mocked response");
});

test("oversized conversation payload drops oldest complete pairs while keeping the latest pair and current message intact", async () => {
  const history = Array.from({ length: 40 }, (_, index) => [
    { role: "user", content: `OLD_OR_RECENT_STUDENT_${index} ${"exam context ".repeat(70)}` },
    { role: "assistant", content: `OLD_OR_RECENT_ASSISTANT_${index} ${"support context ".repeat(70)}` }
  ]).flat();
  let request;
  await generateLocalAssistantResponse({ prompt: "Authorized context", userMessage: "CURRENT_USER_MESSAGE",
    recentConversation: history, env, fetchImpl: mockedLocal(async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ollama("Bounded mocked reply") };
    }) });
  const outgoing = request.messages;
  const serialized = JSON.stringify(outgoing);
  assert.ok(Math.ceil(serialized.length / 4) <= 4096 - 700 - 128);
  assert.ok(serialized.includes("OLD_OR_RECENT_STUDENT_39"));
  assert.ok(serialized.includes("OLD_OR_RECENT_ASSISTANT_39"));
  assert.ok(!serialized.includes("OLD_OR_RECENT_STUDENT_0"));
  assert.equal(outgoing.at(-1).content, "CURRENT_USER_MESSAGE");
  assert.equal(outgoing.filter(item => item.content === "CURRENT_USER_MESSAGE").length, 1);
});

test("an oversized immediate exchange fails honestly without truncating its current turn", async () => {
  await assert.rejects(generateLocalAssistantResponse({ prompt: "Authorized context", userMessage: "CURRENT_USER_MESSAGE",
    recentConversation: [{ role: "user", content: "Prior concern ".repeat(700) }, { role: "assistant", content: "Prior response ".repeat(700) }],
    env, fetchImpl: mockedLocal(async () => assert.fail("no generation with an unsafe prompt"))
  }), error => error.code === "OLLAMA_PROMPT_TOO_LARGE");
});

test("offline server, missing model, timeout and malformed or empty output reject without fabricated replies", async () => {
  const failures = [
    async () => { throw new Error("ECONNREFUSED"); },
    async () => ({ ok: false, status: 404 }),
    async () => { throw new DOMException("deadline", "TimeoutError"); },
    async () => ({ ok: true, json: async () => ({ message: { role: "assistant", content: "" }, done: true }) }),
    async () => ({ ok: true, json: async () => ({ message: { role: "tool", content: "not a reply" }, done: true }) }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError("malformed json"); } }),
    async () => ({ ok: true, json: async () => ({ message: { role: "assistant", content: "partial" }, done: false }) })
  ];
  for (const failedChat of failures) {
    const fetchImpl = mockedLocal(failedChat);
    await assert.rejects(generateLocalAssistantResponse({ prompt: "context", userMessage: "Help", env, fetchImpl }));
    await assert.rejects(generateAssistantReply({ contextPrompt: "context", userMessage: "Help", generateResponse: args => generateLocalAssistantResponse({ ...args, env, fetchImpl }) }), error => error.statusCode === 503);
  }
});

test("thinking-only output is rejected and private thinking is never returned as an assistant reply", async () => {
  const privateThinking = "PRIVATE_THINKING_MUST_NOT_BE_SHOWN";
  const fetchImpl = mockedLocal(async () => ({ ok: true, json: async () => ({ done: true, done_reason: "stop",
    message: { role: "assistant", content: "", thinking: privateThinking } }) }));
  await assert.rejects(generateLocalAssistantResponse({ userMessage: "Help me", env, fetchImpl }), error => {
    assert.equal(error.code, "OLLAMA_INVALID_RESPONSE");
    assert.doesNotMatch(error.message, new RegExp(privateThinking));
    return true;
  });
});

test("HTTP provider errors remain failures instead of being normalized into empty replies", async () => {
  const fetchImpl = mockedLocal(async () => ({ ok: false, status: 500 }));
  await assert.rejects(generateLocalAssistantResponse({ userMessage: "Help me", env, fetchImpl }), error => error.code === "OLLAMA_UNAVAILABLE");
});

test("no API key is read or sent to the local inference endpoint", async () => {
  delete process.env.OPENAI_API_KEY;
  let options;
  await generateLocalAssistantResponse({ userMessage: "Test", env, fetchImpl: mockedLocal(async (_url, request) => {
    options = request;
    return { ok: true, json: async () => ollama("Mock response") };
  }) });
  assert.doesNotMatch(JSON.stringify(options.headers), /authorization|api.key/i);
  assert.doesNotMatch(options.body, /OPENAI_API_KEY|sk-[A-Za-z0-9]/);
});
