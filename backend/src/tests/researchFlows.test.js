import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import StudentProfile from "../models/StudentProfile.js";
import JournalEntry from "../models/JournalEntry.js";
import SharedDocument from "../models/SharedDocument.js";
import WellnessContextSnapshot from "../models/WellnessContextSnapshot.js";
import RequestMetric from "../models/RequestMetric.js";
import { createAuthToken } from "../utils/tokens.js";
import { stressSurveyContract } from "../utils/stressSurvey.js";

process.env.NODE_ENV = "test";
process.env.COUNSELLOR_BRIEFING_PROVIDER = "ollama";
process.env.OLLAMA_MODEL = "qwen3:1.7b";
process.env.JWT_SECRET = "isolated-research-test-secret-at-least-32-characters";
delete process.env.PYTHON_EXECUTABLE;
delete process.env.ML_MODEL_PATH;
let database, student, other, counsellor, admin;
const auth = (user) => ({ Authorization: `Bearer ${createAuthToken(user)}` });
before(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri());
  [student, other, counsellor, admin] = await Promise.all([
    ["Student", "student"], ["Other", "student"], ["Counsellor", "counsellor"], ["Admin", "admin"]
  ].map(([name, role]) => User.create({ name, email: `${name.toLowerCase()}@example.test`, password: "test-only-password", role })));
  await StudentProfile.create({ user: student._id, consentForCounsellorSummary: true });
  await Appointment.init();
}, { timeout: 180000 });
after(async () => { await mongoose.disconnect(); await database?.stop(); });

test("public registration cannot provision admin; inactive users cannot login", async () => {
  await request(app).post("/api/auth/register").send({ name: "Impostor", email: "admin2@example.test", password: "test-password", role: "admin" }).expect(400);
  const response = await request(app).post("/api/auth/register").send({ name: "Applicant", email: "applicant@example.test", password: "test-password", role: "counsellor" }).expect(201);
  assert.equal(response.body.requiresApproval, true);
  assert.equal(response.body.token, undefined);
  await request(app).post("/api/auth/login").send({ email: "applicant@example.test", password: "test-password" }).expect(403);
});

test("admin APIs reject students and counsellors", async () => {
  await request(app).get("/api/admin/overview").set(auth(student)).expect(403);
  await request(app).get("/api/admin/overview").set(auth(counsellor)).expect(403);
  await request(app).get("/api/admin/overview").expect(401);
});

test("prediction requires complete, current survey and uses real trained model", async () => {
  await request(app).post("/api/predictions/me").set(auth(student)).expect(422);
  await request(app).post("/api/predictions/survey").set(auth(student)).send({ answers: {} }).expect(400);
  const answers = Object.fromEntries(stressSurveyContract.questions.map((question) => [question.id, 3]));
  await request(app).post("/api/predictions/survey").set(auth(student)).send({ answers }).expect(201);
  const response = await request(app).post("/api/predictions/me").set(auth(student)).expect(201);
  assert.equal(response.body.prediction.modelSource, "trained_model");
  assert.ok(["eustress", "distress"].includes(response.body.prediction.riskCategory));
  assert.equal(response.body.prediction.schemaVersion, stressSurveyContract.version);
  const isolated = await request(app).get("/api/predictions/me").set(auth(other)).expect(200);
  assert.equal(isolated.body.prediction, null);
});

