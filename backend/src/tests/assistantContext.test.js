import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../models/User.js";
import StudentProfile from "../models/StudentProfile.js";
import ConversationMessage from "../models/ConversationMessage.js";
import MoodLog from "../models/MoodLog.js";
import JournalEntry from "../models/JournalEntry.js";
import Assessment from "../models/Assessment.js";
import WellnessPrediction from "../models/WellnessPrediction.js";
import WellnessContextSnapshot from "../models/WellnessContextSnapshot.js";
import { initialWellnessContract } from "../utils/initialWellnessAssessment.js";
import { createAuthToken } from "../utils/tokens.js";
import { sendAssistantMessage } from "../services/assistantService.js";
import { buildAssistantMessages } from "../services/assistantPromptService.js";
import { generateWellnessContext } from "../services/wellnessIntelligenceService.js";
import { buildCandidates, buildWellnessContext, estimateTokens, summarizeMoodPattern } from "../utils/wellnessIntelligenceEngine.js";
import { stressSurveyContract } from "../utils/stressSurvey.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "isolated-assistant-context-test-secret-at-least-32-characters";
let database, student, other, legacy, otherLegacy;
const auth = (account) => ({ Authorization: `Bearer ${createAuthToken(account)}` });
function mockProvider(t, onRequest = () => {}) {
  return t.mock.method(globalThis, "fetch", async (_url, options) => {
    if (_url.endsWith("/api/show")) return { ok: true, json: async () => ({ details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] }) };
    const body = JSON.parse(options.body);
    onRequest(body.messages);
    return { ok: true, json: async () => ({ done: true, done_reason: "stop", message: { role: "assistant", content: "A mocked provider response." } }) };
  });
}

async function enterPredictionInputs(account, value) {
  const answers = Object.fromEntries(stressSurveyContract.questions.map(question => [question.id, value]));
  await request(app).post("/api/predictions/survey").set(auth(account)).send({ answers }).expect(201);
  await request(app).post("/api/predictions/me").set(auth(account)).expect(201);
}

before(async () => {
  // Always an isolated temporary database; never load the application's .env.
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri());
  await WellnessPrediction.init();
  [student, other] = await Promise.all(["Avery", "Jordan"].map((name) => User.create({
    name, email: `${name.toLowerCase()}@assistant.test`, password: "test-only-password", role: "student"
  })));
  const now = new Date();
  const responses = Object.fromEntries(initialWellnessContract.questions.filter((q) => !q.optional).map((q) => [q.id, q.options[2]]));
  await StudentProfile.create({ user: student._id, department: "Computer Science and Engineering", wellnessGoals: ["Improve rest"],
    consentForAssistantJournalContext: true,
    initialWellnessAssessment: { schemaVersion: initialWellnessContract.version, completedAt: now, updatedAt: now,
      responses: { ...responses, academicPressure: "High", stressFrequency: "Often", primaryConcern: "Academic/study pressure", preferredSupport: "Someone to talk to",
        sleepQuality: "Poor", sleepHours: "5–6", additionalNotes: "Sleep interrupted by dorm noise." } } });
  await StudentProfile.create({ user: other._id, wellnessGoals: ["OTHER_STUDENT_GOAL"], consentForAssistantJournalContext: true,
    initialWellnessAssessment: { schemaVersion: initialWellnessContract.version, completedAt: now, updatedAt: now,
      responses: { ...responses, academicPressure: "Low", sleepQuality: "Good", sleepHours: "7–8",
        primaryConcern: "Financial concerns", additionalNotes: "OTHER_STUDENT_NOTES" } } });
  await MoodLog.create({ student: student._id, mood: "low", moodScore: 2, stressLevel: 4, sleepHours: 5 });
  await JournalEntry.create({ student: student._id, title: "Dorm noise", content: "Night noise makes sleep difficult.", sentiment: "negative" });
  await Assessment.create({ student: student._id, responses: [2, 2, 2, 2, 2], rawScore: 10, percentageScore: 40, riskLevel: "moderate" });
  await enterPredictionInputs(student, 4);
  legacy = await ConversationMessage.insertMany([
    { student: student._id, role: "student", content: "My roommate keeps waking me at night.", createdAt: new Date(Date.now() - 20000) },
    { student: student._id, role: "assistant", content: "Have you discussed quiet hours?", createdAt: new Date(Date.now() - 19000) }
  ]);
  otherLegacy = await ConversationMessage.insertMany([
    { student: other._id, role: "student", content: "OTHER_STUDENT_MESSAGE", createdAt: new Date(Date.now() - 18000) },
    { student: other._id, role: "assistant", content: "OTHER_STUDENT_REPLY", createdAt: new Date(Date.now() - 17000) }
  ]);
}, { timeout: 180000 });

