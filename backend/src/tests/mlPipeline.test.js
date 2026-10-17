import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../models/User.js";
import StressSurvey from "../models/StressSurvey.js";
import WellnessPrediction from "../models/WellnessPrediction.js";
import WellnessContextSnapshot from "../models/WellnessContextSnapshot.js";
import { stressSurveyContract } from "../utils/stressSurvey.js";
import { initialWellnessContract } from "../utils/initialWellnessAssessment.js";
import { getCurrentStressPrediction, getStressModelIdentity } from "../services/stressPredictionService.js";
import { sendAssistantMessage } from "../services/assistantService.js";
import { buildAssistantMessages } from "../services/assistantPromptService.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "isolated-ml-pipeline-test-secret-at-least-32-characters";
delete process.env.ML_MODEL_PATH;
delete process.env.PYTHON_EXECUTABLE;
let database, a, b, predictionA, predictionB, surveyA;
const answersA = Object.fromEntries(stressSurveyContract.questions.map((q, i) => [q.id, i % 5 + 1]));
const answersB = Object.fromEntries(stressSurveyContract.questions.map((q, i) => [q.id, 5 - i % 5]));
const changedAnswers = { ...answersA, survey_04: 5 };
const initialAnswers = Object.fromEntries(initialWellnessContract.questions.filter(q => !q.optional).map(q => [q.id, q.options[2]]));

async function student(name) {
  const data = { name, email: name.toLowerCase() + "@ml-pipeline.test", password: "test-only-password" };
  await request(app).post("/api/auth/register").send(data).expect(201);
  const login = await request(app).post("/api/auth/login").send({ email: data.email, password: data.password }).expect(200);
  return { user: await User.findById(login.body.user.id), auth: { Authorization: "Bearer " + login.body.token } };
}
async function context(account, message) {
  return (await request(app).post("/api/intelligence/context/me").set(account.auth).send({ userMessage: message }).expect(201)).body.context;
}
function mockProvider(t) {
  t.mock.method(globalThis, "fetch", async url => url.endsWith("/api/show")
    ? ({ ok: true, json: async () => ({ details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] }) })
    : ({ ok: true, json: async () => ({ done: true, done_reason: "stop", message: { role: "assistant", content: "A mocked provider response." } }) }));
}

before(async () => {
  // Never load .env or connect to the existing application database.
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri());
  await WellnessPrediction.init();
  a = await student("FreshA");
  b = await student("FreshB");
}, { timeout: 180000 });
after(async () => { await mongoose.disconnect(); await database?.stop(); });

test("initial assessment and profile are not fabricated into missing ML features", async () => {
  await request(app).put("/api/profile/me/initial-assessment").set(a.auth)
    .send({ schemaVersion: initialWellnessContract.version, responses: initialAnswers }).expect(200);
  await request(app).post("/api/predictions/me").set(a.auth).expect(422);
  for (const answers of [initialAnswers, {}, { ...answersA, latestWho5Score: 40 }, { ...answersA, survey_04: "Poor" }]) {
    await request(app).post("/api/predictions/survey").set(a.auth).send({ answers }).expect(400);
  }
  assert.equal(await WellnessPrediction.countDocuments(), 0);
  assert.equal((await context(a, "I feel stressed about exams")).selectedItems.some(i => i.sourceType === "prediction"), false);
});

test("new API-entered survey produces a stored, timestamped, versioned estimate from the actual model", async () => {
  surveyA = (await request(app).post("/api/predictions/survey").set(a.auth).send({ answers: answersA }).expect(201)).body.survey;
  await context(a, "I feel stressed");
  predictionA = (await request(app).post("/api/predictions/me").set(a.auth).expect(201)).body.prediction;
  assert.equal(predictionA.student, a.user.id);
  assert.equal(predictionA.survey, surveyA._id);
  assert.deepEqual(predictionA.surveyAnswers, answersA);
  assert.equal(predictionA.schemaVersion, stressSurveyContract.version);
  assert.equal(predictionA.modelSource, "trained_model");
  assert.equal(predictionA.modelName, "logistic_regression");
  assert.equal(predictionA.modelSha256, (await getStressModelIdentity()).modelSha256);
  assert.ok(Number.isFinite(new Date(predictionA.createdAt).getTime()));
  assert.equal(await WellnessPrediction.countDocuments({ student: a.user.id }), 1);
  assert.equal(await WellnessContextSnapshot.countDocuments({ student: a.user.id }), 0);
  assert.equal((await request(app).get("/api/predictions/me").set(a.auth).expect(200)).body.prediction._id, predictionA._id);
});