test("booking conflicts, private notes, shared progress and consent are enforced", async () => {
  const slot = new Date(Date.now() + 86400000); slot.setUTCHours(10, 0, 0, 0);
  const booking = { counsellorId: counsellor.id, scheduledFor: slot.toISOString(), concernType: "academic_stress", shareSummary: true };
  const response = await request(app).post("/api/counselling/appointments").set(auth(student)).send(booking).expect(201);
  const id = response.body.appointment._id;
  await request(app).post("/api/counselling/appointments").set(auth(other)).send(booking).expect(409);
  await request(app).get(`/api/counselling/appointments/${id}/summary`).set(auth(student)).expect(403);
  await request(app).patch(`/api/counselling/appointments/${id}/status`).set(auth(counsellor)).send({ status: "approved" }).expect(200);
  await request(app).patch(`/api/counselling/appointments/${id}/notes`).set(auth(counsellor)).send({ counsellorNotes: "Private session note", progressUpdate: "Agreed to review a study routine" }).expect(200);
  const studentView = await request(app).get("/api/counselling/appointments").set(auth(student)).expect(200);
  assert.equal(studentView.body.appointments[0].counsellorNotes, undefined);
  assert.match(studentView.body.appointments[0].progressUpdate, /study routine/);
  await JournalEntry.create({ student: student._id, title: "Private diary", content: "Private full journal passage", sentiment: "negative" });
  const summary = await request(app).get(`/api/counselling/appointments/${id}/summary`).set(auth(counsellor)).expect(200);
  assert.equal(summary.body.summary.consentGranted, true);
  assert.ok(!JSON.stringify(summary.body).includes("Private full journal passage"));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error("Simulated unavailable local model"); };
    await request(app).post(`/api/counselling/appointments/${id}/summary`).set(auth(counsellor)).expect(503);
  } finally { globalThis.fetch = originalFetch; }
  await request(app).patch(`/api/counselling/appointments/${id}/sharing`).set(auth(student)).send({ shareSummary: false }).expect(200);
  const denied = await request(app).get(`/api/counselling/appointments/${id}/summary`).set(auth(counsellor)).expect(200);
  assert.equal(denied.body.summary.consentGranted, false);
  await request(app).patch(`/api/counselling/appointments/${id}/status`).set(auth(student)).send({ status: "cancelled" }).expect(200);
  await request(app).get(`/api/counselling/appointments/${id}/summary`).set(auth(counsellor)).expect(404);
});

test("feedback is validated and admin analytics do not expose wellness identities or comments", async () => {
  await request(app).post("/api/feedback").set(auth(student)).send({ category: "overall", rating: 7, helpfulness: 5 }).expect(400);
  await request(app).post("/api/feedback").set(auth(student)).send({ category: "overall", rating: 4, helpfulness: 5, comment: "Private research comment" }).expect(201);
  const response = await request(app).get("/api/admin/overview").set(auth(admin)).expect(200);
  assert.equal(response.body.overview.summary.satisfaction.averageRating, 4);
  const serialized = JSON.stringify(response.body);
  assert.ok(!serialized.includes("student@example.test"));
  assert.ok(!serialized.includes("Private research comment"));
  assert.ok(!serialized.includes("Private full journal passage"));
});

test("unavailable model returns an explicit failure, never an invented prediction", async () => {
  process.env.ML_MODEL_PATH = "ml/models/does-not-exist.joblib";
  try { await request(app).post("/api/predictions/me").set(auth(student)).expect(503); }
  finally { delete process.env.ML_MODEL_PATH; }
});

test("document access belongs to appointment participants and closes for the counsellor", async () => {
  delete process.env.CLOUDINARY_API_SECRET;
  const appointment = await Appointment.create({ student: student._id, counsellor: counsellor._id,
    scheduledFor: new Date(Date.now() + 5 * 86400000), concernType: "general" });
  const document = await SharedDocument.create({ student: student._id, appointment: appointment._id,
    publicId: "private-fixture", name: "Test.pdf", bytes: 10 });
  await request(app).get(`/api/documents/${appointment.id}`).set(auth(other)).expect(404);
  await request(app).post(`/api/documents/download/${document.id}`).set(auth(other)).expect(404);
  await request(app).delete(`/api/documents/${document.id}`).set(auth(other)).expect(404);
  const response = await request(app).get(`/api/documents/${appointment.id}`).set(auth(counsellor)).expect(200);
  assert.equal(response.body.documents[0].publicId, undefined);
  await request(app).post(`/api/documents/${appointment.id}`).set(auth(student))
    .send({ name: "Test.pdf", base64: Buffer.from("%PDF-1.7 fixture").toString("base64"), shareWithCounsellor: true }).expect(503);
  await request(app).post(`/api/documents/${appointment.id}`).set(auth(student))
    .send({ name: "Test.pdf", base64: "bm90IGEgcGRm", shareWithCounsellor: true }).expect(400);
  await Appointment.updateOne({ _id: appointment._id }, { status: "cancelled" });
  await request(app).get(`/api/documents/${appointment.id}`).set(auth(counsellor)).expect(404);
  await request(app).get(`/api/documents/${appointment.id}`).set(auth(student)).expect(200);
});

