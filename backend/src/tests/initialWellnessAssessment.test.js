import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../models/User.js";
import StudentProfile from "../models/StudentProfile.js";
import Assessment from "../models/Assessment.js";
import WellnessPrediction from "../models/WellnessPrediction.js";
import WellnessContextSnapshot from "../models/WellnessContextSnapshot.js";
import Appointment from "../models/Appointment.js";
import { initialWellnessContract } from "../utils/initialWellnessAssessment.js";
import { createAuthToken } from "../utils/tokens.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "isolated-initial-assessment-test-secret-at-least-32-characters";
let database, student, other, counsellor;
const endpoint = "/api/profile/me/initial-assessment";
const auth = (user) => ({ Authorization: `Bearer ${createAuthToken(user)}` });
const responses = Object.fromEntries(initialWellnessContract.questions.filter((q) => !q.optional).map((q) => [q.id, q.options[2]]));
const payload = { schemaVersion: initialWellnessContract.version, responses };

before(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri());
  await StudentProfile.init();
  [student, other, counsellor] = await Promise.all(["student", "other", "counsellor"].map((name) => User.create({ name, email: `${name}@initial.test`, password: "test-password", role: name === "counsellor" ? name : "student" })));
  await StudentProfile.create({ user: student._id, rollNumber: "1234", wellnessGoals: ["Keep my own goal"], consentForCounsellorSummary: true });
}, { timeout: 180000 });
after(async () => { await mongoose.disconnect(); await database?.stop(); });

test("incomplete assessment is readable without creating data; access is student-only", async () => {
  await request(app).get(endpoint).expect(401);
  await request(app).put(endpoint).send(payload).expect(401);
  await request(app).get(endpoint).set(auth(counsellor)).expect(403);
  await request(app).put(endpoint).set(auth(counsellor)).send(payload).expect(403);
  const result = await request(app).get(endpoint).set(auth(student)).expect(200);
  assert.equal(result.body.assessment, null);
  assert.equal(result.body.contract.questions.length, 15);
  assert.equal(result.body.contract.questions.filter((q) => q.optional).length, 1);
  assert.equal((await StudentProfile.findOne({ user: student._id })).initialWellnessAssessment, undefined);
});

test("all 14 choices, allowed values, version, and optional-text bounds are validated", async () => {
  for (const question of initialWellnessContract.questions.filter((q) => !q.optional)) {
    const missing = { ...responses };
    delete missing[question.id];
    await request(app).put(endpoint).set(auth(student)).send({ ...payload, responses: missing }).expect(400);
    await request(app).put(endpoint).set(auth(student)).send({ ...payload, responses: { ...responses, [question.id]: "invented answer" } }).expect(400);
  }
  for (const extra of [{ schemaVersion: "future" }, { student: other.id }, { responses: { ...responses, additionalNotes: "x".repeat(2001) } }]) {
    await request(app).put(endpoint).set(auth(student)).send({ ...payload, ...extra }).expect(400);
  }
  assert.equal((await StudentProfile.findOne({ user: student._id })).initialWellnessAssessment, undefined);
});

test("save/update records every response in the profile, preserves details, and creates no predictions", async () => {
  const first = await request(app).put(endpoint).set(auth(student)).send(payload).expect(200);
  assert.equal(first.body.assessment.responses.additionalNotes, "");
  assert.deepEqual(first.body.assessment.responses, { ...responses, additionalNotes: "" });
  const updatedResponses = { ...responses, overallWellbeing: "Good", additionalNotes: "$literal notes <script>not executable</script>" };
  const updated = await request(app).put(endpoint).set(auth(student)).send({ ...payload, responses: updatedResponses }).expect(200);
  assert.equal(updated.body.assessment.completedAt, first.body.assessment.completedAt);
  assert.ok(new Date(updated.body.assessment.updatedAt) >= new Date(first.body.assessment.updatedAt));
  const read = await request(app).get(endpoint).set(auth(student)).expect(200);
  assert.deepEqual(read.body.assessment.responses, updatedResponses);
  const profile = await request(app).get("/api/profile/me").set(auth(student)).expect(200);
  assert.equal(profile.body.profile.rollNumber, "1234");
  assert.deepEqual(profile.body.profile.wellnessGoals, ["Keep my own goal"]);
  assert.equal(profile.body.profile.consentForCounsellorSummary, true);
  assert.deepEqual(profile.body.profile.initialWellnessAssessment.responses, updatedResponses);
  const dashboard = await request(app).get("/api/dashboard/me").set(auth(student)).expect(200);
  assert.equal(dashboard.body.dashboard.profile.initialWellnessAssessment.schemaVersion, payload.schemaVersion);
  assert.equal(dashboard.body.dashboard.overview.wellnessScore, null);
  assert.equal(await Assessment.countDocuments(), 0);
  assert.equal(await WellnessPrediction.countDocuments(), 0);
  assert.equal(await StudentProfile.countDocuments({ user: student.id }), 1);
});

test("another student cannot read or overwrite responses; missing profiles are created", async () => {
  const own = await request(app).get(`${endpoint}?student=${student.id}`).set(auth(other)).expect(200);
  assert.equal(own.body.assessment, null);
  await request(app).put(endpoint).set(auth(other)).send({ ...payload, student: student.id }).expect(400);
  await request(app).put(endpoint).set(auth(other)).send({ ...payload, responses: { ...responses, additionalNotes: "" } }).expect(200);
  const profiles = await StudentProfile.find({ user: { $in: [student.id, other.id] } });
  assert.equal(profiles.length, 2);
  const first = await StudentProfile.findOne({ user: student.id });
  assert.equal(first.initialWellnessAssessment.responses.overallWellbeing, "Good");
  const second = await StudentProfile.findOne({ user: other.id });
  assert.equal(second.initialWellnessAssessment.responses.overallWellbeing, "Average");
  assert.equal(second.consentForCounsellorSummary, false);
});

test("assessment updates invalidate only that student's derived context and cached counsellor briefings", async () => {
  for (const [index, account] of [student, other].entries()) {
    await WellnessContextSnapshot.create({ student: account._id, userMessage: "Saved context", tokenBudget: 1400,
      structuredPrompt: "Previous assessment summary" });
    await Appointment.create({ student: account._id, counsellor: counsellor._id, concernType: "general",
      scheduledFor: new Date(Date.now() + (index + 1) * 86400000), generatedSummary: { text: "Previous briefing" } });
  }
  await request(app).put(endpoint).set(auth(student)).send(payload).expect(200);
  assert.equal(await WellnessContextSnapshot.countDocuments({ student: student._id }), 0);
  assert.equal(await Appointment.countDocuments({ student: student._id, generatedSummary: { $exists: true } }), 0);
  assert.equal(await WellnessContextSnapshot.countDocuments({ student: other._id }), 1);
  assert.equal(await Appointment.countDocuments({ student: other._id, generatedSummary: { $exists: true } }), 1);
  assert.equal(await StudentProfile.countDocuments({ user: student._id }), 1);
});