after(async () => { await mongoose.disconnect(); await database?.stop(); });

test("saved assessment and relevant records reach the request alongside unfiltered legacy history", async () => {
  const beforeRecords = await ConversationMessage.find({ _id: { $in: legacy.map((item) => item._id) } }).sort({ createdAt: 1 }).lean();
  let input;
  const result = await sendAssistantMessage({ user: student, message: "What should I do next?", generateResponse: async (args) => {
    input = buildAssistantMessages(args);
    return "Mock provider output; no live AI request.";
  } });
  assert.ok(input);
  assert.doesNotMatch(input[1].content, /Primary concern: Academic\/study pressure/);
  assert.match(input[1].content, /Preferred support: Someone to talk to/);
  assert.match(input[1].content, /Sleep quality: Poor/);
  for (const type of ["profile", "initial_assessment", "initial_assessment_detail", "mood", "journal", "assessment", "prediction"]) {
    assert.ok(result.context.selectedItems.some((item) => item.sourceType === type), type);
  }
  assert.deepEqual(input.slice(2), [
    { role: "user", content: legacy[0].content }, { role: "assistant", content: legacy[1].content },
    { role: "user", content: "What should I do next?" }
  ]);
  assert.equal(JSON.stringify(input).split("What should I do next?").length - 1, 1);
  assert.doesNotMatch(JSON.stringify(input), /OTHER_STUDENT/);
  assert.equal(result.assistantMessage.replyTo.toString(), result.studentMessage.id);
  assert.ok(result.context.selectedItems.every((item) => item.sourceType !== "conversation"));
  assert.equal(await WellnessContextSnapshot.countDocuments({ _id: result.context._id }), 1);
  assert.deepEqual(await ConversationMessage.find({ _id: { $in: legacy.map((item) => item._id) } }).sort({ createdAt: 1 }).lean(), beforeRecords);
  assert.equal(await ConversationMessage.countDocuments({ student: other._id }), 2);

  let followup;
  await sendAssistantMessage({ user: student, message: "Can you explain that?", generateResponse: async (args) => {
    followup = buildAssistantMessages(args);
    return "Second mock output.";
  } });
  assert.deepEqual(followup.slice(-3), [
    { role: "user", content: result.studentMessage.content },
    { role: "assistant", content: result.assistantMessage.content },
    { role: "user", content: "Can you explain that?" }
  ]);
});

test("another student's request uses only their profile, assessment and history", async () => {
  let input;
  await sendAssistantMessage({ user: other, message: "Summarize my assessment", generateResponse: async (args) => {
    input = buildAssistantMessages(args);
    return "Other student's mock output.";
  } });
  assert.match(input[1].content, /OTHER_STUDENT_GOAL|Financial concerns/);
  assert.match(input[1].content, /OTHER_STUDENT_NOTES/);
  assert.deepEqual(input.slice(2, 4), otherLegacy.map((item) => ({ role: item.role === "student" ? "user" : "assistant", content: item.content })));
  assert.doesNotMatch(JSON.stringify(input), /Improve rest|Dorm noise|quiet hours|5–6/);
});

