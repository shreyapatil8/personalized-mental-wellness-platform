import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../models/User.js";
import StudentProfile from "../models/StudentProfile.js";
import { DEPARTMENTS, STUDENT_YEARS } from "../constants/studentOptions.js";
import { createAuthToken } from "../utils/tokens.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "isolated-profile-test-secret-at-least-32-characters-long";
let database, student, other;
const auth = user => ({ Authorization: `Bearer ${createAuthToken(user)}` });

before(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri());
  [student, other] = await Promise.all(["profile-owner", "different-student"].map(name => User.create({
    name, email: `${name}@profile.test`, password: "test-password-123", role: "student"
  })));
  await StudentProfile.create({
    user: student._id,
    rollNumber: "4827",
    urn: "82649173",
    department: DEPARTMENTS[0],
    year: STUDENT_YEARS[0],
    age: 21,
    gender: "Not specified",
    wellnessGoals: ["Existing goal remains stored"],
    emergencyContact: { name: "Existing contact", phone: "5550100", relation: "Sibling" },
    consentForCounsellorSummary: true,
    consentForAssistantJournalContext: false
  });
}, { timeout: 180000 });

after(async () => { await mongoose.disconnect(); await database?.stop(); });

test("profile consent can be updated alone while account identity and existing profile data remain intact", async () => {
  const before = await request(app).get("/api/profile/me").set(auth(student)).expect(200);
  assert.equal(before.body.user.name, "profile-owner");
  assert.equal(before.body.user.email, "profile-owner@profile.test");
  assert.equal(before.body.user.password, undefined);
  assert.equal(before.body.profile.consentForCounsellorSummary, true);
  assert.equal(before.body.profile.consentForAssistantJournalContext, false);

  await request(app).put("/api/profile/me").set(auth(student)).send({
    consentForCounsellorSummary: true,
    consentForAssistantJournalContext: true
  }).expect(200);

  const afterUpdate = await request(app).get("/api/profile/me").set(auth(student)).expect(200);
  assert.equal(afterUpdate.body.profile.consentForCounsellorSummary, true);
  assert.equal(afterUpdate.body.profile.consentForAssistantJournalContext, true);
  assert.equal(afterUpdate.body.profile.rollNumber, "4827");
  assert.equal(afterUpdate.body.profile.urn, "82649173");
  assert.equal(afterUpdate.body.profile.department, DEPARTMENTS[0]);
  assert.equal(afterUpdate.body.profile.year, STUDENT_YEARS[0]);
  assert.equal(afterUpdate.body.profile.age, 21);
  assert.equal(afterUpdate.body.profile.gender, "Not specified");
  assert.deepEqual(afterUpdate.body.profile.wellnessGoals, ["Existing goal remains stored"]);
  assert.deepEqual(afterUpdate.body.profile.emergencyContact, { name: "Existing contact", phone: "5550100", relation: "Sibling" });
});

test("student profile endpoint returns only the authenticated student's account and profile", async () => {
  const own = await request(app).get("/api/profile/me").set(auth(other)).expect(200);
  assert.equal(own.body.user.id, other.id);
  assert.equal(own.body.profile, null);
  assert.equal(JSON.stringify(own.body).includes("Existing contact"), false);
  assert.equal(JSON.stringify(own.body).includes("Existing goal remains stored"), false);
});
