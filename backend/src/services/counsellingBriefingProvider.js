import { checkOllamaAvailability, generateOllamaResponse } from "./ollamaResponseService.js";

// Counsellor briefing generation is local-only. The factual overview stays available
// when Ollama is not installed or running.
export function getCounsellingBriefingProvider(env = process.env) {
  const name = env.COUNSELLOR_BRIEFING_PROVIDER?.trim().toLowerCase() || "ollama";
  if (name === "ollama") return {
    name, availability: () => checkOllamaAvailability({ env }),
    generate: request => generateOllamaResponse({ ...request, env })
  };
  return { name, availability: async () => ({ available: false,
    message: "Local AI generation is unavailable because the briefing provider is disabled or unrecognized. The factual overview remains available." }),
  generate: async () => { throw new Error("Briefing provider is unavailable."); } };
}
