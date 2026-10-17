import assert from "node:assert/strict";
import test from "node:test";
import { generateAssistantText, generateAssistantReply, selectRecentConversation } from "./assistantService.js";
import { buildAssistantMessages } from "./assistantPromptService.js";
import { estimateTokens } from "../utils/wellnessIntelligenceEngine.js";

function message(id, role, content, replyTo) {
  return { _id: String(id).padStart(3, "0"), role, content, replyTo: replyTo == null ? undefined : String(replyTo).padStart(3, "0"),
    createdAt: new Date(1700000000000 + id * 1000) };
}

test("recent history keeps four chronological exchanges and excludes the separately supplied current message", () => {
  const messages = Array.from({ length: 8 }, (_, i) => [message(i * 2 + 1, "student", `Concern ${i}`),
    message(i * 2 + 2, "assistant", `Reply ${i}`, i * 2 + 1)]).flat();
  messages.push(message(17, "student", "Current message"));
  const history = selectRecentConversation(messages.reverse(), { currentMessageId: "017" });
  assert.equal(history.length, 8);
  assert.equal(history[0].content, "Concern 4");
  assert.equal(history.at(-1).content, "Reply 7");
  assert.ok(history.every((item) => !item.content.includes("Current")));
});

test("long conversation history stays within its token budget, keeps newest complete exchanges, and leaves current text intact", () => {
  const messages = Array.from({ length: 30 }, (_, index) => [
    message(index * 2 + 1, "student", `Recent context ${index} ${"exam ".repeat(8)}`),
    message(index * 2 + 2, "assistant", `Support reply ${index} ${"next step ".repeat(8)}`, index * 2 + 1)
  ]).flat();
  const currentMessage = message(61, "student", "CURRENT_REQUEST " + "specific words ".repeat(40));
  messages.push(currentMessage);
  const history = selectRecentConversation(messages, { currentMessageId: currentMessage._id });
  assert.ok(history.length <= 8);
  assert.ok(estimateTokens(JSON.stringify(history)) <= 700);
  assert.equal(history.at(-1).content, messages.at(-2).content);
  assert.ok(history.some(item => item.content.includes("Recent context 29")));
  const prompt = buildAssistantMessages({ recentConversation: history, userMessage: currentMessage.content });
  assert.equal(prompt.at(-1).content, currentMessage.content);
  assert.equal(prompt.filter(item => item.content === currentMessage.content).length, 1);
  assert.ok(history.every(item => !item.content.includes("CURRENT_REQUEST")));
});

test("history budget preserves complete exchanges and safety response bypasses provider", async () => {
  const history = selectRecentConversation([message(1, "student", "Again"), message(2, "assistant", "Older reply"),
    message(3, "student", "Again"), message(4, "assistant", "Recent reply", 3), message(5, "student", "Again")],
  { currentMessageId: "005", tokenBudget: 30 });
  assert.deepEqual(history, [{ role: "user", content: "Again" }, { role: "assistant", content: "Recent reply" }]);
  const reply = await generateAssistantReply({ userMessage: "I cannot stay safe", generateResponse: async () => assert.fail("safety must bypass model") });
  assert.equal(reply.source, "safety_message");
  assert.match(reply.text, /emergency services/);
  assert.match(await generateAssistantText({ userMessage: "I might hurt myself" }), /trusted person/);
});
