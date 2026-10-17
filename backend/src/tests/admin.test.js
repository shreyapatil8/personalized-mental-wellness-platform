import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../models/User.js";
import MoodLog from "../models/MoodLog.js";
import JournalEntry from "../models/JournalEntry.js";
import Assessment from "../models/Assessment.js";
import Appointment from "../models/Appointment.js";
import ConversationMessage from "../models/ConversationMessage.js";
import CounsellingMessage from "../models/CounsellingMessage.js";
import Feedback from "../models/Feedback.js";
import { createAuthToken } from "../utils/tokens.js";
import { buildAdminOverview } from "../services/adminOverviewService.js";

// Only a disposable loopback database. Never load .env, reset or access application data.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "admin-focused-disposable-tests-secret-at-least-32-characters";
process.env.MONGOMS_DOWNLOAD_DIR = fileURLToPath(new URL("../../../.test-cache/mongodb", import.meta.url));
const password = "Disposable-admin-test-password";
const DAY = 86400000;
let database, admin, student, other, counsellor, pending, rejected, adminHeaders;
const auth = user => ({ Authorization: `Bearer ${createAuthToken(user)}` });
async function register(name, role = "student") {
  await request(app).post("/api/auth/register").send({ name, email: name + "@admin.test", role, password,
    ...(role === "counsellor" ? { profile: { qualification: "MA Counselling", specialization: ["Student support"] } } : {}) }).expect(201);
  return User.findOne({ email: name.toLowerCase() + "@admin.test" });
}
before(async () => {
  database = await MongoMemoryServer.create();
  assert.match(database.getUri(), /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(database.getUri());
  await User.init(); await Appointment.init();
  admin = await User.create({ name: "Administrator", email: "administrator@admin.test", password, role: "admin" });
  student = await register("Student"); other = await register("Other");
  pending = await register("Pending", "counsellor"); rejected = await register("Reject", "counsellor");
  counsellor = await User.create({ name: "Existing counsellor", email: "existing@admin.test", password, role: "counsellor", isActive: true });
  const login = await request(app).post("/api/auth/login").send({ email: admin.email, password }).expect(200);
  adminHeaders = { Authorization: `Bearer ${login.body.token}` };
}, { timeout: 180000 });
after(async () => { await mongoose.disconnect(); await database?.stop(); });

test("admin login and empty dashboard use real account counts and explicit absent feedback", async () => {
  const { body } = await request(app).get("/api/admin/overview").set(adminHeaders).expect(200);
  assert.deepEqual(body.overview.summary, { totalStudents: 2, activeCounsellors: 1, pendingCounsellorRequests: 2,
    totalUsers: 5, satisfaction: { responses: 0, averageRating: null, averageHelpfulness: null } });
  assert.equal(body.overview.report.current.activeStudents, 0);
  assert.equal(body.overview.report.current.totalActivities, 0);
  assert.ok(body.overview.report.daily.every(row => row.totalActivities === 0));
  assert.doesNotMatch(JSON.stringify(body), /performance|prediction|model|contextCount|research|@admin.test|password/);
  await request(app).get("/api/admin/overview?period=invalid").set(adminHeaders).expect(400);
});

test("counsellor request approval and rejection reuse isActive; decisions persist and cannot be replayed", async () => {
  await request(app).post("/api/auth/login").send({ email: pending.email, password }).expect(403);
  const list = await request(app).get("/api/admin/counsellor-requests?reviewStatus=pending").set(adminHeaders).expect(200);
  assert.equal(list.body.pagination.total, 2);
  assert.equal(list.body.users[0].qualification, "MA Counselling");
  assert.deepEqual(list.body.users[0].specialization, ["Student support"]);
  assert.equal(list.body.users[0].reviewStatus, "pending");
  const route = account => `/api/admin/counsellor-requests/${account.id}`;
  await request(app).patch(route(pending)).set(adminHeaders).send({ decision: "approved" }).expect(200);
  await request(app).patch(route(rejected)).set(adminHeaders).send({ decision: "rejected" }).expect(200);
  await request(app).post("/api/auth/login").send({ email: pending.email, password }).expect(200);
  await request(app).post("/api/auth/login").send({ email: rejected.email, password }).expect(403);
  const declined = await request(app).get("/api/admin/counsellor-requests?reviewStatus=rejected").set(adminHeaders).expect(200);
  assert.equal(declined.body.users[0].id, rejected.id);
  assert.equal(declined.body.users[0].isActive, false);
  assert.equal(declined.body.users[0].reviewRecorded, true);
  await request(app).patch(route(pending)).set(adminHeaders).send({ decision: "rejected" }).expect(409);
  await request(app).patch(route(student)).set(adminHeaders).send({ decision: "approved" }).expect(409);
  await request(app).patch(route(rejected)).set(adminHeaders).send({ decision: "pending" }).expect(400);
  assert.equal((await User.findById(rejected.id).select("+counsellorReviewStatus")).counsellorReviewStatus, "rejected");
  const overview = (await request(app).get("/api/admin/overview").set(adminHeaders)).body.overview;
  assert.equal(overview.summary.pendingCounsellorRequests, 0);
  assert.equal(overview.summary.activeCounsellors, 2);
  assert.equal(overview.summary.totalUsers, 5);
});

test("user management is paginated, searchable and exposes only basic account records", async () => {
  const list = await request(app).get("/api/admin/users?role=student&limit=1&page=2").set(adminHeaders).expect(200);
  assert.equal(list.body.users.length, 1); assert.equal(list.body.pagination.total, 2);
  assert.deepEqual(Object.keys(list.body.users[0]).sort(), ["id", "name", "email", "role", "isActive", "createdAt", "lastLoginAt"].sort());
  const search = await request(app).get("/api/admin/users?search=Student%40admin.test").set(adminHeaders).expect(200);
  assert.equal(search.body.users[0].id, student.id);
  await request(app).patch(`/api/admin/users/${student.id}/status`).set(adminHeaders).send({ isActive: false }).expect(200);
  await request(app).post("/api/auth/login").send({ email: student.email, password }).expect(403);
  await request(app).patch(`/api/admin/users/${student.id}/status`).set(adminHeaders).send({ isActive: true }).expect(200);
  await request(app).post("/api/auth/login").send({ email: student.email, password }).expect(200);
  await request(app).patch(`/api/admin/users/${admin.id}/status`).set(adminHeaders).send({ isActive: false }).expect(400);
  // Deactivation is not rejection or a new pending registration, including legacy accounts.
  await request(app).patch(`/api/admin/users/${counsellor.id}/status`).set(adminHeaders).send({ isActive: false }).expect(200);
  const inactive = await request(app).get("/api/admin/users?role=counsellor&status=inactive").set(adminHeaders).expect(200);
  assert.equal(inactive.body.users.find(user => user.id === counsellor.id).reviewStatus, "approved");
  await request(app).patch(`/api/admin/users/${counsellor.id}/status`).set(adminHeaders).send({ isActive: true }).expect(200);
});

test("all Admin endpoints reject unauthenticated, student, counsellor and inactive accounts", async () => {
  for (const headers of [{}, auth(student), auth(counsellor)]) {
    const expected = headers.Authorization ? 403 : 401;
    for (const route of ["/overview", "/users", "/counsellor-requests"]) await request(app).get("/api/admin" + route).set(headers).expect(expected);
    await request(app).patch(`/api/admin/users/${other.id}/status`).set(headers).send({ isActive: false }).expect(expected);
    await request(app).patch(`/api/admin/counsellor-requests/${rejected.id}`).set(headers).send({ decision: "approved" }).expect(expected);
  }
  await User.updateOne({ _id: admin.id }, { isActive: false });
  await request(app).get("/api/admin/overview").set(adminHeaders).expect(401);
  await User.updateOne({ _id: admin.id }, { isActive: true });
});

test("weekly/monthly aggregates count retained activity once, enforce boundaries and never expose private data", async () => {
  const now = new Date(Date.now() + 1000), at = days => new Date(now - days * DAY);
  const base = (days, account = student) => ({ student: account._id, createdAt: at(days), updatedAt: at(days) });
  // Deliberately distinctive private content proves aggregation never returns it.
  await MoodLog.collection.insertMany([1, 2, 7, 9, -1].map((days, index) => ({ ...base(days, index === 1 ? other : student), mood: "low", moodScore: 2, stressLevel: 4, loggedFor: at(200), note: "PRIVATE_MOOD_NOTE" })));
  await JournalEntry.collection.insertMany([1, 8, 14, 20, 40].map(days => ({ ...base(days), title: "PRIVATE_JOURNAL_TITLE", content: "PRIVATE_JOURNAL_TEXT" })));
  await Assessment.collection.insertOne({ ...base(1), responses: [1, 2, 3, 4, 5], rawScore: 15 });
  await ConversationMessage.collection.insertMany([
    { ...base(1), role: "student", content: "PRIVATE_AI_STUDENT_TEXT" }, { ...base(1), role: "assistant", content: "PRIVATE_AI_REPLY" },
    { ...base(2, other), role: "student", content: "PRIVATE_AI_OTHER_TEXT" }, { ...base(9), role: "student", content: "PRIVATE_AI_PREVIOUS" }
  ]);
  const appointment = new mongoose.Types.ObjectId();
  await Appointment.collection.insertMany([
    { ...base(3), _id: appointment, counsellor: counsellor._id, scheduledFor: at(1), status: "completed", concernType: "general", notes: "PRIVATE_CONCERN", counsellorNotes: "PRIVATE_COUNSELLOR_NOTE" },
    { ...base(1, other), counsellor: counsellor._id, scheduledFor: at(-2), status: "approved", concernType: "general" },
    { ...base(10, other), counsellor: counsellor._id, scheduledFor: at(9), status: "approved", concernType: "general" }
  ]);
  await CounsellingMessage.collection.insertMany([
    { appointment, sender: student._id, clientMessageId: "fixture-student", content: "PRIVATE_CHAT", createdAt: at(1) },
    { appointment, sender: counsellor._id, clientMessageId: "fixture-counsellor", content: "PRIVATE_CHAT_REPLY", createdAt: at(1) }
  ]);
  await Feedback.collection.insertMany([[1, 4, 5], [2, 2, 3], [9, 5, 2], [10, 3, 4]].map(([days, rating, helpfulness]) => ({ user: student._id, role: "student", category: "overall", rating, helpfulness, comment: "PRIVATE_FEEDBACK", createdAt: at(days) })));
  const weekly = await buildAdminOverview({ period: "weekly", now });
  const { current, previous, daily } = weekly.report;
  assert.equal(current.activeStudents, 2);
  assert.equal(current.newUsers, 6);
  assert.equal(daily.reduce((sum, row) => sum + row.newUsers, 0), 6);
  assert.equal(current.moodCheckIns, 3); assert.equal(previous.moodCheckIns, 1);
  assert.equal(current.journalEntries, 1); assert.equal(previous.journalEntries, 2);
  assert.equal(current.assistantMessages, 2); assert.equal(previous.assistantMessages, 1);
  assert.equal(current.appointmentsBooked, 2); assert.equal(current.completedSessions, 1);
  assert.equal(current.counsellingMessages, 2); assert.equal(current.assessments, 1);
  assert.equal(current.totalActivities, 11);
  assert.equal(daily.reduce((sum, row) => sum + row.totalActivities, 0), current.totalActivities);
  assert.deepEqual(current.satisfaction, { responses: 2, averageRating: 3, averageHelpfulness: 4 });
  assert.deepEqual(previous.satisfaction, { responses: 2, averageRating: 4, averageHelpfulness: 3 });
  const monthly = await buildAdminOverview({ period: "monthly", now });
  assert.equal(monthly.report.current.journalEntries, 4); assert.equal(monthly.report.previous.journalEntries, 1);
  assert.equal(monthly.report.current.satisfaction.responses, 4);
  assert.equal(monthly.report.days, 30);
  const response = await request(app).get("/api/admin/overview?period=monthly").set(adminHeaders).expect(200);
  assert.doesNotMatch(JSON.stringify(response.body), /PRIVATE_|@admin.test|password|prediction|modelName|performance|counsellorNotes|studentId/);
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(student.id + "|" + counsellor.id));
  // Existing private participant APIs remain closed to administrators.
  await request(app).get(`/api/counselling/appointments/${appointment}/summary`).set(adminHeaders).expect(403);
  await request(app).get(`/api/counselling/appointments/${appointment}/chat`).set(adminHeaders).expect(403);
});
