import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import User from "../models/User.js";
import ChatConversation from "../models/ChatConversation.js";
import ConversationMessage from "../models/ConversationMessage.js";
import StudentProfile from "../models/StudentProfile.js";
import JournalEntry from "../models/JournalEntry.js";
import { createAuthToken } from "../utils/tokens.js";

const uri = process.env.TEST_MONGODB_URI;
const run = { skip: !uri };
let first, second, tokenA, tokenB;
const originalFetch = globalThis.fetch;
const localModelInfo = { details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] };

process.env.JWT_SECRET = "chat-test-secret-at-least-32-characters-long";

test("conversation APIs enforce ownership, isolate messages, persist replies, and retry failed provider calls idempotently", { ...run, timeout: 30000 }, async () => {
  if (!uri) return;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  await Promise.all([User.deleteMany({}), ChatConversation.deleteMany({}), ConversationMessage.deleteMany({}), StudentProfile.deleteMany({}), JournalEntry.deleteMany({})]);
  first = await User.create({ name: "Student One", email: "chat-one@example.test", password: "not-a-real-password", role: "student" });
  second = await User.create({ name: "Student Two", email: "chat-two@example.test", password: "not-a-real-password", role: "student" });
  tokenA = createAuthToken(first); tokenB = createAuthToken(second);

  try {
  assert.equal(jwt.verify(tokenA, process.env.JWT_SECRET).sub, String(first._id));
  assert.ok(await User.findById(first._id));
  globalThis.fetch = async url => url.endsWith("/api/show") ? ({ ok: true, json: async () => localModelInfo }) : ({ ok: true, json: async () => ({ done: true, done_reason: "stop", message: { role: "assistant", content: "A supportive, mocked reply." } }) });
  const create = await request(app).post("/api/chat/conversations").set("Authorization", `Bearer ${tokenA}`);
  assert.equal(create.status, 201, create.body.message);
  const id = create.body.conversation._id;
  await request(app).get(`/api/chat/conversations/${id}`).set("Authorization", `Bearer ${tokenB}`).expect(404);
  const messageId = "d49f3a58-bb1e-4c45-8f0b-950219dbd402";
  const reply = await request(app).post("/api/chat/messages").set("Authorization", `Bearer ${tokenA}`)
    .send({ conversationId: id, clientMessageId: messageId, message: "I am stressed about exams." }).expect(201);
  assert.equal(reply.body.assistantMessage.content, "A supportive, mocked reply.");
  assert.deepEqual(reply.body.context.usedSources, []);
  await request(app).get(`/api/chat/conversations/${id}`).set("Authorization", `Bearer ${tokenA}`).expect(200)
    .expect(({ body }) => { assert.equal(body.messages.length, 2); assert.equal(body.conversation.title, "I am stressed about exams."); });

  await StudentProfile.create({ user: first._id, consentForAssistantJournalContext: false });
  await JournalEntry.create({ student: first._id, title: "Study concern", content: "I am worried about exams and cannot sleep because I keep thinking about study." });
  let providerPayload;
  globalThis.fetch = async (_url, options) => { if (_url.endsWith("/api/show")) return { ok: true, json: async () => localModelInfo }; providerPayload = JSON.parse(options.body); return { ok: true, json: async () => ({ done: true, done_reason: "stop", message: { role: "assistant", content: "A supportive reply." } }) }; };
  const privateReply = await request(app).post("/api/chat/messages").set("Authorization", `Bearer ${tokenA}`)
    .send({ conversationId: id, clientMessageId: "f353ac1b-b1e7-4b55-8e98-97e2cda7c249", message: "I am worried about exams and sleep." }).expect(201);
  assert.ok(!JSON.stringify(providerPayload).includes("cannot sleep because I keep thinking"));
  assert.ok(!JSON.stringify(privateReply.body).includes("cannot sleep because I keep thinking"));
  await StudentProfile.updateOne({ user: first._id }, { $set: { consentForAssistantJournalContext: true } });
  const consentReply = await request(app).post("/api/chat/messages").set("Authorization", `Bearer ${tokenA}`)
    .send({ conversationId: id, clientMessageId: "8fd1b585-c7af-46b8-953c-82d4eeea148f", message: "I am worried about exams and sleep again." }).expect(201);
  assert.ok(JSON.stringify(providerPayload).includes("cannot sleep because I keep thinking"));
  assert.ok(consentReply.body.context.usedSources.includes("journal"));
  assert.ok(!JSON.stringify(consentReply.body).includes("cannot sleep because I keep thinking"));

  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const failedId = "b1fbfce9-67e1-4d94-b740-4e4c4df4bf30";
  await request(app).post("/api/chat/messages").set("Authorization", `Bearer ${tokenA}`)
    .send({ conversationId: id, clientMessageId: failedId, message: "I feel overwhelmed today." }).expect(503);
  const savedBeforeRetry = await ConversationMessage.find({ student: first._id, conversation: id, clientMessageId: failedId });
  assert.equal(savedBeforeRetry.length, 1);
  globalThis.fetch = async url => url.endsWith("/api/show") ? ({ ok: true, json: async () => localModelInfo }) : ({ ok: true, json: async () => ({ done: true, done_reason: "stop", message: { role: "assistant", content: "A retried, mocked reply." } }) });
  await request(app).post("/api/chat/messages").set("Authorization", `Bearer ${tokenA}`)
    .send({ conversationId: id, clientMessageId: failedId, message: "I feel overwhelmed today." }).expect(201);
  assert.equal(await ConversationMessage.countDocuments({ student: first._id, conversation: id, clientMessageId: failedId }), 1);
  assert.equal(await ConversationMessage.countDocuments({ student: first._id, conversation: id, replyTo: savedBeforeRetry[0]._id }), 1);

  const otherChat = await request(app).post("/api/chat/conversations").set("Authorization", `Bearer ${tokenA}`).expect(201);
  assert.notEqual(otherChat.body.conversation._id, id);
  await request(app).get(`/api/chat/conversations/${otherChat.body.conversation._id}`).set("Authorization", `Bearer ${tokenA}`)
    .expect(({ body }) => assert.equal(body.messages.length, 0));
  await request(app).delete(`/api/chat/conversations/${id}`).set("Authorization", `Bearer ${tokenB}`).expect(404);
  await request(app).delete(`/api/chat/conversations/${id}`).set("Authorization", `Bearer ${tokenA}`).expect(204);
  assert.equal(await ConversationMessage.countDocuments({ student: first._id, conversation: id }), 0);
  } finally {
    globalThis.fetch = originalFetch;

    await mongoose.disconnect();
  }
});
