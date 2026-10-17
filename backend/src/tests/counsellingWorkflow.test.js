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
import { minimumAppointmentTime, isFutureAppointmentSlot, toLocalDateTimeInput } from "../../../frontend/src/utils/appointmentTime.js";

// Never load .env or connect to the application database.
process.env.NODE_ENV = "test";
process.env.COUNSELLOR_BRIEFING_PROVIDER = "openai";
process.env.COUNSELLOR_BRIEFING_ALLOW_CLOUD = "true";
process.env.JWT_SECRET = "isolated-counselling-workflow-test-secret-at-least-32-characters";
delete process.env.OPENAI_API_KEY;
let database, student, other, counsellor, unrelatedCounsellor, adminHeaders, appointmentId, savedAssessment;
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
  const admin = await User.create({ name: "Test Admin", email: "admin@workflow.test", password, role: "admin" });
  adminHeaders = { Authorization: `Bearer ${createAuthToken(admin)}` };
  student = await registerAndLogin("Student", "student");
  other = await registerAndLogin("Other", "student");
  counsellor = await registerAndLogin("Counsellor", "counsellor");
  unrelatedCounsellor = await registerAndLogin("Unrelated", "counsellor");
}, { timeout: 180000 });

after(async () => { await mongoose.disconnect(); await database?.stop(); });

test("student entry, assessment, dashboard and tracking lead to valid hour and half-hour bookings", async () => {
  const responses = Object.fromEntries(initialWellnessContract.questions.filter((q) => !q.optional).map((q) => [q.id, q.options[2]]));
  const assessment = await request(app).put("/api/profile/me/initial-assessment").set(student.headers)
    .send({ schemaVersion: initialWellnessContract.version, responses: { ...responses, sleepQuality: "Poor", sleepHours: "5–6", additionalNotes: "Do not dump this free text" } }).expect(200);
  savedAssessment = assessment.body.assessment;
  await request(app).put("/api/profile/me/initial-assessment").set(other.headers)
    .send({ schemaVersion: initialWellnessContract.version, responses: { ...responses, sleepQuality: "Very good", sleepHours: "More than 8", additionalNotes: "OTHER_STUDENT_SECRET" } }).expect(200);
  const dashboard = await request(app).get("/api/dashboard/me").set(student.headers).expect(200);
  assert.equal(dashboard.body.dashboard.profile.initialWellnessAssessment.responses.sleepQuality, "Poor");
  await request(app).put("/api/profile/me").set(student.headers).send({ rollNumber: "1234", urn: "12345678",
    department: DEPARTMENTS[0], year: STUDENT_YEARS[0], wellnessGoals: ["Improve rest"], consentForCounsellorSummary: true }).expect(200);
  await request(app).post("/api/tracking/moods").set(student.headers).send({ mood: "low", stressLevel: 4, sleepHours: 5 }).expect(201);
  await request(app).post("/api/tracking/journals").set(student.headers).send({ title: "Sleep reflection", content: "Private full journal text", tags: ["sleep"] }).expect(201);
  const updated = await request(app).get("/api/dashboard/me").set(student.headers).expect(200);
  assert.equal(updated.body.dashboard.overview.moodSummary.entries, 1);
  assert.equal(updated.body.dashboard.overview.journalEntryCount, 1);

  const tomorrow = new Date(Date.now() + 86400000); tomorrow.setUTCHours(10, 0, 0, 0);
  const booking = { counsellorId: counsellor.id, concernType: "sleep", shareSummary: true };
  for (const invalid of [new Date(Date.now() - 60000), new Date(tomorrow.getTime() + 17 * 60000), new Date(tomorrow.getTime() + 1000)]) {
    await request(app).post("/api/counselling/appointments").set(student.headers)
      .send({ ...booking, scheduledFor: invalid.toISOString() }).expect(400);
  }
  assert.equal(await Appointment.countDocuments({}), 0);
  const minimum = new Date(minimumAppointmentTime());
  for (const minutes of [0, 30]) {
    const slot = new Date(tomorrow); slot.setUTCMinutes(minutes);
    const localInput = toLocalDateTimeInput(slot);
    assert.equal(isFutureAppointmentSlot(localInput), true);
    assert.equal((new Date(localInput) - minimum) % 1800000, 0);
    const booked = await request(app).post("/api/counselling/appointments").set(student.headers)
      .send({ ...booking, scheduledFor: new Date(localInput).toISOString() }).expect(201);
    assert.equal(booked.body.appointment.scheduledFor, slot.toISOString());
    if (minutes === 0) appointmentId = booked.body.appointment._id;
  }
  assert.equal(await Appointment.countDocuments({ student: student.id }), 2);
});