test("missing provider credentials preserve the student message as a retryable failure; safety skips context generation", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("External calls are forbidden in this test"); });
  const beforeMessages = await ConversationMessage.countDocuments({ student: student._id });
  const beforeReplies = await ConversationMessage.countDocuments({ student: student._id, role: "assistant" });
  const failed = await request(app).post("/api/chat/messages").set(auth(student)).send({ message: "Help with sleep" }).expect(503);
  assert.match(failed.body.message, /Ollama|ollama/);
  assert.equal(await ConversationMessage.countDocuments({ student: student._id }), beforeMessages + 1);
  assert.equal(await ConversationMessage.countDocuments({ student: student._id, role: "assistant" }), beforeReplies);
  const count = await WellnessContextSnapshot.countDocuments({ student: student._id });
  const safety = await request(app).post("/api/chat/messages").set(auth(student)).send({ message: "I cannot stay safe" }).expect(201);
  assert.equal(safety.body.assistantMessage.responseSource, "safety_message");
  assert.match(safety.body.assistantMessage.content, /emergency services/);
  assert.equal(await WellnessContextSnapshot.countDocuments({ student: student._id }), count);
  assert.equal(fetchMock.mock.callCount(), 1, "only the failed provider probe runs; urgent safety skips it");
  const history = await request(app).get("/api/chat/messages").set(auth(student)).expect(200);
  assert.ok(history.body.messages.some((item) => item._id === legacy[0].id));
  await request(app).post("/api/chat/messages").send({ message: "Unauthorized" }).expect(401);
});

test("mocked local provider request context remains isolated for different students", async (t) => {
  const inputs = [];
  const provider = t.mock.method(globalThis, "fetch", async (_url, options) => { if (_url.endsWith("/api/show")) return { ok: true, json: async () => ({ details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] }) }; inputs.push(JSON.parse(options.body).messages); return { ok: true, json: async () => ({ done: true, done_reason: "stop", message: { role: "assistant", content: "A mocked provider response." } }) }; });
  const message = "I am having trouble sleeping because I keep thinking about my studies.";
  const a = await request(app).post("/api/chat/messages").set(auth(student)).send({ message }).expect(201);
  const b = await request(app).post("/api/chat/messages").set(auth(other)).send({ message }).expect(201);
  assert.equal(a.body.assistantMessage.content, "A mocked provider response.");
  assert.equal(b.body.assistantMessage.content, "A mocked provider response.");
  assert.match(JSON.stringify(inputs[0]), /Sleep quality: Poor/);
  assert.match(JSON.stringify(inputs[0]), /Academic pressure: High/);
  assert.match(JSON.stringify(inputs[1]), /Sleep quality: Good/);
  assert.match(JSON.stringify(inputs[1]), /Academic pressure: Low/);
  assert.doesNotMatch(JSON.stringify(inputs[1]), /5–6|poor sleep|Dorm noise|OTHER_STUDENT/);
  assert.doesNotMatch(JSON.stringify(inputs[0]), /OTHER_STUDENT/);
  const saved = await ConversationMessage.findById(b.body.assistantMessage._id);
  assert.equal(saved.student.toString(), other.id);
  assert.equal(saved.responseSource, "ollama");
  assert.equal(provider.mock.callCount(), 4, "each request checks the local model then generates once");
});

test("provider follow-ups use the existing conversation without repeating the current message", async (t) => {
  const inputs = [];
  const provider = t.mock.method(globalThis, "fetch", async (_url, options) => { if (_url.endsWith("/api/show")) return { ok: true, json: async () => ({ details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] }) }; inputs.push(JSON.parse(options.body).messages); return { ok: true, json: async () => ({ done: true, done_reason: "stop", message: { role: "assistant", content: "A mocked follow-up." } }) }; });
  await request(app).post("/api/chat/messages").set(auth(student)).send({ message: "My exams are making me stressed." }).expect(201);
  const followup = await request(app).post("/api/chat/messages").set(auth(student)).send({ message: "What should I do about it?" }).expect(201);
  assert.equal(followup.body.assistantMessage.content, "A mocked follow-up.");
  assert.equal(followup.body.assistantMessage.replyTo, followup.body.studentMessage._id);
  assert.equal(inputs[1].filter(item => item.content === "What should I do about it?").length, 1);
  assert.ok(inputs[1].some(item => item.content === "My exams are making me stressed."));
  assert.ok(followup.body.context.usedSources.includes("assessment"));
  assert.doesNotMatch(JSON.stringify(inputs[1]), /Sleep quality:|Dorm noise/);
  assert.equal(provider.mock.callCount(), 4, "each request checks the local model then generates once");
});


