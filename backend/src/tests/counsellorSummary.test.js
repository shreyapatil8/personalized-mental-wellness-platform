import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import StudentProfile from "../models/StudentProfile.js";
import { createAuthToken } from "../utils/tokens.js";
import { initialWellnessContract } from "../utils/initialWellnessAssessment.js";
import { DEPARTMENTS, STUDENT_YEARS } from "../constants/studentOptions.js";
import { getStressModelIdentity, predictionKey } from "../services/stressPredictionService.js";
import { minimumAppointmentTime, isFutureAppointmentSlot, toLocalDateTimeInput } from "../../../frontend/src/utils/appointmentTime.js";

// Never load .env or connect to the application database.
process.env.NODE_ENV = "test";
process.env.COUNSELLOR_BRIEFING_PROVIDER = "ollama";
process.env.OLLAMA_MODEL = "qwen3:1.7b";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
process.env.JWT_SECRET = "isolated-counsellor-summary-test-secret-at-least-32-characters";
delete process.env.OPENAI_API_KEY;
let database, student, other, counsellor, unrelatedCounsellor, adminHeaders, appointmentId;
const { default: ConversationMessage } = await import("../models/ConversationMessage.js");
const { default: WellnessPrediction } = await import("../models/WellnessPrediction.js");
const { stressSurveyContract } = await import("../utils/stressSurvey.js");
let answers, slotNumber = 0;
const profileInput = { rollNumber: "1234", urn: "12345678", department: DEPARTMENTS[0], year: STUDENT_YEARS[0], wellnessGoals: ["Improve sleep"], consentForCounsellorSummary: true };
const draft = "Current context\nThe student reported poor sleep in the initial assessment.\nAreas to explore\nAsk how rest feels now. [SIMULATED PROVIDER TEST OUTPUT]";
const route = id => `/api/counselling/appointments/${id}/summary`;
async function book(account = student, concernType = "sleep") {
  const date = new Date(Date.now() + 86400000 * 2); date.setUTCHours(10, (++slotNumber) * 30, 0, 0);
  const result = await request(app).post("/api/counselling/appointments").set(account.headers).send({ counsellorId: counsellor.id, scheduledFor: date.toISOString(), concernType, shareSummary: true }).expect(201);
  return result.body.appointment._id;
}
const localMetadata = { details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] };
const localReply = content => ({ done: true, done_reason: "stop", message: { role: "assistant", content } });
function mockTransport(t, chat) {
  return t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).origin, "http://127.0.0.1:11434", "No cloud requests");
    if (url.endsWith("/api/show")) {
      assert.deepEqual(JSON.parse(options.body), { model: "qwen3:1.7b" });
      return { ok: true, json: async () => localMetadata };
    }
    assert.ok(url.endsWith("/api/chat"));
    return chat(url, options);
  });
}
function mockProvider(t, response = draft) {
  return mockTransport(t, async () => ({ ok: true, json: async () => localReply(response) }));
}
const password = "disposable-test-password";

async function registerAndLogin(name, role) {
  const email = `${name}@workflow.test`;
  await request(app).post("/api/auth/register").send({ name, email, password, role }).expect(201);
  if (role === "counsellor") {
    const account = await User.findOne({ email });
    await request(app).patch(`/api/admin/users/${account.id}/status`).set(adminHeaders).send({ isActive: true }).expect(200);
  }
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id: login.body.user.id, headers: { Authorization: `Bearer ${login.body.token}` } };
}

before(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri());
  await User.init();
  await Appointment.init();
  await WellnessPrediction.init();
  const admin = await User.create({ name: "Test Admin", email: "admin@workflow.test", password, role: "admin" });
  adminHeaders = { Authorization: `Bearer ${createAuthToken(admin)}` };
  student = await registerAndLogin("Student", "student");
  other = await registerAndLogin("Other", "student");
  counsellor = await registerAndLogin("Counsellor", "counsellor");
  unrelatedCounsellor = await registerAndLogin("Unrelated", "counsellor");
}, { timeout: 180000 });

after(async () => { await mongoose.disconnect(); await database?.stop(); });

