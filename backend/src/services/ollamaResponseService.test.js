import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { checkOllamaAvailability, generateOllamaResponse } from "./ollamaResponseService.js";
import { getCounsellingBriefingProvider } from "./counsellingBriefingProvider.js";

const env = { OLLAMA_MODEL: "qwen3:1.7b" };
const metadata = { details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] };
const reply = { done: true, done_reason: "stop", message: { role: "assistant", content: "The student reported poor sleep. Ask about recent rest." } };
const ok = data => ({ ok: true, json: async () => data });

test("Ollama receives only approved context and instructions, with bounded local requests", async () => {
  const calls = [];
  const text = await generateOllamaResponse({ env, prompt: "Approved context", instructions: "Briefing instructions",
    userMessage: "MUST_NOT_FORWARD", recentConversation: [{ content: "PRIVATE_CHAT" }],
    fetchImpl: async (url, request) => {
      calls.push(url);
      assert.ok(request.signal instanceof AbortSignal);
      assert.equal(request.redirect, "error");
      const body = JSON.parse(request.body);
      if (url.endsWith("/api/show")) { assert.deepEqual(body, { model: env.OLLAMA_MODEL }); return ok(metadata); }
      assert.equal(url, "http://127.0.0.1:11434/api/chat");
      assert.deepEqual(body.messages, [{ role: "system", content: "Briefing instructions" }, { role: "user", content: "Approved context" }]);
      assert.equal(body.stream, false);
      assert.equal(body.options.num_ctx, 4096);
      assert.equal(body.options.num_predict, 400);
      assert.doesNotMatch(request.body, /PRIVATE_CHAT|MUST_NOT_FORWARD/);
      return ok(reply);
    } });
  assert.equal(text, reply.message.content);
  assert.equal(calls.length, 2);
});

test("availability detects ready, missing, malformed, remote and offline local models", async () => {
  assert.equal((await checkOllamaAvailability({ env, fetchImpl: async () => ok(metadata) })).available, true);
  for (const fetchImpl of [
    async () => ({ ok: false, status: 404 }), async () => { throw new Error("ECONNREFUSED"); },
    async () => ok({}), async () => ok({ ...metadata, remote_host: "https://ollama.com" }),
    async () => ok({ ...metadata, remote_model: "cloud-alias" }),
    async () => ok({ ...metadata, capabilities: ["embedding"] })
  ]) assert.equal((await checkOllamaAvailability({ env, fetchImpl })).available, false);
});

test("unsafe configuration is rejected before any network request", async () => {
  for (const settings of [
    { OLLAMA_BASE_URL: "https://ollama.com" }, { OLLAMA_BASE_URL: "http://192.168.1.10:11434" },
    { OLLAMA_BASE_URL: "http://localhost.evil.test" }, { OLLAMA_BASE_URL: "http://user:pass@localhost:11434" },
    { OLLAMA_BASE_URL: "http://localhost:11434/proxy" }, { OLLAMA_MODEL: "qwen:cloud" },
    { OLLAMA_TIMEOUT_MS: "NaN" }, { OLLAMA_TIMEOUT_MS: "999999" }
  ]) {
    let called = false;
    const config = { ...env, ...settings };
    const fetchImpl = async () => { called = true; throw new Error("Must not call"); };
    assert.equal((await checkOllamaAvailability({ env: config, fetchImpl })).available, false);
    await assert.rejects(generateOllamaResponse({ env: config, fetchImpl }));
    assert.equal(called, false);
  }
});

test("remote aliases never receive a prompt, even through localhost", async () => {
  let calls = 0;
  await assert.rejects(generateOllamaResponse({ env, prompt: "Approved private context", fetchImpl: async (url, request) => {
    calls++;
    assert.ok(url.endsWith("/api/show"));
    assert.doesNotMatch(request.body, /private context/);
    return ok({ ...metadata, remote_host: "https://ollama.com" });
  } }));
  assert.equal(calls, 1);
});

test("incomplete, empty, oversized, reasoning and malformed output never becomes a briefing", async () => {
  for (const output of [
    {}, { error: "failed" }, { ...reply, done: false }, { ...reply, done_reason: "length" },
    { ...reply, message: { role: "assistant", content: " " } },
    { ...reply, message: { role: "assistant", content: "word ".repeat(181) } },
    { ...reply, message: { role: "assistant", content: Array.from({ length: 9 }, (_, index) => `Section ${index + 1}`).join("\n\n") } },
    { ...reply, message: { role: "assistant", content: "x".repeat(4001) } },
    { ...reply, message: { role: "assistant", content: "<think>reasoning</think>" } },
    { ...reply, message: { role: "tool", content: "Tool output" } }
  ]) await assert.rejects(generateOllamaResponse({ env, fetchImpl: async url => ok(url.endsWith("/api/show") ? metadata : output) }));
});

test("counsellor briefing generation is local-only even if an obsolete provider setting is present", async () => {
  assert.equal(getCounsellingBriefingProvider({}).name, "ollama");
  for (const settings of [
    { COUNSELLOR_BRIEFING_PROVIDER: "typo" },
    { COUNSELLOR_BRIEFING_PROVIDER: "openai" },
    { COUNSELLOR_BRIEFING_PROVIDER: "openai", COUNSELLOR_BRIEFING_ALLOW_CLOUD: "true" }
  ]) {
    const provider = getCounsellingBriefingProvider(settings);
    assert.equal((await provider.availability()).available, false);
    await assert.rejects(async () => provider.generate({ prompt: "must not leave machine" }));
  }
  assert.equal((await getCounsellingBriefingProvider({ COUNSELLOR_BRIEFING_PROVIDER: "openai",
    COUNSELLOR_BRIEFING_ALLOW_CLOUD: "true" }).availability()).available, false);
});

test("real loopback HTTP transport rejects redirects and aborts stalled generation", async t => {
  let mode = "success", redirected = false;
  const server = createServer((req, res) => {
    req.resume();
    if (req.url === "/api/show") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(metadata)); }
    else if (req.url === "/redirected") { redirected = true; res.end("not allowed"); }
    else if (mode === "redirect") { res.writeHead(307, { Location: "/redirected" }); res.end(); }
    else if (mode !== "stall") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(reply)); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const config = { ...env, OLLAMA_BASE_URL: `http://127.0.0.1:${server.address().port}`, OLLAMA_TIMEOUT_MS: "1000" };
  assert.equal((await checkOllamaAvailability({ env: config })).available, true);
  assert.equal(await generateOllamaResponse({ env: config, prompt: "Fixture", instructions: "Fixture" }), reply.message.content);
  mode = "redirect";
  await assert.rejects(generateOllamaResponse({ env: config }));
  assert.equal(redirected, false);
  mode = "stall";
  await assert.rejects(generateOllamaResponse({ env: config }), error => error.name === "TimeoutError");
});
