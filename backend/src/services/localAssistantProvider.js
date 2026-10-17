import { buildAssistantMessages } from "./assistantPromptService.js";
import { estimateTokens } from "../utils/wellnessIntelligenceEngine.js";

const MODEL_CONTEXT_TOKENS = 4096;
const RESPONSE_TOKENS = 700;
const INPUT_SAFETY_MARGIN = 128;

const SETUP_HELP = "Install Ollama for Windows from https://ollama.com/download/windows, start Ollama, then run `ollama pull qwen3:1.7b`. Your message is saved; retry after the model is ready.";
let inferenceActive = false;

export function getLocalAssistantConfig(env = process.env) {
  let url;
  try { url = new URL(env.ASSISTANT_OLLAMA_BASE_URL || "http://127.0.0.1:11434"); }
  catch { throw new Error("ASSISTANT_OLLAMA_BASE_URL must be a local Ollama URL."); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Assistant Ollama endpoint must be a local loopback HTTP origin.");
  }
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  const model = env.ASSISTANT_OLLAMA_MODEL?.trim() || "qwen3:1.7b";
  if (!/^[a-z0-9][a-z0-9._:/-]*$/i.test(model) || /cloud/i.test(model)) {
    throw new Error("Assistant Ollama model must be a downloaded local model name.");
  }
  const timeoutMs = Number(env.ASSISTANT_OLLAMA_TIMEOUT_MS || 180000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
    throw new Error("ASSISTANT_OLLAMA_TIMEOUT_MS must be between 1000 and 300000.");
  }
  return { baseUrl: url.origin, model, timeoutMs };
}

function localError(code, detail) {
  const error = new Error(detail || "Local Ollama is unavailable.");
  error.code = code;
  return error;
}

async function post(config, path, payload, timeoutMs, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
  } catch (cause) {
    throw localError(cause?.name === "TimeoutError" ? "OLLAMA_TIMEOUT" : "OLLAMA_UNAVAILABLE", cause?.message);
  }
  if (!response.ok) {
    const missing = response.status === 404;
    throw localError(missing ? "OLLAMA_MODEL_MISSING" : "OLLAMA_UNAVAILABLE", `Local Ollama request failed (${response.status}).`);
  }
  try {
    const data = await response.json();
    if (!data || typeof data !== "object" || data.error) throw new Error("Malformed JSON response");
    return data;
  } catch (cause) { throw localError("OLLAMA_INVALID_RESPONSE", cause?.message); }
}

async function assertLocalModel(config, fetchImpl) {
  const info = await post(config, "/api/show", { model: config.model }, 5000, fetchImpl);
  if (info.remote_host || info.remote_model || info.details?.format !== "gguf" || !info.model_info ||
    !Object.keys(info.model_info).length || !info.capabilities?.includes("completion")) {
    throw localError("OLLAMA_MODEL_MISSING", "A downloaded local text model is required.");
  }
}

export async function checkLocalAssistantAvailability({ env = process.env, fetchImpl = fetch } = {}) {
  let config;
  try {
    config = getLocalAssistantConfig(env);
    await assertLocalModel(config, fetchImpl);
    return { available: true, model: config.model };
  } catch (error) {
    return {
      available: false,
      model: config?.model || env.ASSISTANT_OLLAMA_MODEL || "qwen3:1.7b",
      code: error.code || "OLLAMA_CONFIG",
      message: localAssistantSetupMessage(error)
    };
  }
}

export async function generateLocalAssistantResponse({ prompt = "", userMessage = "", instructions, recentConversation = [], env = process.env, fetchImpl = fetch }) {
  const config = getLocalAssistantConfig(env);
  if (inferenceActive) throw localError("OLLAMA_BUSY", "Another local assistant response is being generated. Your message is saved; retry when it finishes.");
  inferenceActive = true;
  try {
    await assertLocalModel(config, fetchImpl);
    const messages = buildAssistantMessages({ prompt, userMessage, instructions, recentConversation });
    const fixedMessages = prompt ? 3 : 2; // system, optional context, and the intact current user turn
    const historyStart = prompt ? 2 : 1;
    const inputBudget = MODEL_CONTEXT_TOKENS - RESPONSE_TOKENS - INPUT_SAFETY_MARGIN;
    while (estimateTokens(JSON.stringify(messages)) > inputBudget && messages.length - fixedMessages > 2) {
      messages.splice(historyStart, 2); // oldest complete exchange first; preserve the newest pair
    }
    if (estimateTokens(JSON.stringify(messages)) > inputBudget) {
      throw localError("OLLAMA_PROMPT_TOO_LARGE", "The current request and its immediate context exceed the local model's safe context window.");
    }
    const data = await post(config, "/api/chat", {
      model: config.model,
      stream: false,
      // Qwen3 can spend its bounded generation budget on hidden reasoning and
      // finish with empty message.content. The assistant only consumes final
      // content, so request that Ollama return the answer directly.
      think: false,
      keep_alive: "2m",
      messages,
      options: { temperature: 0.2, num_ctx: 4096, num_predict: 700 }
    }, config.timeoutMs, fetchImpl);
    const text = typeof data.message?.content === "string" ? data.message.content.trim() : "";
    if (data.done !== true || (data.done_reason && data.done_reason !== "stop") || data.message?.role !== "assistant" ||
      data.message?.tool_calls?.length || !text || text.length > 4000 || /<\/?think>/i.test(text)) {
      throw localError("OLLAMA_INVALID_RESPONSE", "Ollama returned an empty, incomplete, or malformed response.");
    }
    return text;
  } finally {
    inferenceActive = false;
  }
}

export function localAssistantSetupMessage(error) {
  if (error?.code === "OLLAMA_MODEL_MISSING") return `The local AI model ${process.env.ASSISTANT_OLLAMA_MODEL?.trim() || "qwen3:1.7b"} is not installed. ${SETUP_HELP}`;
  if (error?.code === "OLLAMA_UNAVAILABLE") return `Could not connect to the local Ollama service. ${SETUP_HELP}`;
  if (error?.code === "OLLAMA_BUSY") return "The local model is handling another request. Your message is saved; retry in a moment.";
  if (error?.code === "OLLAMA_PROMPT_TOO_LARGE") return "This request and its most recent context exceed the local model’s safe context window. Your message is saved; retry with a shorter message or fewer details.";
  if (error?.code === "OLLAMA_TIMEOUT") return "The local model took too long to respond. Your message is saved; retry when your computer is ready, or raise ASSISTANT_OLLAMA_TIMEOUT_MS.";
  if (error?.code === "OLLAMA_INVALID_RESPONSE") return "The local model returned an invalid or empty response. Your message is saved; retry.";
  return "Local AI is not configured correctly. Check ASSISTANT_OLLAMA_BASE_URL, ASSISTANT_OLLAMA_MODEL, and ASSISTANT_OLLAMA_TIMEOUT_MS in backend/.env.";
}
