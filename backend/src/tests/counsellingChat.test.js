import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import { configureSocketServer } from "../socket.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import CounsellingMessage from "../models/CounsellingMessage.js";
import ConversationMessage from "../models/ConversationMessage.js";
import { createAuthToken } from "../utils/tokens.js";

// Reuse the installed frontend Socket.io client; never load .env or the application DB.
const { io: client } = createRequire(new URL("../../../frontend/package.json", import.meta.url))("socket.io-client");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "disposable-counselling-chat-integration-secret";
process.env.MONGOMS_DOWNLOAD_DIR = fileURLToPath(new URL("../../../.test-cache/mongodb", import.meta.url));
let db, server, io, origin, a, b, c, d, admin, appointment, otherAppointment, sa, sc;
const sockets = [];
const privateNote = "PRIVATE_COUNSELLOR_NOTE_NEVER_CHAT";
const header = (account) => ({ Authorization: `Bearer ${account.token}` });
const chatPath = (id = appointment) => `/api/counselling/appointments/${id}/chat`;
const packet = (content, id = randomUUID()) => ({ appointmentId: appointment, content, clientMessageId: id });
const ack = (socket, event, payload) => new Promise((resolve, reject) => socket.timeout(5000).emit(event, payload, (err, value) => err ? reject(err) : resolve(value)));
const event = (socket, name) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(name, listener); reject(new Error(`No ${name} received`)); }, 5000);
  function listener(value) { clearTimeout(timer); resolve(value); }
  socket.once(name, listener);
});
async function connect(token, reject = false) {
  const socket = client(origin, { auth: token ? { token } : {}, transports: ["websocket"], reconnection: false, autoConnect: false });
  sockets.push(socket);
  const ready = event(socket, reject ? "connect_error" : "connect"); socket.connect(); await ready;
  return socket;
}
async function register(name, role) {
  const email = `${name}@chat.test`, password = "Disposable-password-2026";
  await request(app).post("/api/auth/register").send({ name, email, password, role }).expect(201);
  if (role === "counsellor") {
    const user = await User.findOne({ email });
    await request(app).patch(`/api/admin/users/${user.id}/status`).set(header(admin)).send({ isActive: true }).expect(200);
  }
  const result = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { ...result.body.user, token: result.body.token };
}
before(async () => {
  db = await MongoMemoryServer.create();
  assert.match(db.getUri(), /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(db.getUri());
  await Promise.all([User.init(), Appointment.init(), CounsellingMessage.init()]);
  const operator = await User.create({ name: "Disposable operator", email: "operator@chat.test", password: "Disposable-password-2026", role: "admin" });
  admin = { id: operator.id, token: createAuthToken(operator) };
  a = await register("StudentA", "student"); b = await register("StudentB", "student");
  c = await register("CounsellorA", "counsellor"); d = await register("CounsellorB", "counsellor");
  const slot = new Date(Date.now() + 86400000); slot.setUTCHours(10, 0, 0, 0);
  for (const [student, counsellor] of [[a, c], [b, d]]) {
    const response = await request(app).post("/api/counselling/appointments").set(header(student))
      .send({ counsellorId: counsellor.id, scheduledFor: slot.toISOString(), concernType: "general", shareSummary: false }).expect(201);
    if (student === a) appointment = response.body.appointment._id; else otherAppointment = response.body.appointment._id;
  }
  server = createServer(app); io = configureSocketServer(server);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 120000 });
after(async () => {
  sockets.forEach(socket => socket.disconnect());
  if (io) await new Promise(resolve => io.close(resolve));
  await mongoose.disconnect(); await db?.stop();
});

test("pending chat blocked on HTTP and sockets; only assigned counsellor can approve", async () => {
  sa = await connect(a.token); sc = await connect(c.token);
  await request(app).get(chatPath()).set(header(a)).expect(403);
  await request(app).post(chatPath() + "/messages").set(header(a)).send(packet("Pending message")).expect(403);
  assert.equal((await ack(sa, "counselling:join", { appointmentId: appointment })).ok, false);
  assert.equal((await ack(sc, "counselling:send", packet("Pending message"))).ok, false);
  await request(app).patch(`/api/counselling/appointments/${appointment}/status`).set(header(d)).send({ status: "approved" }).expect(403);
  await request(app).patch(`/api/counselling/appointments/${appointment}/status`).set(header(c)).send({ status: "approved" }).expect(200);
  await request(app).patch(`/api/counselling/appointments/${otherAppointment}/status`).set(header(d)).send({ status: "approved" }).expect(200);
  assert.equal((await ack(sa, "counselling:join", { appointmentId: appointment })).ok, true);
  assert.equal((await ack(sc, "counselling:join", { appointmentId: appointment })).ok, true);
});

test("unauthenticated, invalid, expired and admin sockets rejected; counsellor cannot use student AI events", async () => {
  for (const token of [undefined, "invalid", admin.token, jwt.sign({ sub: a.id }, process.env.JWT_SECRET, { expiresIn: -1 })]) {
    const socket = await connect(token, true); assert.equal(socket.connected, false);
  }
  assert.equal((await ack(sc, "chat:send", { message: "Must not invoke assistant" })).ok, false);
  assert.equal(await ConversationMessage.countDocuments(), 0);
});

test("reciprocal participant isolation, tampered IDs, room joins, and metadata privacy", async () => {
  await request(app).patch(`/api/counselling/appointments/${appointment}/notes`).set(header(c))
    .send({ counsellorNotes: privateNote, progressUpdate: "Shared progress remains available" }).expect(200);
  await request(app).get(chatPath()).expect(401);
  await request(app).get(chatPath()).set(header(admin)).expect(403);
  await request(app).get(chatPath("not-an-id")).set(header(a)).expect(400);
  for (const [account, id] of [[a, otherAppointment], [b, appointment], [c, otherAppointment], [d, appointment]]) {
    await request(app).get(chatPath(id)).set(header(account)).expect(404);
    await request(app).post(chatPath(id) + "/messages").set(header(account)).send(packet("Unauthorized")).expect(404);
    const socket = await connect(account.token);
    assert.equal((await ack(socket, "counselling:join", { appointmentId: id, student: a.id, counsellor: c.id })).ok, false);
    assert.equal((await ack(socket, "counselling:send", { ...packet("Unauthorized"), appointmentId: id })).ok, false);
    assert.equal(io.sockets.sockets.get(socket.id).rooms.has(`counselling:${id}`), false);
  }
  for (const account of [a, c]) {
    const result = await request(app).get(chatPath()).set(header(account)).expect(200);
    assert.equal(result.body.session.canSend, true);
    assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_COUNSELLOR|counsellorNotes|generatedSummary|email|password/);
  }
});

