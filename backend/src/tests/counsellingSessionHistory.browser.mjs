// Focused session history and shared wellness UI verification against disposable MongoDB.
// No .env, seeds, existing users, or application database connections.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
process.env.NODE_ENV = "test";
process.env.COUNSELLOR_BRIEFING_PROVIDER = "openai";
process.env.COUNSELLOR_BRIEFING_ALLOW_CLOUD = "false";
process.env.JWT_SECRET = "counsellor-summary-isolated-verification-secret-at-least-32-characters";
process.env.MONGOMS_DOWNLOAD_DIR = path.join(root, ".test-cache/mongodb");
delete process.env.OPENAI_API_KEY;
const { default: app } = await import("../app.js");
const { configureSocketServer } = await import("../socket.js");
const { default: User } = await import("../models/User.js");
const { default: Appointment } = await import("../models/Appointment.js");

const { initialWellnessContract: contract } = await import("../utils/initialWellnessAssessment.js");
const { DEPARTMENTS, STUDENT_YEARS } = await import("../constants/studentOptions.js");
let database, server, chrome, ws, io, failNextRequest;
const originalFetch = globalThis.fetch;
const pending = new Map(), browserErrors = [];
let sequence = 0, checks = 0;
const password = "Overview-disposable-only-password-2026";
function pass(name) { console.log("PASS " + (++checks) + ": " + name); }
try {
  database = await MongoMemoryServer.create({ instance: { dbName: "counsellor_summary_ui_test" } });
  const uri = database.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri);
  await User.init();
  await Appointment.init();
  assert.equal(await User.countDocuments(), 0);
  const site = express();
  site.use((req, res, next) => {
    if (failNextRequest && req.method === failNextRequest.method && req.path === failNextRequest.path) {
      failNextRequest = null;
      return res.status(503).json({ message: "Isolated test transport failure" });
    }
    return req.path.startsWith("/api/") ? app(req, res, next) : next();
  });
  const dist = path.join(root, "frontend/dist");
  site.get("/assets/:file", (req, res, next) => {
    if (!req.params.file.endsWith(".js")) return next();
    // Only the served test response changes the development API origin.
    res.type("js").send(fs.readFileSync(path.join(dist, "assets", path.basename(req.params.file)), "utf8").replaceAll("http://localhost:5000", ""));
  });
  site.use(express.static(dist));
  site.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  server = await new Promise(resolve => { const listener = site.listen(0, "127.0.0.1", () => resolve(listener)); });
  io = configureSocketServer(server);
  const origin = "http://127.0.0.1:" + server.address().port;
  async function api(route, method = "GET", body, account, status = 200) {
    const response = await fetch(origin + "/api" + route, {
      method, headers: { "Content-Type": "application/json", ...(account ? { Authorization: "Bearer " + account.token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const result = await response.json();
    assert.equal(response.status, status, method + " " + route + ": " + JSON.stringify(result));
    return result;
  }
  async function register(name) {
    const account = { name, email: name.replaceAll(" ", "-").toLowerCase() + "@summary-ui.test" };
    await api("/auth/register", "POST", { ...account, password, role: "student" }, undefined, 201);
    return { ...account, ...await api("/auth/login", "POST", { email: account.email, password }) };
  }
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "wellness-fresh-browser-"));
  const executable = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
  chrome = spawn(executable, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--remote-debugging-port=0", "--user-data-dir=" + profileDir, "about:blank"
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chrome startup timeout")), 15000);
    chrome.stderr.on("data", chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    chrome.on("error", reject);
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") browserErrors.push(message.params.args.map(arg => arg.value || arg.description).join(" "));
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
  };
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 10000);
      pending.set(id, {
        resolve: result => { clearTimeout(timer); resolve(result); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  const target = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Network.enable");
  await cdp("Network.setBlockedURLs", { urls: ["http://localhost:5000/*"] });
  await cdp("Emulation.setTimezoneOverride", { timezoneId: "Asia/Kolkata" });
  async function evaluate(expression) {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression) {
    for (let attempt = 0; attempt < 150; attempt++) {
      try { if (await evaluate(expression)) return; } catch (error) {
        if (!/context|navigat/i.test(error.message)) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Browser condition failed: " + expression + "\n" + await evaluate("document.body.innerText"));
  }
  const sees = text => until("document.body.innerText.includes(" + JSON.stringify(text) + ")");
  async function navigate(route) {
    await cdp("Page.navigate", { url: origin + route });
    await until("location.origin === " + JSON.stringify(origin) + " && document.readyState === 'complete'");
  }
  async function setInput(selector, value) {
    await until("!!document.querySelector(" + JSON.stringify(selector) + ")");
    await evaluate("(() => { const e = document.querySelector(" + JSON.stringify(selector) + ");" +
      "Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set.call(e, " + JSON.stringify(String(value)) + ");" +
      "e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); })()");
  }
  async function click(text) {
    await until("[...document.querySelectorAll('button,a')].some(e => e.textContent.trim() === " + JSON.stringify(text) + ")");
    await evaluate("[...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === " + JSON.stringify(text) + ").click()");
  }
  async function login(account) {
    await navigate("/login");
    await setInput('[name="email"]', account.email);
    await setInput('[name="password"]', password);
    await click("Login");
    await until("!!localStorage.getItem('wellness_auth') && location.pathname !== '/login'");
    return { ...account, ...await evaluate("JSON.parse(localStorage.getItem('wellness_auth'))") };
  }
  async function logout() {
    await navigate("/");
    await click("Sign out");
    await until("!localStorage.getItem('wellness_auth')");
  }

  const student = await register("History Student");
  const otherStudent = await register("Other Student");
  const counsellorAccount = { name: "History Counsellor", email: "counsellor@history-ui.test" };
  await User.create({ ...counsellorAccount, password, role: "counsellor", isActive: true });
  const counsellor = { ...counsellorAccount, ...await api("/auth/login", "POST", { email: counsellorAccount.email, password }) };
  const profile = { rollNumber: "1234", urn: "12345678", department: DEPARTMENTS[0], year: STUDENT_YEARS[0], wellnessGoals: ["Improve sleep"], consentForCounsellorSummary: true };
  await api("/profile/me", "PUT", profile, student);
  const responses = { ...Object.fromEntries(contract.questions.filter(q => !q.optional).map(q => [q.id, q.options[2]])), sleepQuality: "Poor", sleepHours: "5–6", additionalNotes: "PRIVATE_ASSESSMENT_TEXT" };
  await api("/profile/me/initial-assessment", "PUT", { schemaVersion: contract.version, responses }, student);
  await api("/tracking/moods", "POST", { mood: "low", stressLevel: 4, sleepHours: 5 }, student, 201);
  async function book(account, day) {
    const scheduled = new Date(Date.now() + 86400000 * day); scheduled.setUTCHours(10, 30, 0, 0);
    const result = await api("/counselling/appointments", "POST", { counsellorId: counsellor.user.id, scheduledFor: scheduled.toISOString(), concernType: "sleep", shareSummary: true }, account, 201);
    const id = result.appointment._id;
    await api(`/counselling/appointments/${id}/status`, "PATCH", { status: "approved" }, counsellor);
    return id;
  }
  const older = await book(student, 2), current = await book(student, 3), other = await book(otherStudent, 4);
  const message = (content, id) => ({ content, clientMessageId: id });
  await api(`/counselling/appointments/${older}/chat/messages`, "POST", message("Earlier saved student message", "bd6b183d-a58d-4d1e-8a75-33705bf98e8e"), student, 201);
  await api(`/counselling/appointments/${older}/chat/messages`, "POST", message("Earlier saved counsellor reply", "86299276-84f7-42ab-ade8-882f89f3197d"), counsellor, 201);
  await api(`/counselling/appointments/${older}/status`, "PATCH", { status: "completed" }, counsellor);
  await api(`/counselling/appointments/${current}/notes`, "PATCH", { counsellorNotes: "PRIVATE_COUNSELLOR_NOTE", progressUpdate: "Shared progress" }, counsellor);
  const route = id => `/counselling/${id}/session`;
  const base = `/counselling/appointments/${current}`;
  async function choose(id) {
    await evaluate(`document.querySelector('nav[aria-label="Saved counselling conversations"] a[href="${route(id)}"]').click()`);
    await until(`location.pathname === ${JSON.stringify(route(id))}`);
  }
  await login(student); await navigate(route(current)); await sees("Connected"); await sees("Session history");
  await until(`document.querySelectorAll('nav[aria-label="Saved counselling conversations"] a').length === 2`);
  assert.ok(!await evaluate(`!!document.querySelector('nav a[href="${route(other)}"]')`));
  await setInput("#counselling-message", "New saved student message"); await click("Send message"); await sees("New saved student message");
  await choose(older); await sees("Earlier saved student message"); await sees("Earlier saved counsellor reply"); await sees("This session is complete.");
  assert.ok(!await evaluate("!!document.querySelector('#counselling-message')"));
  assert.doesNotMatch(await evaluate("document.querySelector('[role=log]').innerText"), /New saved student message/);
  await choose(current); await sees("New saved student message");
  await navigate(route(current)); await sees("New saved student message");
  await logout(); await login(student); await navigate(route(current)); await sees("New saved student message");
  assert.doesNotMatch(await evaluate("document.body.innerText"), /PRIVATE_COUNSELLOR_NOTE|Wellness overview|PRIVATE_ASSESSMENT_TEXT/);
  pass("student sidebar selects completed/approved sessions, preserves per-appointment history after refresh/relogin and excludes another student's session");

  await logout(); await login(counsellor); await navigate(route(current)); await sees("Connected");
  await sees("New saved student message"); await sees("Wellness overview"); await sees("AVERAGE MOOD"); await sees("Initial assessment");
  assert.ok(!(await evaluate("document.body.innerText")).includes("Poor"), "assessment responses start collapsed");
  await sees("AI-assisted pre-session briefing");
  const sessionText = await evaluate("document.body.innerText");
  assert.ok(sessionText.indexOf("AI-assisted pre-session briefing") < sessionText.indexOf("Session chat history"));
  await sees("Local AI generation is unavailable");
  assert.doesNotMatch(await evaluate("document.body.innerText"), /PRIVATE_COUNSELLOR_NOTE|PRIVATE_ASSESSMENT_TEXT/);
  await setInput("#counselling-message", "New saved counsellor reply"); await click("Send message"); await sees("New saved counsellor reply");
  await choose(older); await sees("Earlier saved counsellor reply"); await sees("Shared wellness information is available only for pending or approved appointments.");
  await choose(current); await sees("Initial assessment");
  await evaluate("(() => { const e = [...document.querySelectorAll('summary')].find(e => e.textContent.trim() === 'Initial assessment'); if (!e.parentElement.open) e.click(); })()");
  await sees("Poor"); await sees("New saved counsellor reply");
  await navigate(route(current)); await sees("New saved counsellor reply");
  await logout(); await login(counsellor); await navigate(route(current)); await sees("New saved counsellor reply");
  await evaluate("(() => { const e = [...document.querySelectorAll('summary')].find(e => e.textContent.trim() === 'Initial assessment'); if (!e.parentElement.open) e.click(); })()"); await sees("Poor");
  pass("counsellor sidebar retains both message directions after navigation/refresh/relogin and shows the authorized factual assessment inside the session");

  await api(base + "/sharing", "PATCH", { shareSummary: false }, student);
  await click("Refresh overview"); await sees("“Allow summary sharing” is off for this appointment");
  assert.ok(!(await evaluate("document.body.innerText")).includes("Initial assessment"));
  await sees("New saved counsellor reply");
  await api(base + "/sharing", "PATCH", { shareSummary: true }, student);
  await api("/profile/me", "PUT", { ...profile, consentForCounsellorSummary: false }, student);
  await click("Refresh overview"); await sees("“Counsellor summary consent” is off in the student’s Profile");
  assert.ok(!(await evaluate("document.body.innerText")).includes("Initial assessment"));
  await api("/profile/me", "PUT", profile, student);
  await click("Refresh overview"); await sees("Initial assessment");
  await evaluate("(() => { const e = [...document.querySelectorAll('summary')].find(e => e.textContent.trim() === 'Initial assessment'); if (!e.parentElement.open) e.click(); })()");
  await sees("Poor");
  pass("both consent gates hide wellness details while chat remains usable; factual overview works without an OpenAI key");

  failNextRequest = { method: "GET", path: "/api/counselling/appointments" };
  await click("Refresh history"); await sees("We couldn’t load your session history.");
  await click("Refresh history");
  await until(`document.querySelectorAll('nav[aria-label="Saved counselling conversations"] a').length === 3`);
  await sees("New saved counsellor reply");
  for (const width of [1440, 768, 390, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Overflow at " + width);
  }
  assert.deepEqual(browserErrors, []);
  pass("sidebar retry preserves the open chat; mobile/tablet/desktop have no overflow or browser exceptions");
  await logout(); await login(student); await navigate(route(current)); await sees("New saved counsellor reply");
  const aHistory = await api(base + "/chat", "GET", undefined, student);
  const cHistory = await api(base + "/chat", "GET", undefined, counsellor);
  assert.deepEqual(aHistory.messages, cHistory.messages);
  assert.equal(aHistory.messages.length, 2);
  await api(`/counselling/appointments/${other}/chat`, "GET", undefined, student, 404);
  pass("both participants retrieve identical persisted messages; no duplicates or cross-student access");
  console.log("RESULT: " + checks + " session history UI groups passed. No live OpenAI calls.");
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally {
  globalThis.fetch = originalFetch; delete process.env.OPENAI_API_KEY;
  ws?.close(); chrome?.kill();
  if (io) await new Promise(resolve => io.close(resolve));
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await mongoose.disconnect(); await database?.stop();
  console.log("CLEANUP: disposable test database stopped; no existing application records were accessed or modified.");
}