test("pending appointment exposes permitted factual data but unavailable Ollama never generates a narrative", async t => {
  const network = t.mock.method(globalThis, "fetch", async (url) => { assert.equal(new URL(url).origin, "http://127.0.0.1:11434"); throw new Error("Ollama is offline"); });
  answers = { ...Object.fromEntries(initialWellnessContract.questions.filter(q => !q.optional).map(q => [q.id, q.options[2]])), sleepQuality: "Poor", sleepHours: "5–6", additionalNotes: "I would like help with my sleep routine." };
  for (const account of [student, other]) {
    await request(app).put("/api/profile/me").set(account.headers).send({ ...profileInput, rollNumber: account === student ? "1234" : "5678", urn: account === student ? "12345678" : "87654321", wellnessGoals: account === student ? ["Improve sleep"] : ["OTHER_STUDENT_GOAL"] }).expect(200);
    await request(app).put("/api/profile/me/initial-assessment").set(account.headers).send({ schemaVersion: initialWellnessContract.version, responses: account === student ? answers : { ...answers, sleepQuality: "Very good", sleepHours: "More than 8", additionalNotes: "OTHER_STUDENT_SECRET" } }).expect(200);
  }
  for (let day = 1; day <= 3; day++) await request(app).post("/api/tracking/moods").set(student.headers).send({ mood: "low", stressLevel: 4, sleepHours: 5, loggedFor: new Date(Date.now() - day * 86400000) }).expect(201);
  await request(app).post("/api/tracking/assessments").set(student.headers).send({ responses: [2, 3, 2, 3, 2] }).expect(201);
  await request(app).post("/api/tracking/journals").set(student.headers).send({ title: "Rest", content: "Sleep was interrupted by noise. PRIVATE_JOURNAL_PHRASE", tags: ["sleep"] }).expect(201);
  await request(app).post("/api/tracking/journals").set(student.headers).send({ title: "Career", content: "UNRELATED_CAREER_MARKER: interview practice.", tags: ["career"] }).expect(201);
  await request(app).post("/api/tracking/journals").set(other.headers).send({ content: "OTHER_STUDENT_JOURNAL: sleep was restful." }).expect(201);
  await ConversationMessage.create({ student: student.id, role: "student", content: "PRIVATE_ASSISTANT_CONVERSATION_SLEEP" });
  const surveyAnswers = Object.fromEntries(stressSurveyContract.questions.map(q => [q.id, 3]));
  const surveyResult = await request(app).post("/api/predictions/survey").set(student.headers).send({ answers: surveyAnswers }).expect(201);
  // Test only briefing consumption of a valid saved estimate, not Python inference.
  // This explicitly simulated fixture lives in disposable MongoDB.
  const { modelSha256 } = await getStressModelIdentity();
  const surveyId = surveyResult.body.survey._id;
  await WellnessPrediction.create({ student: student.id, survey: surveyId, surveyAnswers,
    riskCategory: "distress", confidence: 0.8, modelSource: "trained_model", modelName: "simulated-test-estimate",
    schemaVersion: stressSurveyContract.version, modelSha256, datasetSha256: "a".repeat(64),
    predictionKey: predictionKey(student.id, surveyId, surveyAnswers, modelSha256), reasons: ["Simulated briefing fixture"] });
  appointmentId = await book();
  const { body } = await request(app).get(route(appointmentId)).set(counsellor.headers).expect(200);
  assert.equal(body.summary.consentGranted, true);
  assert.equal(body.summary.aiSummary.availability, "provider_unavailable");
  assert.equal(body.summary.narrative, null);
  assert.ok(body.summary.sourceCount > 0);
  assert.equal(body.summary.initialAssessment.responses.find(r => r.id === "sleepQuality").response, "Poor");
  assert.equal(body.summary.assessmentNote, answers.additionalNotes);
  assert.deepEqual(body.summary.latestAssessment.answers.map(item => item.response), [2, 3, 2, 3, 2]);
  assert.equal(body.summary.latestAssessment.resultBand, "moderate");
  const unavailable = await request(app).post(route(appointmentId)).set(counsellor.headers).expect(503);
  assert.match(unavailable.body.message, /Local AI is unavailable/);
  assert.equal(network.mock.callCount(), 2);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_ASSISTANT_CONVERSATION|PRIVATE_SLEEP_BASELINE|PRIVATE_JOURNAL_PHRASE|OTHER_STUDENT/);
});