test("student and counsellor exchange real-time persisted messages; forged sender ignored", async () => {
  let receiving = event(sc, "counselling:message");
  const student = await ack(sa, "counselling:send", { ...packet("I want to talk about exam stress."), sender: d.id, recipient: b.id });
  assert.equal(student.ok, true); assert.equal((await receiving)._id, student.message._id);
  assert.equal(student.message.sender, a.id);
  receiving = event(sa, "counselling:message");
  const counsellor = await ack(sc, "counselling:send", packet("We can take this one step at a time."));
  assert.equal((await receiving)._id, counsellor.message._id);
  const history = await request(app).get(chatPath()).set(header(a)).expect(200);
  assert.deepEqual(history.body.messages.map(row => row.sender), [a.id, c.id]);
  assert.equal(await CounsellingMessage.countDocuments({ appointment }), 2);
  assert.equal(await ConversationMessage.countDocuments(), 0, "Counselling messages never enter AI history");
});

test("simultaneous socket/REST retries create one message; mismatched retry text rejected", async () => {
  const payload = packet("Retry this same message");
  const [first, second] = await Promise.all([
    ack(sa, "counselling:send", payload),
    request(app).post(chatPath() + "/messages").set(header(a)).send(payload).expect(201)
  ]);
  assert.equal(first.message._id, second.body.message._id);
  assert.equal(await CounsellingMessage.countDocuments({ appointment, clientMessageId: payload.clientMessageId }), 1);
  await request(app).post(chatPath() + "/messages").set(header(a)).send({ ...payload, content: "Different text" }).expect(409);
  const receiving = event(sc, "counselling:message");
  const rest = await request(app).post(chatPath() + "/messages").set(header(a)).send(packet("REST delivery while socket is unavailable")).expect(201);
  assert.equal((await receiving)._id, rest.body.message._id);
});