test("journal deletion removes derived context and cached briefings", async () => {
  const journal = await JournalEntry.create({ student: student._id, content: "Disposable fixture" });
  await WellnessContextSnapshot.create({ student: student._id, userMessage: "fixture", tokenBudget: 500,
    structuredPrompt: "Disposable fixture", selectedItems: [{ sourceType: "journal", sourceId: journal.id }] });
  await Appointment.updateMany({ student: student._id }, { generatedSummary: { text: "Cached fixture" } });
  await request(app).delete(`/api/tracking/journals/${journal.id}`).set(auth(other)).expect(404);
  await request(app).delete(`/api/tracking/journals/${journal.id}`).set(auth(student)).expect(204);
  assert.equal(await WellnessContextSnapshot.countDocuments({ "selectedItems.sourceId": journal.id }), 0);
  assert.equal(await Appointment.countDocuments({ student: student._id, generatedSummary: { $exists: true } }), 0);
});

test("generated briefings are cached and withheld when consent changes during the provider call", async () => {
  const appointment = await Appointment.create({ student: student._id, counsellor: counsellor._id,
    scheduledFor: new Date(Date.now() + 6 * 86400000), concernType: "general", shareSummary: true });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => url.endsWith("/api/show")
      ? ({ ok: true, json: async () => ({ details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] }) })
      : ({ ok: true, json: async () => ({ done: true, done_reason: "stop", message: { role: "assistant", content: "Mock briefing for authorization testing." } }) });
    const response = await request(app).post(`/api/counselling/appointments/${appointment.id}/summary`).set(auth(counsellor)).expect(200);
    assert.equal(response.body.summary.narrative.source, "ollama");
    assert.match(response.body.summary.narrative.text, /Mock briefing/);
    const cached = await request(app).get(`/api/counselling/appointments/${appointment.id}/summary`).set(auth(counsellor)).expect(200);
    assert.match(cached.body.summary.narrative.text, /Mock briefing/);
    globalThis.fetch = async () => {
      await Appointment.updateOne({ _id: appointment._id }, { shareSummary: false, $unset: { generatedSummary: 1 } });
      return { ok: true, json: async () => ({ done: true, done_reason: "stop", message: { role: "assistant", content: "Must not be exposed." } }) };
    };
    const revoked = await request(app).post(`/api/counselling/appointments/${appointment.id}/summary`).set(auth(counsellor)).expect(200);
    assert.equal(revoked.body.summary.consentGranted, false);
    assert.ok(!JSON.stringify(revoked.body).includes("Must not be exposed"));
    assert.equal(await Appointment.countDocuments({ _id: appointment._id, generatedSummary: { $exists: true } }), 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("request timings store route templates without identifiers or query text", async () => {
  process.env.NODE_ENV = "development";
  try {
    await request(app).patch(`/api/counselling/appointments/${new mongoose.Types.ObjectId()}/sharing?private=do-not-store`)
      .set(auth(student)).send({ shareSummary: false }).expect(404);
    // finish listeners write asynchronously after the response has completed.
    let record;
    for (let i = 0; i < 20 && !record; i++) {
      record = await RequestMetric.findOne({ method: "PATCH" });
      if (!record) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(record);
    assert.equal(record.route, "/api/counselling/appointments/:id/sharing");
    assert.ok(!JSON.stringify(record).includes("do-not-store"));
  } finally { process.env.NODE_ENV = "test"; }
});