test("approved session generates and persists an Ollama-labelled draft from bounded authorized evidence using simulated transport", async t => {
  const base = `/api/counselling/appointments/${appointmentId}`;
  await request(app).patch(base + "/status").set(counsellor.headers).send({ status: "approved" }).expect(200);
  await request(app).patch(base + "/notes").set(counsellor.headers).send({ counsellorNotes: "PRIVATE_COUNSELLOR_NOTE", progressUpdate: "Shared wind-down discussion" }).expect(200);
  let sent;
  mockTransport(t, async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => localReply(draft) };
  });
  const { body } = await request(app).post(route(appointmentId)).set(counsellor.headers).expect(200);
  assert.equal(sent.stream, false);
  assert.equal(sent.messages.length, 2);
  const prompt = sent.messages[1].content;
  assert.match(prompt, /Appointment concern: sleep and rest/);
  for (const evidence of [/Sleep quality: Poor/, /Goals: Improve sleep/, /Mood score|check-ins/, /Student journal themes: sleep/, /Stress type:/]) assert.match(prompt, evidence);
  assert.match(prompt, /not a diagnosis or clinical severity/);
  assert.match(prompt, /I would like help with my sleep routine/);
  assert.doesNotMatch(prompt, /PRIVATE_ASSISTANT_CONVERSATION|PRIVATE_COUNSELLOR_NOTE|PRIVATE_SLEEP_BASELINE|PRIVATE_JOURNAL_PHRASE|OTHER_STUDENT|UNRELATED_CAREER_MARKER|@workflow.test/);
  assert.match(sent.messages[0].content, /Do not invent symptoms/);
  assert.match(sent.messages[0].content, /without quoting journal text verbatim/);
  assert.match(sent.messages[0].content, /comparable dated observations/);
  assert.ok(prompt.length < 9000);
  assert.equal(body.summary.narrative.source, "ollama");
  assert.equal(body.summary.narrative.text, draft);
  assert.equal(body.summary.narrative.validation, "unverified", "generated prose is never promoted to verified fact");
  assert.ok(body.summary.narrative.generatedAt);
  assert.equal(body.summary.initialAssessment.responses.length, 14);
  assert.deepEqual(body.summary.journalSignals.map(item => item.themes), [["sleep"]]);
  assert.doesNotMatch(JSON.stringify(body.summary.journalSignals), /Career|PRIVATE_JOURNAL_PHRASE|UNRELATED_CAREER_MARKER/);
  assert.doesNotMatch(JSON.stringify(body.summary.narrative), /PRIVATE_JOURNAL_PHRASE|digest|token/);
  const saved = await request(app).get(route(appointmentId)).set(counsellor.headers).expect(200);
  assert.equal(saved.body.summary.narrative.text, draft);
  const studentView = await request(app).get("/api/counselling/appointments").set(student.headers).expect(200);
  assert.doesNotMatch(JSON.stringify(studentView.body), /PRIVATE_COUNSELLOR_NOTE|SIMULATED PROVIDER|generatedSummary/);
  assert.match(JSON.stringify(studentView.body), /Shared wind-down discussion/);
});

test("unsupported model numbers and classifier labels remain unverified and cannot alter backend facts", async t => {
  const contradictory = "Mood score increased to 99/5. The classifier returned high risk.";
  mockProvider(t, contradictory);
  const { body } = await request(app).post(route(appointmentId)).set(counsellor.headers).expect(200);
  const summary = body.summary;
  assert.equal(summary.narrative.text, contradictory);
  assert.equal(summary.narrative.validation, "unverified");
  assert.ok(summary.mood.entries >= 3);
  assert.ok(summary.mood.trend.every(item => item.moodScore >= 1 && item.moodScore <= 5));
  assert.equal(summary.latestPrediction.label, "distress");
  assert.doesNotMatch(JSON.stringify({ mood: summary.mood, latestPrediction: summary.latestPrediction }), /99\/5|high risk/);
});

test("overlapping requests do not start a second briefing generation", async t => {
  await request(app).put("/api/profile/me").set(student.headers).send(profileInput).expect(200);
  let started, release;
  const generationStarted = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Local generation did not start.")), 10000);
    started = () => { clearTimeout(timer); resolve(); };
  });
  const waitForRelease = new Promise(resolve => { release = resolve; });
  const concurrentAppointmentId = await book();
  const concurrentRoute = route(concurrentAppointmentId);
  const provider = mockTransport(t, async (_url, options) => {
    if (JSON.parse(options.body).model === "qwen3:1.7b") {
      started();
      await waitForRelease;
      return { ok: true, json: async () => localReply(draft) };
    }
    return { ok: true, json: async () => localReply(draft) };
  });
  const first = request(app).post(concurrentRoute).set(counsellor.headers).then(response => response);
  try {
    await generationStarted;
    await request(app).post(concurrentRoute).set(counsellor.headers).expect(409);
  } finally { release(); }
  assert.equal((await first).status, 200);
  assert.equal(provider.mock.callCount(), 3, "one generation performs two metadata checks and one chat request");
});

