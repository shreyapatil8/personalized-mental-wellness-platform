import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../app.js";
import User from "../models/User.js";
import StudentProfile from "../models/StudentProfile.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "isolated-student-entry-test-secret-at-least-32-characters";
let database;

before(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri());
  await User.init();
}, { timeout: 180000 });

after(async () => {
  await mongoose.disconnect();
  await database?.stop();
});

test("student can register with basic details, login, and use an empty dashboard/profile", async () => {
  const registered = await request(app).post("/api/auth/register").send({
    name: "  New Student  ", email: "  NEW.STUDENT@example.test  ", password: "student-test-password"
  }).expect(201);
  assert.equal(registered.body.user.name, "New Student");
  assert.equal(registered.body.user.email, "new.student@example.test");
  assert.equal(registered.body.user.role, "student");
  assert.equal(registered.body.user.password, undefined);
  const profile = await StudentProfile.findOne({ user: registered.body.user.id });
  assert.ok(profile);
  assert.equal(profile.rollNumber, undefined);
  assert.deepEqual(profile.wellnessGoals, []);
  assert.equal(profile.consentForCounsellorSummary, false);

  await request(app).get("/api/dashboard/me").expect(401);
  await request(app).post("/api/auth/login").send({
    email: "new.student@example.test", password: "wrong-password"
  }).expect(401);
  const login = await request(app).post("/api/auth/login").send({
    email: " NEW.STUDENT@example.test ", password: "student-test-password"
  }).expect(200);
  const headers = { Authorization: `Bearer ${login.body.token}` };
  assert.equal(login.body.user.id, registered.body.user.id);
  await request(app).get("/api/auth/me").set(headers).expect(200);
  const dashboard = await request(app).get("/api/dashboard/me").set(headers).expect(200);
  assert.equal(dashboard.body.dashboard.overview.wellnessScore, null);
  await request(app).get("/api/profile/me").set(headers).expect(200);
});

test("registration rejects invalid details and normalized duplicate emails", async () => {
  const valid = { name: "Test Student", email: "validation@example.test", password: "test-password" };
  for (const invalid of [{ name: "  " }, { email: "invalid-email" }, { password: "short" }]) {
    await request(app).post("/api/auth/register").send({ ...valid, ...invalid }).expect(400);
  }
  assert.equal(await User.countDocuments({ email: valid.email }), 0);
  await request(app).post("/api/auth/register").send(valid).expect(201);
  const duplicate = await request(app).post("/api/auth/register")
    .send({ ...valid, email: " VALIDATION@example.test " }).expect(409);
  assert.match(duplicate.body.message, /already exists/);
});

test("counsellor approval and prohibition on public admin registration are preserved", async () => {
  const applicant = { name: "Counsellor Applicant", email: "counsellor-entry@example.test", password: "test-password", role: "counsellor" };
  const response = await request(app).post("/api/auth/register").send(applicant).expect(201);
  assert.equal(response.body.requiresApproval, true);
  assert.equal(response.body.token, undefined);
  await request(app).post("/api/auth/login").send({ email: applicant.email, password: applicant.password }).expect(403);
  await request(app).post("/api/auth/register").send({ ...applicant, role: "admin" }).expect(400);
});