test("unchanged submissions and repeated generation reuse records; concurrent inference inserts only once", async () => {
  const resaved = await request(app).post("/api/predictions/survey").set(a.auth).send({ answers: answersA }).expect(201);
  assert.equal(resaved.body.survey._id, surveyA._id);
  const repeated = await request(app).post("/api/predictions/me").set(a.auth).expect(201);
  assert.equal(repeated.body.prediction._id, predictionA._id);
  assert.equal(await StressSurvey.countDocuments({ student: a.user.id }), 1);
  await request(app).post("/api/predictions/survey").set(b.auth).send({ answers: answersB }).expect(201);
  const concurrent = await Promise.all([1, 2].map(() => request(app).post("/api/predictions/me").set(b.auth).expect(201)));
  predictionB = concurrent[0].body.prediction;
  assert.equal(concurrent[1].body.prediction._id, predictionB._id);
  assert.equal(await WellnessPrediction.countDocuments({ student: b.user.id }), 1);
});

test("prediction, engine and provider context stay student-specific and nonclinical", async () => {
  for (const [account, own, other] of [[a, predictionA, predictionB], [b, predictionB, predictionA]]) {
    const retrieval = await request(app).get("/api/predictions/me?student=" + other.student).set(account.auth).expect(200);
    assert.equal(retrieval.body.prediction._id, own._id);
    let args;
    const result = await sendAssistantMessage({ user: account.user, message: "I am feeling stressed because of exams.",
      generateResponse: async input => { args = input; return "A mocked provider response."; } });
    const selected = result.context.selectedItems.find(i => i.sourceType === "prediction");
    assert.equal(selected.sourceId, own._id);
    assert.ok(selected.selectionReason);
    assert.match(selected.content, /not a diagnosis or clinical severity/);
    assert.equal(selected.title, "Saved ML stress-type estimate");
    assert.equal(selected.timestamp.toISOString(), own.createdAt);
    assert.doesNotMatch(JSON.stringify(result.context.selectedItems), new RegExp(other._id));
    assert.ok(buildAssistantMessages(args).some(item => item.content === "I am feeling stressed because of exams."));
    assert.equal(args.prompt, result.context.structuredPrompt);
    assert.equal(result.assistantMessage.responseSource, "ollama");
  }
  await request(app).get("/api/predictions/me").expect(401);
  await request(app).post("/api/predictions/me").expect(401);
});

test("stress and sleep concerns can include the estimate; ordinary study techniques cannot", async () => {
  for (const query of ["I am feeling stressed because of exams.", "How can I improve my sleep?"]) {
    assert.ok((await context(a, query)).selectedItems.some(i => i.sourceType === "prediction"));
  }
  for (const query of ["What is a good study technique for mathematics?", "Can you suggest a study technique for mathematics?", "Tell me about sleep", "I feel lonely"]) {
    assert.equal((await context(a, query)).selectedItems.some(i => i.sourceType === "prediction"), false, query);
  }
});

test("changing onboarding answers invalidates context but does not rewrite independent model inputs", async () => {
  await request(app).put("/api/profile/me/initial-assessment").set(a.auth)
    .send({ schemaVersion: initialWellnessContract.version, responses: { ...initialAnswers, sleepQuality: "Poor" } }).expect(200);
  assert.equal(await WellnessContextSnapshot.countDocuments({ student: a.user.id }), 0);
  assert.equal((await getCurrentStressPrediction(a.user.id)).id, predictionA._id);
  assert.deepEqual(Object.fromEntries((await StressSurvey.findById(surveyA._id)).answers), answersA);
});