test("role, assigned ownership, both consents and student isolation gate GET and POST", async t => {
  const provider = mockProvider(t);
  for (const method of ["get", "post"]) {
    await request(app)[method](route(appointmentId)).expect(401);
    await request(app)[method](route(appointmentId)).set(student.headers).expect(403);
    await request(app)[method](route(appointmentId)).set(adminHeaders).expect(403);
    await request(app)[method](route(appointmentId)).set(unrelatedCounsellor.headers).expect(404);
  }
  await request(app).patch(`/api/counselling/appointments/${appointmentId}/sharing`).set(student.headers).send({ shareSummary: false }).expect(200);
  assert.equal((await request(app).post(route(appointmentId)).set(counsellor.headers).expect(200)).body.summary.consentGranted, false);
  await request(app).patch(`/api/counselling/appointments/${appointmentId}/sharing`).set(student.headers).send({ shareSummary: true }).expect(200);
  await request(app).put("/api/profile/me").set(student.headers).send({ ...profileInput, consentForCounsellorSummary: false }).expect(200);
  const denied = await request(app).get(route(appointmentId)).set(counsellor.headers).expect(200);
  assert.deepEqual(Object.keys(denied.body.summary).sort(), ["consentGranted", "message"]);
  assert.equal((await request(app).post(route(appointmentId)).set(counsellor.headers).expect(200)).body.summary.consentGranted, false);
  assert.equal(provider.mock.callCount(), 0);
  await request(app).put("/api/profile/me").set(student.headers).send(profileInput).expect(200);
  const otherId = await book(other);
  provider.mock.restore();
  mockTransport(t, async (_url, options) => {
    const prompt = JSON.parse(options.body).messages[1].content;
    assert.match(prompt, /Sleep quality: Very good/);
    assert.doesNotMatch(prompt, /Sleep quality: Poor|PRIVATE_JOURNAL_PHRASE|PRIVATE_COUNSELLOR|PRIVATE_ASSISTANT/);
    return { ok: true, json: async () => localReply("[TEST TRANSPORT] The student reported very good sleep.") };
  });
  await request(app).post(route(otherId)).set(counsellor.headers).expect(200);
});

test("new records invalidate the prompt digest and hide stale cached drafts", async t => {
  mockProvider(t);
  await request(app).post(route(appointmentId)).set(counsellor.headers).expect(200);
  await request(app).post("/api/tracking/moods").set(student.headers).send({ mood: "great", stressLevel: 1, sleepHours: 8 }).expect(201);
  const result = await request(app).get(route(appointmentId)).set(counsellor.headers).expect(200);
  assert.equal(result.body.summary.narrative, null);
  assert.equal(result.body.summary.aiSummary.stale, true);
  await request(app).post(route(appointmentId)).set(counsellor.headers).expect(200);
  await request(app).put("/api/profile/me/initial-assessment").set(student.headers).send({ schemaVersion: initialWellnessContract.version, responses: { ...answers, sleepQuality: "Good" } }).expect(200);
  assert.equal((await request(app).get(route(appointmentId)).set(counsellor.headers).expect(200)).body.summary.narrative, null);
});

test("changed source records during generation cause 409 and no obsolete narrative is returned or saved", async t => {
  mockTransport(t, async () => {
    await request(app).put("/api/profile/me/initial-assessment").set(student.headers).send({ schemaVersion: initialWellnessContract.version, responses: { ...answers, sleepQuality: "Very good" } }).expect(200);
    return { ok: true, json: async () => localReply(draft) };
  });
  const result = await request(app).post(route(appointmentId)).set(counsellor.headers).expect(409);
  assert.match(result.body.message, /changed/);
  assert.equal((await request(app).get(route(appointmentId)).set(counsellor.headers).expect(200)).body.summary.narrative, null);
});