test("provider request receives selected context and student-specific history across stored sources", async () => {
  await MoodLog.insertMany([student, other].flatMap((account, index) => [1, 2, 3].map(day => ({
    student: account._id, mood: index ? "good" : "low", moodScore: index ? 4 : 2,
    stressLevel: index ? 2 : 4, sleepHours: index ? 8 : 5,
    loggedFor: new Date(Date.now() - day * 86400000)
  }))));
  await JournalEntry.create({ student: other._id, title: "OTHER_STUDENT_JOURNAL",
    content: "OTHER_STUDENT_JOURNAL: sleep and exam reflections.", sentiment: "positive" });
  await Assessment.create({ student: other._id, responses: [4, 4, 4, 4, 4], rawScore: 20, percentageScore: 80, riskLevel: "low" });
  await enterPredictionInputs(other, 2);

  for (const account of [student, other]) {
    const profile = await StudentProfile.findOne({ user: account._id });
    const moodIds = new Set((await MoodLog.find({ student: account._id })).map(item => item.id));
    const journalIds = new Set((await JournalEntry.find({ student: account._id })).map(item => item.id));
    const who5Ids = new Set((await Assessment.find({ student: account._id })).map(item => item.id));
    const prediction = await WellnessPrediction.findOne({ student: account._id });
    let requestInput;
    const message = "My sleep and exam stress concern, current request for " + account.name;
    const actualMoodLogs = await MoodLog.find({ student: account._id }).lean();
    assert.ok(summarizeMoodPattern(actualMoodLogs, { broad: false, topics: ["sleep", "academic", "stress"] }),
      `fixture mood rows=${actualMoodLogs.length}; dates=${actualMoodLogs.map(item => String(item.loggedFor)).join(",")}`);
    const candidateTypes = buildCandidates({ profile: await StudentProfile.findOne({ user: account._id }), moodLogs: actualMoodLogs,
      userMessage: message, now: new Date() }).map(item => item.sourceType);
    assert.ok(candidateTypes.includes("mood_pattern"), `candidate types=${candidateTypes.join(",")}`);
    const directContext = buildWellnessContext({ profile: await StudentProfile.findOne({ user: account._id }), moodLogs: actualMoodLogs,
      userMessage: message, now: new Date(), tokenBudget: 900, maxItems: 8 });
    assert.ok(directContext.selectedItems.some(item => item.sourceType === "mood_pattern"),
      `direct selected=${directContext.selectedItems.map(item => item.sourceType).join(",")}; candidates=${directContext.candidateCount}`);
    const result = await sendAssistantMessage({ user: account, message,
      generateResponse: async args => { requestInput = args; return "A mocked provider response."; } });
    assert.equal(result.assistantMessage.responseSource, "ollama");
    assert.equal(requestInput.prompt, result.context.structuredPrompt);
    assert.ok(result.context.estimatedTokens <= 900, "retrieved context fits the local inference budget");
    const providerInput = buildAssistantMessages(requestInput);
    assert.equal(providerInput.filter(item => item.content === message).length, 1);
    assert.doesNotMatch(result.context.structuredPrompt, /current request for/);
    assert.equal(result.context.student.toString(), account.id);
    for (const item of result.context.selectedItems) {
      assert.ok(item.selectionReason);
      if (["profile", "initial_assessment", "initial_assessment_detail"].includes(item.sourceType)) assert.equal(item.sourceId, profile.id);
      if (item.sourceType === "mood") assert.ok(moodIds.has(item.sourceId));
      if (item.sourceType === "journal") assert.ok(journalIds.has(item.sourceId));
      if (item.sourceType === "assessment") assert.ok(who5Ids.has(item.sourceId));
      if (item.sourceType === "prediction") assert.equal(item.sourceId, prediction.id);
      if (item.sourceType === "mood_pattern") assert.ok(item.sourceIds.every(id => moodIds.has(id)));
    }
    for (const type of ["initial_assessment", "initial_assessment_detail", "mood", "mood_pattern", "journal", "assessment", "prediction"]) {
      assert.ok(result.context.selectedItems.some(item => item.sourceType === type), `${type}; candidates=${result.context.candidateCount}; selected=${result.context.selectedItems.map(item => item.sourceType).join(",")}; tokens=${result.context.estimatedTokens}`);
    }
    const bundle = JSON.stringify(providerInput);
    if (account === student) assert.doesNotMatch(bundle, /OTHER_STUDENT/);
    else assert.doesNotMatch(bundle, /Dorm noise|quiet hours|5–6/);
    const latest = await request(app).get("/api/intelligence/context/me").set(auth(account)).expect(200);
    assert.equal(latest.body.context._id, result.context.id);
    assert.ok(latest.body.context.selectedItems.find(item => item.sourceType === "mood_pattern").sourceIds.length >= 3);
  }
});

