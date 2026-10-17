import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../models/User.js";
import Assessment from "../models/Assessment.js";
import MoodLog from "../models/MoodLog.js";
import JournalEntry from "../models/JournalEntry.js";
import { createAuthToken } from "../utils/tokens.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "isolated-input-validation-test-secret-at-least-32-characters";
let database, authorization;
before(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri());
  const student = await User.create({ name: "Validation Student", email: "validation@example.test", password: "test-only-password", role: "student" });
  authorization = { Authorization: `Bearer ${createAuthToken(student)}` };
});
after(async () => { await mongoose.disconnect(); await database?.stop(); });

test("malformed JSON and oversized bodies return client errors, not server failures", async () => {
  await request(app).post("/api/auth/login").set("Content-Type", "application/json").send('{"email":').expect(400);
  await request(app).post("/api/auth/login").send({ email: "x".repeat(1024 * 1024) }).expect(413);
});

test("blank journal creation and edits are rejected without losing the saved reflection", async () => {
  await request(app).post("/api/tracking/journals").set(authorization).send({ content: " \n\t " }).expect(400);
  const saved = await request(app).post("/api/tracking/journals").set(authorization).send({ content: "Keep this reflection." }).expect(201);
  await request(app).put(`/api/tracking/journals/${saved.body.journalEntry._id}`).set(authorization).send({ content: "   " }).expect(400);
  assert.equal((await JournalEntry.findById(saved.body.journalEntry._id)).content, "Keep this reflection.");
});

test("missing or nonnumeric answers cannot become zero-valued wellness measurements", async () => {
  for (const invalid of [null, "", "  ", false, true, [], {}]) {
    await request(app).post("/api/tracking/assessments").set(authorization).send({ responses: [invalid, 1, 2, 3, 4] }).expect(400);
    await request(app).post("/api/tracking/moods").set(authorization).send({ mood: "neutral", stressLevel: 3, sleepHours: invalid }).expect(400);
    await request(app).post("/api/tracking/moods").set(authorization).send({ mood: "neutral", stressLevel: invalid }).expect(400);
  }
  assert.equal(await Assessment.countDocuments(), 0);
  assert.equal(await MoodLog.countDocuments(), 0);
  await request(app).post("/api/tracking/assessments").set(authorization).send({ responses: [0, "1", 2, 3, 5] }).expect(201);
  await request(app).post("/api/tracking/moods").set(authorization).send({ mood: "neutral", stressLevel: "3", sleepHours: 0 }).expect(201);
});

test("tracking list limits reject invalid values and keep defaults and capped limits usable", async () => {
  for (const route of ["moods", "journals", "assessments"]) {
    for (const limit of ["-1", "1.5", "Infinity", "abc", "0"]) {
      await request(app).get(`/api/tracking/${route}?limit=${limit}`).set(authorization).expect(400);
    }
    await request(app).get(`/api/tracking/${route}`).set(authorization).expect(200);
    await request(app).get(`/api/tracking/${route}?limit=1000`).set(authorization).expect(200);
  }
});