test("consent revoked during generation withholds the entire result", async t => {
  mockTransport(t, async () => {
    await request(app).patch(`/api/counselling/appointments/${appointmentId}/sharing`).set(student.headers).send({ shareSummary: false }).expect(200);
    return { ok: true, json: async () => localReply(draft) };
  });
  const result = await request(app).post(route(appointmentId)).set(counsellor.headers).expect(200);
  assert.equal(result.body.summary.consentGranted, false);
  assert.equal(result.body.summary.narrative, undefined);
  assert.equal((await Appointment.findById(appointmentId).select("+generatedSummary")).generatedSummary, undefined);
  await request(app).patch(`/api/counselling/appointments/${appointmentId}/sharing`).set(student.headers).send({ shareSummary: true }).expect(200);
});

test("provider errors, timeout, malformed and empty output never become fake summaries", async t => {
  for (const implementation of [
    async () => ({ ok: false, status: 429 }), async () => { throw new DOMException("Timeout", "TimeoutError"); },
    async () => ({ ok: true, json: async () => ({ output_text: "  " }) }),
    async () => ({ ok: true, json: async () => ({ output: {} }) }),
    async () => ({ ok: true, json: async () => ({ ...localReply("Partial"), done: false }) })
  ]) {
    const provider = mockTransport(t, implementation);
    await request(app).post(route(appointmentId)).set(counsellor.headers).expect(503);
    provider.mock.restore();
    const factual = await request(app).get(route(appointmentId)).set(counsellor.headers).expect(200);
    assert.equal(factual.body.summary.consentGranted, true);
    assert.equal(factual.body.summary.narrative, null);
  }
});

test("profile consent revoked during the metadata probe prevents any prompt from being sent", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.ok(url.endsWith("/api/show"));
    assert.deepEqual(JSON.parse(options.body), { model: "qwen3:1.7b" });
    await StudentProfile.updateOne({ user: student.id }, { consentForCounsellorSummary: false });
    return { ok: true, json: async () => localMetadata };
  });
  t.after(async () => { await StudentProfile.updateOne({ user: student.id }, { consentForCounsellorSummary: true }); });
  const response = await request(app).post(route(appointmentId)).set(counsellor.headers).expect(200);
  assert.equal(response.body.summary.consentGranted, false);
  assert.equal(response.body.summary.narrative, undefined);
  assert.equal(calls, 1);
});

test("changing providers hides previously cached drafts without invoking the other provider", async t => {
  mockProvider(t);
  await request(app).post(route(appointmentId)).set(counsellor.headers).expect(200);
  process.env.COUNSELLOR_BRIEFING_PROVIDER = "openai";
  delete process.env.COUNSELLOR_BRIEFING_ALLOW_CLOUD;
  t.after(() => { process.env.COUNSELLOR_BRIEFING_PROVIDER = "ollama"; });
  const response = await request(app).get(route(appointmentId)).set(counsellor.headers).expect(200);
  assert.equal(response.body.summary.narrative, null);
  assert.equal(response.body.summary.aiSummary.canGenerate, false);
  await request(app).post(route(appointmentId)).set(counsellor.headers).expect(503);
});

test("empty evidence and closed appointments cannot invoke AI; existing pending/approved restrictions remain", async t => {
  const provider = mockProvider(t);
  const empty = await registerAndLogin("Empty", "student");
  await request(app).put("/api/profile/me").set(empty.headers).send({ ...profileInput, rollNumber: "2468", urn: "24682468", wellnessGoals: [] }).expect(200);
  const emptyId = await book(empty);
  const result = await request(app).get(route(emptyId)).set(counsellor.headers).expect(200);
  assert.equal(result.body.summary.aiSummary.availability, "insufficient_data");
  assert.equal(result.body.summary.initialAssessment, null);
  assert.equal(result.body.summary.narrative, null);
  await request(app).post(route(emptyId)).set(counsellor.headers).expect(422);
  for (const status of ["completed", "cancelled"]) {
    const id = await book();
    await request(app).patch(`/api/counselling/appointments/${id}/status`).set(counsellor.headers).send({ status: "approved" }).expect(200);
    await request(app).patch(`/api/counselling/appointments/${id}/status`).set(counsellor.headers).send({ status }).expect(200);
    await request(app).get(route(id)).set(counsellor.headers).expect(404);
    await request(app).post(route(id)).set(counsellor.headers).expect(404);
  }
  assert.equal(provider.mock.callCount(), 0);
});
