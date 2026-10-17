// Counsellor briefing transport only. Receives the existing privacy-filtered prompt;
// it never reads records, adds conversation history, or falls back to a cloud API.
export function getOllamaConfig(env = process.env) {
  const url = new URL(env.OLLAMA_BASE_URL || "http://127.0.0.1:11434");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Ollama must use a local loopback HTTP origin.");
  }
  // Resolve localhost to a literal loopback address, avoiding DNS/proxy routing.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  const model = env.OLLAMA_MODEL?.trim() || "qwen3:1.7b";
  if (!/^[a-z0-9][a-z0-9._:/-]*$/i.test(model) || /cloud/i.test(model)) {
    throw new Error("A local Ollama model is required.");
  }
  const timeoutMs = Number(env.OLLAMA_TIMEOUT_MS || 120000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180000) {
    throw new Error("OLLAMA_TIMEOUT_MS must be between 1000 and 180000.");
  }
  return { baseUrl: url.origin, model, timeoutMs };
}

async function localRequest(config, path, body, timeoutMs, fetchImpl) {
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Local AI request failed (${response.status}).`);
  const data = await response.json();
  if (!data || data.error) throw new Error("Local AI returned an error.");
  return data;
}

async function verifyLocalModel(config, fetchImpl) {
  // Metadata only: no wellness data is sent until local model validation succeeds.
  const data = await localRequest(config, "/api/show", { model: config.model }, 2000, fetchImpl);
  if (data.remote_host || data.remote_model || data.details?.format !== "gguf" ||
      !data.model_info || !Object.keys(data.model_info).length || !data.capabilities?.includes("completion")) {
    throw new Error("A downloaded local text model is required.");
  }
}

export async function checkOllamaAvailability({ env = process.env, fetchImpl = fetch } = {}) {
  try {
    await verifyLocalModel(getOllamaConfig(env), fetchImpl);
    return { available: true };
  } catch {
    return { available: false, message: "Local AI is unavailable. Start Ollama with the configured local model, then refresh. The factual overview remains available." };
  }
}

export async function generateOllamaResponse({ prompt, instructions, env = process.env, fetchImpl = fetch }) {
  const config = getOllamaConfig(env);
  await verifyLocalModel(config, fetchImpl);
  const data = await localRequest(config, "/api/chat", {
    model: config.model, stream: false, think: false, keep_alive: "2m",
    messages: [{ role: "system", content: instructions }, { role: "user", content: prompt }],
    options: { temperature: 0.2, num_ctx: 4096, num_predict: 400 }
  }, config.timeoutMs, fetchImpl);
  const text = typeof data.message?.content === "string" ? data.message.content.trim() : "";
  // Qwen3 often separates concise heading/section blocks with blank lines.
  // Permit the requested four evidence-based sections plus a short heading,
  // while retaining strict word, size and completion limits.
  if (data.done !== true || data.done_reason !== "stop" || data.message?.role !== "assistant" ||
      data.message?.tool_calls?.length || !text || text.length > 4000 ||
      text.split(/\s+/u).length > 180 || text.split(/\n\s*\n/u).length > 8 || /<\/?think>/i.test(text)) {
    throw new Error("Local AI returned an incomplete or invalid briefing.");
  }
  return text;
}