test("new prediction inputs immediately invalidate prior context and withhold old estimates until regenerated", async (t) => {
  mockProvider(t);
  await context(a, "Help with my stress");
  const bCount = await WellnessContextSnapshot.countDocuments({ student: b.user.id });
  await request(app).post("/api/predictions/survey").set(a.auth).send({ answers: changedAnswers }).expect(201);
  assert.equal((await request(app).get("/api/predictions/me").set(a.auth).expect(200)).body.prediction, null);
  assert.equal((await request(app).get("/api/dashboard/me").set(a.auth).expect(200)).body.dashboard.overview.latestPrediction, null);
  assert.equal(await WellnessContextSnapshot.countDocuments({ student: a.user.id }), 0);
  assert.equal(await WellnessContextSnapshot.countDocuments({ student: b.user.id }), bCount);
  const chat = await request(app).post("/api/chat/messages").set(a.auth).send({ message: "My sleep is poor" }).expect(201);
  assert.equal(chat.body.assistantMessage.responseSource, "ollama");
  assert.equal(chat.body.context.usedSources.includes("prediction"), false);
  const next = (await request(app).post("/api/predictions/me").set(a.auth).expect(201)).body.prediction;
  assert.notEqual(next._id, predictionA._id);
  assert.deepEqual(next.surveyAnswers, changedAnswers);
  assert.equal(await WellnessContextSnapshot.countDocuments({ student: a.user.id }), 0);
  assert.ok(await WellnessPrediction.findById(predictionA._id)); // Historical record retained.
  predictionA = next;
});

test("model absence, malformed stored output and artifact changes never crash the assistant or create fake predictions", async (t) => {
  mockProvider(t);
  const count = await WellnessPrediction.countDocuments();
  await context(a, "Help with my stress");
  process.env.ML_MODEL_PATH = "ml/models/absent-test-model.joblib";
  try {
    await request(app).post("/api/predictions/me").set(a.auth).expect(503);
    assert.equal((await request(app).get("/api/intelligence/context/me").set(a.auth).expect(200)).body.context, null);
    const response = await request(app).post("/api/chat/messages").set(a.auth).send({ message: "Help with my stress" }).expect(201);
    assert.equal(response.body.context.usedSources.includes("prediction"), false);
    assert.equal(response.body.assistantMessage.responseSource, "ollama");
  } finally { delete process.env.ML_MODEL_PATH; }
  await WellnessPrediction.collection.updateOne({ _id: new mongoose.Types.ObjectId(predictionA._id) }, { $set: { confidence: 2 } });
  assert.equal(await getCurrentStressPrediction(a.user.id), null);
  const response = await request(app).post("/api/chat/messages").set(a.auth).send({ message: "Help with my stress" }).expect(201);
  assert.equal(response.body.context.usedSources.includes("prediction"), false);
  await WellnessPrediction.collection.updateOne({ _id: new mongoose.Types.ObjectId(predictionA._id) },
    { $set: { confidence: predictionA.confidence, modelSha256: "a".repeat(64) } });
  assert.equal(await getCurrentStressPrediction(a.user.id), null);
  await WellnessPrediction.collection.updateOne({ _id: new mongoose.Types.ObjectId(predictionA._id) }, { $set: { modelSha256: predictionA.modelSha256 } });
  assert.equal(await WellnessPrediction.countDocuments(), count);
  assert.equal((await getCurrentStressPrediction(b.user.id)).id, predictionB._id);
});

test("expired surveys suppress saved prediction contexts without deleting history or another student's estimate", async () => {
  const snapshot = await context(a, "Help with my stress");
  assert.ok(snapshot.selectedItems.some(i => i.sourceType === "prediction"));
  await StressSurvey.collection.updateMany({ student: a.user._id }, { $set: { createdAt: new Date(Date.now() - 31 * 86400000) } });
  assert.equal(await getCurrentStressPrediction(a.user.id), null);
  assert.equal((await request(app).get("/api/intelligence/context/me").set(a.auth).expect(200)).body.context, null);
  await request(app).post("/api/predictions/me").set(a.auth).expect(422);
  assert.equal((await context(a, "Help with my stress")).selectedItems.some(i => i.sourceType === "prediction"), false);
  assert.ok(await WellnessPrediction.findById(predictionA._id));
  assert.equal((await getCurrentStressPrediction(b.user.id)).id, predictionB._id);
});