test("long conversational history stays bounded while valid mood_pattern remains in the authorized wellness context", async () => {
  const now = Date.now();
  const conversation = new mongoose.Types.ObjectId().toString();
  await MoodLog.insertMany([1, 2, 3, 4].map(day => ({ student: student._id, mood: "low", moodScore: 2,
    stressLevel: 4, sleepHours: 5, loggedFor: new Date(now - day * 86400000) })));
  const pairs = Array.from({ length: 24 }, (_, index) => [
    { student: student._id, conversation, role: "student", content: `LONG_HISTORY_STUDENT_${index} ${"prior context ".repeat(10)}`, createdAt: new Date(now - (50 - index) * 1000) },
    { student: student._id, conversation, role: "assistant", content: `LONG_HISTORY_REPLY_${index} ${"support reply ".repeat(10)}`, createdAt: new Date(now - (49 - index) * 1000) }
  ]).flat();
  await ConversationMessage.insertMany(pairs);
  let requestArgs;
  const message = "My sleep has been difficult lately.";
  const result = await sendAssistantMessage({ user: student, conversation, message, generateResponse: async args => {
    requestArgs = args;
    return "A mocked provider response.";
  } });
  assert.ok(result.context.selectedItems.some(item => item.sourceType === "mood_pattern"));
  assert.ok(result.context.selectedItems.find(item => item.sourceType === "mood_pattern").sourceIds.length >= 4);
  assert.ok(result.context.estimatedTokens <= 900);
  assert.ok(requestArgs.recentConversation.length <= 8);
  assert.ok(estimateTokens(JSON.stringify(requestArgs.recentConversation)) <= 700);
  assert.ok(requestArgs.recentConversation.some(item => item.content.includes("LONG_HISTORY_STUDENT_23")),
    JSON.stringify(requestArgs.recentConversation.map(item => ({ role: item.role, content: item.content.slice(0, 48) }))));
  assert.equal(requestArgs.recentConversation.some(item => item.content.includes("LONG_HISTORY_STUDENT_0")), false);
  assert.equal(result.context.student.toString(), student.id);
});

test("topic changes exclude old personal topics, while general requests omit private records", async (t) => {
  const inputs = [];
  mockProvider(t, input => inputs.push(input));
  const social = await request(app).post("/api/chat/messages").set(auth(student)).send({ message: "I feel lonely" }).expect(201);
  assert.ok(social.body.context.usedSources.includes("initial_assessment"));
  assert.doesNotMatch(JSON.stringify(inputs[0]), /Academic pressure|Sleep quality|Dorm noise|Stress type:/);
  let providerInput;
  const generic = await sendAssistantMessage({ user: student, message: "What is sleep hygiene?",
    generateResponse: async args => { providerInput = buildAssistantMessages(args); return "A mocked provider response."; } });
  assert.equal(generic.context.selectedItems.length, 0);
  assert.doesNotMatch(generic.context.structuredPrompt, /Department:|Name:|Preferred support|Mood score/);
  assert.equal(providerInput.at(-1).content, "What is sleep hygiene?");
  const history = providerInput.slice(2, -1);
  assert.ok(history.length <= 8);
  assert.ok(history.every((message, index) => message.role === (index % 2 ? "assistant" : "user")));
  const followup = await request(app).post("/api/chat/messages").set(auth(student)).send({ message: "Tell me more" }).expect(201);
  assert.ok(followup.body.context.usedSources.includes("initial_assessment"));
  assert.equal(followup.body.assistantMessage.content, "A mocked provider response.");
});

