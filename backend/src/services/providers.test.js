import assert from "node:assert/strict";
import test from "node:test";
import { buildAssistantMessages } from "./assistantPromptService.js";
import { validatePdf, documentDownloadUrl } from "./documentStorageService.js";
import { prepareCounsellingSummary, summaryInstructions } from "../utils/counsellingSummary.js";

test("assistant prompt separates selected context, conversation and the current message", () => {
  const recentConversation = [{ role: "user", content: "Previous question" }, { role: "assistant", content: "Previous answer" }];
  const input = buildAssistantMessages({ prompt: "Goals: improve rest", userMessage: "Current question", recentConversation });
  assert.deepEqual(input.map((item) => item.role), ["system", "system", "user", "assistant", "user"]);
  assert.match(input[1].content, /Personal wellness context/);
  assert.equal(JSON.stringify(input).split("Current question").length - 1, 1);
  assert.match(input[0].content, /Do not diagnose/);
  assert.match(input[0].content, /only when relevant/);
  assert.match(input[0].content, /counsellor support/);
});

test("counsellor summary retains its own instructions without a fabricated chat message", () => {
  const prepared = prepareCounsellingSummary({ profile: { wellnessGoals: ["Better sleep"], updatedAt: new Date() } });
  const input = buildAssistantMessages({ prompt: prepared.prompt, instructions: summaryInstructions });
  assert.equal(input.length, 2);
  assert.equal(input[0].content, summaryInstructions);
  assert.match(input[1].content, /Better sleep/);
  assert.doesNotMatch(JSON.stringify(input), /Student's latest message|Current student message/);
});

test("documents validate format and size and issue expiring authenticated URLs", () => {
  assert.throws(() => validatePdf(Buffer.from("not a PDF").toString("base64")), /PDF/);
  assert.throws(() => validatePdf(Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(512000)]).toString("base64")), /500 KB/);
  process.env.CLOUDINARY_CLOUD_NAME = "unit-test-cloud";
  process.env.CLOUDINARY_API_KEY = "unit-test-key";
  process.env.CLOUDINARY_API_SECRET = "unit-test-secret";
  const url = new URL(documentDownloadUrl("wellness-research/fixture.pdf"));
  assert.match(url.pathname, /raw\/download/);
  assert.equal(url.searchParams.get("type"), "authenticated");
  assert.ok(url.searchParams.get("signature"));
  const lifetime = Number(url.searchParams.get("expires_at")) - Date.now() / 1000;
  assert.ok(lifetime > 55 && lifetime <= 60);
  delete process.env.CLOUDINARY_API_SECRET;
  assert.throws(() => documentDownloadUrl("fixture"), { statusCode: 503 });
});
