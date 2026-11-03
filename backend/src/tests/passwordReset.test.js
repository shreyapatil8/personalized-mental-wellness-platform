import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import nodemailer from "nodemailer";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../models/User.js";
import PasswordResetToken from "../models/PasswordResetToken.js";
import { createAuthToken } from "../utils/tokens.js";
import { clearRateLimitsForTests } from "../middleware/rateLimit.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "isolated-password-reset-test-secret-at-least-32-characters";
let database;
let user;
const digest = (token) => createHash("sha256").update(token).digest("hex");

before(async () => {
  if (process.env.TEST_MONGODB_URI) await mongoose.connect(process.env.TEST_MONGODB_URI);
  else {
    database = await MongoMemoryServer.create();
    await mongoose.connect(database.getUri());
  }
  user = await User.create({ name: "Reset Test", email: "reset@example.test", password: "original-password", role: "student" });
});
after(async () => { await mongoose.disconnect(); await database?.stop(); });

test("forgot password gives unknown email a generic confirmation without sending mail", async () => {
  Object.assign(process.env, { SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_USER: "wellspace@gmail.test", SMTP_PASSWORD: "test-app-password", SMTP_FROM: "wellspace@gmail.test" });
  const response = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@example.test" }).expect(200);
  assert.match(response.body.message, /If an account exists/);
  assert.equal(await PasswordResetToken.countDocuments(), 0);
});

test("forgot password sends the Gmail reset message and stores only the emailed token hash", async (t) => {
  const messages = [];
  const createTransport = t.mock.method(nodemailer, "createTransport", (options) => {
    assert.equal(options.host, "smtp.gmail.com");
    assert.equal(options.port, 465);
    assert.equal(options.secure, true);
    return {
      async sendMail(message) {
        messages.push(message);
        return { accepted: [message.to], rejected: [] };
      }
    };
  });
  const originalOrigin = process.env.CLIENT_ORIGIN;
  process.env.CLIENT_ORIGIN = "https://wellspace.example.test";
  try {
    const response = await request(app).post("/api/auth/forgot-password").send({ email: user.email }).expect(200);
    assert.match(response.body.message, /If an account exists/);
    assert.equal(createTransport.mock.callCount(), 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, user.email);
    assert.match(messages[0].text, /expires in 30 minutes/);
    const token = messages[0].text.match(/#token=([a-f\d]{64})/i)?.[1];
    assert.ok(token, "reset URL contains a 256-bit token in the URL fragment");
    assert.match(messages[0].text, /^.*https:\/\/wellspace\.example\.test\/reset-password#token=/ms);
    const savedToken = await PasswordResetToken.findOne({ user: user._id });
    assert.equal(savedToken.tokenHash, digest(token));
    assert.equal(savedToken.tokenHash === token, false);
    assert.equal(JSON.stringify(response.body).includes(process.env.SMTP_PASSWORD), false);
  } finally {
    if (originalOrigin === undefined) delete process.env.CLIENT_ORIGIN;
    else process.env.CLIENT_ORIGIN = originalOrigin;
  }
});

test("SMTP send failures are reported and remove the unusable reset token", async (t) => {
  t.mock.method(nodemailer, "createTransport", () => ({
    async sendMail() { throw Object.assign(new Error("Authentication failed"), { code: "EAUTH" }); }
  }));
  await request(app).post("/api/auth/forgot-password").send({ email: user.email }).expect(502).expect((response) => {
    assert.match(response.body.message, /delivery failed/i);
    assert.equal(response.body.message.includes("Authentication failed"), false);
  });
  assert.equal(await PasswordResetToken.countDocuments({ user: user._id }), 0);
});

test("missing SMTP setup returns a clear setup error without pretending an email was sent", async () => {
  delete process.env.SMTP_HOST;
  await request(app).post("/api/auth/forgot-password").send({ email: user.email }).expect(503).expect((response) => {
    assert.match(response.body.message, /not configured/i);
  });
  assert.equal(await PasswordResetToken.countDocuments(), 0);
  process.env.SMTP_HOST = "smtp.gmail.com";
});

test("reset token stores only its hash, validates, resets the password, invalidates sessions and cannot be reused", async () => {
  clearRateLimitsForTests();
  const token = randomBytes(32).toString("hex");
  await PasswordResetToken.create({ user: user._id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) });
  const oldSession = createAuthToken(user);
  assert.equal(await PasswordResetToken.findOne({ user: user._id }).then((record) => record.tokenHash === token), false);
  await request(app).get("/api/auth/reset-password/validate").query({ token }).expect(200).expect({ valid: true });
  await request(app).post("/api/auth/reset-password").send({ token, password: "new-password-123" }).expect(200);
  const saved = await User.findById(user._id).select("+password +tokenVersion");
  assert.equal(saved.tokenVersion, 1);
  assert.equal(await saved.comparePassword("new-password-123"), true);
  assert.equal(await PasswordResetToken.countDocuments({ user: user._id }), 0);
  await request(app).get("/api/auth/me").set("Authorization", `Bearer ${oldSession}`).expect(401);
  await request(app).post("/api/auth/reset-password").send({ token, password: "another-password" }).expect(400);
  await request(app).post("/api/auth/login").send({ email: user.email, password: "new-password-123" }).expect(200);
});

test("invalid and expired reset tokens are rejected", async () => {
  clearRateLimitsForTests();
  await request(app).post("/api/auth/reset-password").send({ token: "not-a-valid-token-at-all-00000000000000", password: "valid-password" }).expect(400);
  const expired = randomBytes(32).toString("hex");
  await PasswordResetToken.create({ user: user._id, tokenHash: digest(expired), expiresAt: new Date(Date.now() - 1000) });
  await request(app).get("/api/auth/reset-password/validate").query({ token: expired }).expect(400);
  await request(app).post("/api/auth/reset-password").send({ token: expired, password: "valid-password" }).expect(400);
});

test("password validation rejects short passwords and leaves a valid reset token usable", async () => {
  clearRateLimitsForTests();
  const token = randomBytes(32).toString("hex");
  await PasswordResetToken.create({ user: user._id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) });
  await request(app).post("/api/auth/reset-password").send({ token, password: "short" }).expect(400);
  assert.equal(await PasswordResetToken.countDocuments({ tokenHash: digest(token) }), 1);
});

test("forgot password endpoint rate limits repeated requests", async () => {
  clearRateLimitsForTests();
  delete process.env.SMTP_HOST;
  for (let index = 0; index < 5; index += 1) await request(app).post("/api/auth/forgot-password").send({ email: "unknown@example.test" }).expect(503);
  await request(app).post("/api/auth/forgot-password").send({ email: "unknown@example.test" }).expect(429);
  process.env.SMTP_HOST = "smtp.gmail.com";
});