test("mood-pattern provenance invalidates snapshots after editing or deleting an aggregate-only source without touching another student", async () => {
  await MoodLog.insertMany([1, 2, 3].map(day => ({ student: student._id, mood: "low", moodScore: 2,
    stressLevel: 4, sleepHours: 5, loggedFor: new Date(Date.now() - day * 86400000) })));
  const snapshot = await generateWellnessContext({ user: student, userMessage: "Help with my sleep" });
  const pattern = snapshot.selectedItems.find(item => item.sourceType === "mood_pattern");
  const individualIds = new Set(snapshot.selectedItems.map(item => item.sourceId));
  const aggregateOnly = pattern.sourceIds.find(id => !individualIds.has(id));
  assert.ok(aggregateOnly);
  const otherSnapshots = await WellnessContextSnapshot.countDocuments({ student: other._id });
  await request(app).put("/api/tracking/moods/" + aggregateOnly).set(auth(other)).send({ stressLevel: 3 }).expect(404);
  assert.ok(await WellnessContextSnapshot.findById(snapshot.id));
  await request(app).put("/api/tracking/moods/" + aggregateOnly).set(auth(student)).send({ stressLevel: 3 }).expect(200);
  assert.equal(await WellnessContextSnapshot.findById(snapshot.id), null);
  assert.equal(await WellnessContextSnapshot.countDocuments({ student: other._id }), otherSnapshots);
  const refreshed = await generateWellnessContext({ user: student, userMessage: "Help with my sleep" });
  await request(app).delete("/api/tracking/moods/" + aggregateOnly).set(auth(student)).expect(204);
  assert.equal(await WellnessContextSnapshot.findById(refreshed.id), null);
  const final = await generateWellnessContext({ user: student, userMessage: "Help with my sleep" });
  assert.ok(final.selectedItems.every(item => item.sourceId !== aggregateOnly && !item.sourceIds?.includes(aggregateOnly)));
  assert.equal(await WellnessContextSnapshot.countDocuments({ student: other._id }), otherSnapshots);
});

test("context generation rejects a missing authenticated student before any database lookup", async t => {
  const lookup = t.mock.method(StudentProfile, "findOne", () => { throw new Error("Must not query without a student"); });
  await assert.rejects(generateWellnessContext({ user: {}, userMessage: "Help with sleep" }), { statusCode: 401 });
  assert.equal(lookup.mock.callCount(), 0);
});

test("REST duration follow-up and next action retain sleep context, pairing, privacy and persistence", async t => {
  const inputs = [];
  const provider = mockProvider(t, input => inputs.push(input));
  const replies = [];
  for (const message of ["I am having trouble sleeping.", "It has been happening for the last few days.", "What should I do about this?"]) {
    const { body } = await request(app).post("/api/chat/messages").set(auth(student)).send({ message }).expect(201);
    assert.equal(body.assistantMessage.responseSource, "ollama");
    assert.equal(body.assistantMessage.replyTo, body.studentMessage._id);
    assert.match(JSON.stringify(inputs.at(-1)), /Sleep quality: Poor/);
    assert.doesNotMatch(JSON.stringify(inputs.at(-1)), /Academic pressure:|OTHER_STUDENT/);
    assert.equal(inputs.at(-1).filter(item => item.content === message).length, 1);
    assert.equal(body.assistantMessage.content, "A mocked provider response.");
    replies.push(body);
  }
  const login = await request(app).post("/api/auth/login").send({ email: student.email, password: "test-only-password" }).expect(200);
  const saved = await request(app).get("/api/chat/messages?limit=100").set("Authorization", "Bearer " + login.body.token).expect(200);
  assert.deepEqual(saved.body.messages.slice(-6).map(item => item._id), replies.flatMap(reply => [reply.studentMessage._id, reply.assistantMessage._id]));
  assert.equal(provider.mock.callCount(), 6, "each message checks the local model then generates once");
});

