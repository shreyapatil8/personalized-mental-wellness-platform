import ConversationMessage from "../models/ConversationMessage.js";
import { generateWellnessContext } from "./wellnessIntelligenceService.js";
import { generateLocalAssistantResponse, localAssistantSetupMessage } from "./localAssistantProvider.js";
import { estimateTokens } from "../utils/wellnessIntelligenceEngine.js";

export async function sendAssistantMessage({ user, message, conversation, clientMessageId, generateResponse = generateLocalAssistantResponse }) {
  let studentMessage = clientMessageId ? await ConversationMessage.findOne({ student: user._id, clientMessageId }) : null;
  if (studentMessage && String(studentMessage.conversation || "") !== String(conversation || "")) {
    const error = new Error("This message ID was already used."); error.statusCode = 409; throw error;
  }
  if (!studentMessage) studentMessage = await ConversationMessage.create({ student: user._id, conversation, clientMessageId, role: "student", content: message });
  if (studentMessage.content !== message) { const error = new Error("This message ID was already used with different text."); error.statusCode = 409; throw error; }
  const previousReply = await ConversationMessage.findOne({ student: user._id, replyTo: studentMessage._id });
  if (previousReply) return { studentMessage, assistantMessage: previousReply, context: null };

  const immediateRisk = mentionsImmediateRisk(message);
  const recentConversation = immediateRisk ? [] : await loadRecentConversation(user._id, studentMessage, conversation);
  const context = immediateRisk ? { _id: null, structuredPrompt: "", selectedItems: [] } : await generateWellnessContext({
    user,
    userMessage: message,
    recentConversation,
    tokenBudget: 900,
    // The dated mood aggregate is essential context; allow one additional
    // bounded evidence item so its provenance does not displace the classifier.
    maxItems: 9
  });

  const reply = await generateAssistantReply({
    context,
    contextPrompt: context.structuredPrompt,
    userMessage: message,
    recentConversation,
    generateResponse
  });

  const assistantMessage = await ConversationMessage.create({
    student: user._id,
    conversation,
    role: "assistant",
    replyTo: studentMessage._id,
    content: reply.text,
    responseSource: reply.source
  });

  return {
    studentMessage,
    assistantMessage,
    context
  };
}

async function loadRecentConversation(studentId, currentMessage, conversation) {
  const messages = await ConversationMessage.find({
    student: studentId,
    ...(conversation ? { conversation } : {}),
    $or: [
      { createdAt: { $lt: currentMessage.createdAt } },
      { createdAt: currentMessage.createdAt, _id: { $lt: currentMessage._id } }
    ]
  }).sort({ createdAt: -1, _id: -1 }).limit(16).lean();
  return selectRecentConversation(messages, { currentMessageId: currentMessage._id });
}

export function selectRecentConversation(messages, { currentMessageId, maxExchanges = 4, tokenBudget = 700 } = {}) {
  const ordered = messages.filter((message) => String(message._id) !== String(currentMessageId))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a._id).localeCompare(String(b._id)));
  const indices = new Map(ordered.map((message, index) => [String(message._id), index]));
  const selected = [];
  let boundary = ordered.length;
  let usedTokens = 0;

  // Work backwards by complete exchange. Never include an orphan reply or split a pair.
  for (let index = ordered.length - 1; index >= 0 && selected.length < maxExchanges; index -= 1) {
    const reply = ordered[index];
    if (reply.role !== "assistant" || index >= boundary) continue;
    const studentIndex = reply.replyTo ? indices.get(String(reply.replyTo)) : index - 1;
    const student = ordered[studentIndex];
    if (!student || student.role !== "student" || studentIndex >= index) continue;
    // Unlinked legacy replies are paired only with the immediately preceding student message.
    const pair = [{ role: "user", content: student.content }, { role: "assistant", content: reply.content }];
    const tokens = estimateTokens(JSON.stringify(pair));
    if (usedTokens + tokens > tokenBudget) break;
    selected.unshift(pair);
    usedTokens += tokens;
    boundary = studentIndex;
  }
  return selected.flat();
}

export async function generateAssistantText({ context, contextPrompt, userMessage, recentConversation }) {
  return (await generateAssistantReply({ context, contextPrompt, userMessage, recentConversation })).text;
}

export async function generateAssistantReply({ context, contextPrompt, userMessage, recentConversation = [], generateResponse = generateLocalAssistantResponse }) {
  if (mentionsImmediateRisk(userMessage)) {
    return { source: "safety_message", text: [
      "I'm really sorry you're feeling this much pain. Your safety matters right now.",
      "Please contact your campus counsellor, a trusted person near you, or local emergency services immediately if you might hurt yourself or cannot stay safe.",
      "If you can, move close to another person and avoid being alone while you get help."
    ].join(" ") };
  }

  const request = { prompt: contextPrompt ?? context?.structuredPrompt ?? "", userMessage, recentConversation };
  try {
    const assistantText = await generateResponse(request);

    if (typeof assistantText === "string" && assistantText.trim()) {
      return { text: assistantText.trim(), source: "ollama" };
    }
  } catch (cause) {
    const error = new Error(localAssistantSetupMessage(cause));
    error.statusCode = 503;
    throw error;
  }
  const error = new Error("The local AI returned no response. Your message has been saved; retry.");
  error.statusCode = 503;
  throw error;
}

function mentionsImmediateRisk(message) {
  const text = message.toLowerCase();
  return [
    "suicide",
    "suicidal",
    "kill myself",
    "end my life",
    "hurt myself",
    "harm myself",
    "self harm",
    "self-harm",
    "can't stay safe",
    "cannot stay safe"
  ].some((phrase) => text.includes(phrase));
}