test("input limits, chronological pagination and reconnect catch-up do not lose or duplicate messages", async () => {
  for (const content of ["", "   ", "x".repeat(2001)]) {
    await request(app).post(chatPath() + "/messages").set(header(a)).send(packet(content)).expect(400);
    assert.equal((await ack(sa, "counselling:send", packet(content))).ok, false);
  }
  await request(app).post(chatPath() + "/messages").set(header(a)).send({ content: "Missing retry ID" }).expect(400);
  const prior = await request(app).get(chatPath()).set(header(a));
  const cursor = prior.body.messages.at(-1)._id;
  sa.disconnect();
  for (let i = 0; i < 52; i++) await request(app).post(chatPath() + "/messages").set(header(c)).send(packet(`Catch-up ${i}`)).expect(201);
  sa = await connect(a.token);
  assert.equal((await ack(sa, "counselling:join", { appointmentId: appointment })).ok, true);
  const first = await request(app).get(chatPath()).query({ after: cursor }).set(header(a)).expect(200);
  const second = await request(app).get(chatPath()).query({ after: first.body.messages.at(-1)._id }).set(header(a)).expect(200);
  assert.equal(first.body.hasMore, true); assert.equal(second.body.hasMore, false);
  const rows = [...first.body.messages, ...second.body.messages];
  assert.deepEqual(rows.map(row => row.content), Array.from({ length: 52 }, (_, i) => `Catch-up ${i}`));
  assert.equal(new Set(rows.map(row => row._id)).size, 52);
  const latest = await request(app).get(chatPath()).set(header(a)).expect(200);
  const older = await request(app).get(chatPath()).query({ before: latest.body.messages[0]._id }).set(header(a)).expect(200);
  assert.equal(latest.body.messages.length + older.body.messages.length, await CounsellingMessage.countDocuments({ appointment }));
  assert.equal((await ack(sa, "counselling:leave", { appointmentId: appointment })).ok, true);
  assert.equal(io.sockets.sockets.get(sa.id).rooms.has(`counselling:${appointment}`), false);
  await ack(sa, "counselling:join", { appointmentId: appointment });
});

test("disabled recipients lose room access and cannot receive further content or send", async () => {
  await request(app).patch(`/api/admin/users/${c.id}/status`).set(header(admin)).send({ isActive: false }).expect(200);
  let leaked = false; const listener = () => { leaked = true; }; sc.on("counselling:message", listener);
  const removed = event(sc, "counselling:unavailable");
  assert.equal((await ack(sa, "counselling:send", packet("Only active recipients may receive this"))).ok, true);
  await removed; assert.equal(leaked, false);
  assert.equal(io.sockets.sockets.get(sc.id).rooms.has(`counselling:${appointment}`), false);
  assert.equal((await ack(sc, "counselling:send", packet("Disabled sender"))).ok, false);
  sc.off("counselling:message", listener);
  await request(app).patch(`/api/admin/users/${c.id}/status`).set(header(admin)).send({ isActive: true }).expect(200);
  await ack(sc, "counselling:join", { appointmentId: appointment });
});

test("a token expiring after room join cannot receive or send further messages", async () => {
  const expiring = await connect(jwt.sign({ sub: a.id }, process.env.JWT_SECRET, { expiresIn: 2 }));
  assert.equal((await ack(expiring, "counselling:join", { appointmentId: appointment })).ok, true);
  let leaked = false; expiring.on("counselling:message", () => { leaked = true; });
  await new Promise(resolve => setTimeout(resolve, 2100));
  const removed = event(expiring, "counselling:unavailable");
  await request(app).post(chatPath() + "/messages").set(header(c)).send(packet("Do not deliver to expired sessions")).expect(201);
  await removed;
  assert.equal(leaked, false);
  assert.equal(io.sockets.sockets.get(expiring.id).rooms.has(`counselling:${appointment}`), false);
  assert.equal((await ack(expiring, "counselling:send", packet("Expired sender"))).ok, false);
});

test("completion updates participants live, retains read-only history and rejects sends", async () => {
  const changed = event(sa, "counselling:status");
  await request(app).patch(`/api/counselling/appointments/${appointment}/status`).set(header(c)).send({ status: "completed" }).expect(200);
  assert.equal((await changed).status, "completed");
  const history = await request(app).get(chatPath()).set(header(a)).expect(200);
  assert.equal(history.body.session.canSend, false); assert.ok(history.body.messages.length);
  for (const account of [a, c]) await request(app).post(chatPath() + "/messages").set(header(account)).send(packet("Closed")).expect(403);
  assert.equal((await ack(sa, "counselling:send", packet("Closed"))).ok, false);
});

test("cancellation revokes joined rooms, history and sending for both participants", async () => {
  const sb = await connect(b.token), sd = await connect(d.token);
  await ack(sb, "counselling:join", { appointmentId: otherAppointment });
  await ack(sd, "counselling:join", { appointmentId: otherAppointment });
  const changed = event(sd, "counselling:status");
  await request(app).patch(`/api/counselling/appointments/${otherAppointment}/status`).set(header(b)).send({ status: "cancelled" }).expect(200);
  assert.equal((await changed).status, "cancelled");
  for (const account of [b, d]) await request(app).get(chatPath(otherAppointment)).set(header(account)).expect(403);
  for (const socket of [sb, sd]) {
    assert.equal(io.sockets.sockets.get(socket.id).rooms.has(`counselling:${otherAppointment}`), false);
    assert.equal((await ack(socket, "counselling:join", { appointmentId: otherAppointment })).ok, false);
    assert.equal((await ack(socket, "counselling:send", { ...packet("Closed"), appointmentId: otherAppointment })).ok, false);
  }
  assert.equal(await CounsellingMessage.countDocuments({ appointment: otherAppointment }), 0);
});
