import "dotenv/config";
import { getCounsellingBriefingProvider } from "../services/counsellingBriefingProvider.js";

// Metadata-only check: no database access, prompt generation or model download.
const provider = getCounsellingBriefingProvider();
const status = await provider.availability();
console.log(JSON.stringify({ provider: provider.name, available: status.available,
  message: status.available ? "Provider is ready. Generate a briefing through an authorized counselling appointment to verify inference." : status.message }, null, 2));
if (!status.available) process.exitCode = 1;