test("REST general questions omit private records; whitespace is rejected without persistence", async t => {
  const inputs = [];
  mockProvider(t, input => inputs.push(input));
  const total = await ConversationMessage.countDocuments({ student: student._id });
  await request(app).post("/api/chat/messages").set(auth(student)).send({ message: " \n\t " }).expect(400);
  assert.equal(await ConversationMessage.countDocuments({ student: student._id }), total);
  for (const message of ["Can you suggest a study technique for mathematics?", "What should I do about this?"]) {
    const { body } = await request(app).post("/api/chat/messages").set(auth(student)).send({ message }).expect(201);
    assert.deepEqual(body.context.usedSources, []);
    assert.doesNotMatch(JSON.stringify(inputs.at(-1)), /poor sleep|5–6|Dorm noise|saved estimate/);
  }
});

test("suicidal wording bypasses wellness context generation, and chat history remains student-scoped", async () => {
  const before = await WellnessContextSnapshot.countDocuments({ student: student._id });
  const { body } = await request(app).post("/api/chat/messages").set(auth(student)).send({ message: "I feel suicidal" }).expect(201);
  assert.equal(body.assistantMessage.responseSource, "safety_message");
  assert.match(body.assistantMessage.content, /emergency services/);
  assert.equal(await WellnessContextSnapshot.countDocuments({ student: student._id }), before);
  const history = await request(app).get("/api/chat/messages?student=" + student.id).set(auth(other)).expect(200);
  assert.ok(history.body.messages.every(item => item.student === other.id));
  assert.ok(!history.body.messages.some(item => item._id === body.assistantMessage._id));
});

test("REST history uses stable chronological ID order when timestamps tie", async () => {
  const rows = await ConversationMessage.insertMany([
    { student: other._id, role: "student", content: "Tie-order question", createdAt: new Date() },
    { student: other._id, role: "assistant", content: "Tie-order answer", createdAt: new Date() }
  ]);
  const stamp = new Date();
  await ConversationMessage.collection.updateMany({ _id: { $in: rows.map(row => row._id) } }, { $set: { createdAt: stamp } });
  const history = await request(app).get("/api/chat/messages?limit=2").set(auth(other)).expect(200);
  assert.deepEqual(history.body.messages.map(item => item._id), rows.map(row => row.id));
});

test("provider failure preserves the student message and does not create a false assistant reply", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 503 }));
  const { body } = await request(app).post("/api/chat/messages").set(auth(student)).send({ message: "I am having trouble sleeping." }).expect(503);
  assert.match(body.message, /Could not connect|Local AI/);
  const saved = await ConversationMessage.findOne({ student: student._id, role: "student", content: "I am having trouble sleeping." }).sort({ createdAt: -1 });
  assert.ok(saved);
  assert.equal(await ConversationMessage.countDocuments({ student: student._id, replyTo: saved._id }), 0);
  assert.equal(saved.student.toString(), student.id);
  assert.equal(provider.mock.callCount(), 1);
});

test("retry reuses the saved user message and stores one successful assistant reply", async t => {
  let chatCalls = 0;
  const provider = t.mock.method(globalThis, "fetch", async (_url) => {
    if (_url.endsWith("/api/show")) return { ok: true, json: async () => ({ details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] }) };
    chatCalls += 1;
    return chatCalls === 1
      ? { ok: false, status: 503 }
      : { ok: true, json: async () => ({ done: true, done_reason: "stop", message: { role: "assistant", content: "A real-shaped response after retry." } }) };
  });
  const clientMessageId = "15f8cb5d-fce3-495a-9fdb-e9bf84d265a1";
  const payload = { message: "I am having trouble sleeping.", clientMessageId };
  await request(app).post("/api/chat/messages").set(auth(student)).send(payload).expect(503);
  const savedBeforeRetry = await ConversationMessage.find({ student: student._id, clientMessageId });
  assert.equal(savedBeforeRetry.length, 1);
  assert.equal(savedBeforeRetry[0].role, "student");

  const retried = await request(app).post("/api/chat/messages").set(auth(student)).send(payload).expect(201);
  assert.equal(retried.body.studentMessage._id, savedBeforeRetry[0].id);
  assert.equal(retried.body.assistantMessage.content, "A real-shaped response after retry.");
  assert.equal(await ConversationMessage.countDocuments({ student: student._id, clientMessageId }), 1);
  assert.equal(await ConversationMessage.countDocuments({ student: student._id, replyTo: savedBeforeRetry[0]._id }), 1);
  assert.equal(chatCalls, 2);
  assert.equal(provider.mock.callCount(), 4);
});