test("assigned counsellor sees dated factual assessment without OpenAI; private notes stay private and progress reaches student", async (t) => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("External AI must not be called"); });
  const path = `/api/counselling/appointments/${appointmentId}`;
  const appointments = await request(app).get("/api/counselling/appointments").set(counsellor.headers).expect(200);
  assert.ok(appointments.body.appointments.some((item) => item._id === appointmentId));
  await request(app).patch(`${path}/status`).set(counsellor.headers).send({ status: "approved" }).expect(200);
  const overview = await request(app).get(`${path}/summary`).set(counsellor.headers).expect(200);
  const summary = overview.body.summary;
  assert.equal(summary.consentGranted, true);
  assert.equal(summary.narrative, null);
  assert.equal(summary.initialAssessment.recordedAt, savedAssessment.updatedAt);
  assert.equal(summary.initialAssessment.responses.find((item) => item.id === "sleepQuality").response, "Poor");
  assert.equal(summary.initialAssessment.responses.find((item) => item.id === "sleepHours").response, "5–6");
  assert.deepEqual(summary.profile.wellnessGoals, ["Improve rest"]);
  assert.doesNotMatch(JSON.stringify(summary), /OTHER_STUDENT_SECRET|More than 8|Do not dump this free text|Private full journal text/);
  const unavailable = await request(app).post(`${path}/summary`).set(counsellor.headers).expect(503);
  assert.match(unavailable.body.message, /Local AI generation is unavailable/);
  assert.equal(provider.mock.callCount(), 0);
  const stillAvailable = await request(app).get(`${path}/summary`).set(counsellor.headers).expect(200);
  assert.deepEqual(stillAvailable.body.summary.initialAssessment, summary.initialAssessment);

  await request(app).patch(`${path}/notes`).set(counsellor.headers)
    .send({ counsellorNotes: "PRIVATE_COUNSELLOR_NOTE", progressUpdate: "Agreed to discuss a bedtime routine" }).expect(200);
  const studentView = await request(app).get("/api/counselling/appointments").set(student.headers).expect(200);
  const appointment = studentView.body.appointments.find((item) => item._id === appointmentId);
  assert.equal(appointment.status, "approved");
  assert.equal(appointment.progressUpdate, "Agreed to discuss a bedtime routine");
  assert.equal(appointment.counsellorNotes, undefined);
  const dashboard = await request(app).get("/api/dashboard/me").set(student.headers).expect(200);
  assert.doesNotMatch(JSON.stringify(dashboard.body), /PRIVATE_COUNSELLOR_NOTE/);
});

test("factual assessment obeys both consents, assigned ownership and closed-appointment boundaries", async () => {
  const path = `/api/counselling/appointments/${appointmentId}`;
  await request(app).get(`${path}/summary`).expect(401);
  await request(app).get(`${path}/summary`).set(student.headers).expect(403);
  await request(app).get(`${path}/summary`).set(adminHeaders).expect(403);
  await request(app).get(`${path}/summary`).set(unrelatedCounsellor.headers).expect(404);
  await request(app).patch(`${path}/sharing`).set(other.headers).send({ shareSummary: false }).expect(404);
  await request(app).patch(`${path}/sharing`).set(student.headers).send({ shareSummary: false }).expect(200);
  let denied = await request(app).get(`${path}/summary`).set(counsellor.headers).expect(200);
  assert.equal(denied.body.summary.consentGranted, false);
  assert.equal(denied.body.summary.initialAssessment, undefined);
  await request(app).patch(`${path}/sharing`).set(student.headers).send({ shareSummary: true }).expect(200);
  await StudentProfile.updateOne({ user: student.id }, { $set: { consentForCounsellorSummary: false } });
  denied = await request(app).get(`${path}/summary`).set(counsellor.headers).expect(200);
  assert.equal(denied.body.summary.consentGranted, false);
  assert.equal(denied.body.summary.initialAssessment, undefined);
  await StudentProfile.updateOne({ user: student.id }, { $set: { consentForCounsellorSummary: true } });
  await request(app).patch(`${path}/status`).set(counsellor.headers).send({ status: "completed" }).expect(200);
  await request(app).get(`${path}/summary`).set(counsellor.headers).expect(404);
  const finalView = await request(app).get("/api/counselling/appointments").set(student.headers).expect(200);
  const completed = finalView.body.appointments.find((item) => item._id === appointmentId);
  assert.equal(completed.status, "completed");
  assert.equal(completed.progressUpdate, "Agreed to discuss a bedtime routine");
  assert.equal(completed.counsellorNotes, undefined);
});
