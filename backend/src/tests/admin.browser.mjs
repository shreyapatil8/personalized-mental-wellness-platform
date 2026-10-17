// Focused Admin UI checks against disposable MongoDB and the built frontend.
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
process.env.JWT_SECRET = "admin-isolated-verification-secret-at-least-32-characters";
process.env.MONGOMS_DOWNLOAD_DIR = path.join(root, ".test-cache/mongodb");
delete process.env.OPENAI_API_KEY;
const { default: app } = await import("../app.js");
const { default: User } = await import("../models/User.js");
const { default: Appointment } = await import("../models/Appointment.js");

let database, server, chrome, ws, failNextRequest;
const originalFetch = globalThis.fetch;
const pending = new Map(), browserErrors = [];
let sequence = 0, checks = 0;
const password = "Overview-disposable-only-password-2026";
function pass(name) { console.log("PASS " + (++checks) + ": " + name); }
try {
  database = await MongoMemoryServer.create({ instance: { dbName: "admin_ui_test" } });
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
    await until("[...document.querySelectorAll('button'), ...document.querySelectorAll('a')].some(e => e.textContent.trim() === " + JSON.stringify(text) + ")");
    await evaluate("[...document.querySelectorAll('button'), ...document.querySelectorAll('a')].find(e => e.textContent.trim() === " + JSON.stringify(text) + ").click()");
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

  const adminAccount = { name: "Programme Administrator", email: "admin@admin-ui.test" };
  await User.create({ ...adminAccount, password, role: "admin", isActive: true });
  const student = await register("Admin Student");
  const applicants = [];
  for (const name of ["Approve Counsellor", "Reject Counsellor"]) {
    const account = { name, email: name.replaceAll(" ", "-").toLowerCase() + "@admin-ui.test" };
    await api("/auth/register", "POST", { ...account, role: "counsellor", password, profile: { qualification: "MA Counselling", specialization: ["Student support"] } }, undefined, 201);
    applicants.push({ ...account, id: String((await User.findOne({ email: account.email }))._id) });
  }
  const admin = await login(adminAccount);
  await click("Open admin");
  await sees("Programme at a glance"); await sees("No recorded feature activity in this period.");
  await sees("Total students"); await sees("Pending counsellor requests");
  await click("User satisfaction"); await sees("No responses yet");
  assert.doesNotMatch(await evaluate("document.body.innerText"), /Request performance|HTTP routes|Server errors|ML prediction|Context snapshot|OpenAI|Research observation|Aggregate stress/);
  pass("real Admin login opens the new dashboard and feedback has an honest empty state");

  await click("Counsellor requests"); await sees("MA Counselling"); await sees("Student support");
  async function accountAction(id, label) {
    const selector = '[data-user-id="' + id + '"] button[aria-label="' + label + '"]';
    await until("!!document.querySelector(" + JSON.stringify(selector) + ") && !document.querySelector(" + JSON.stringify(selector) + ").disabled");
    await evaluate("document.querySelector(" + JSON.stringify(selector) + ").click()");
  }
  await accountAction(applicants[0].id, "Approve Approve Counsellor"); await sees("Approve Counsellor: approved.");
  await accountAction(applicants[1].id, "Reject Reject Counsellor"); await sees("Reject Counsellor: rejected.");
  await sees("No counsellor requests in this category.");
  await setInput("select", "rejected"); await sees("Reject Counsellor"); await sees("Account: Inactive");
  const approved = { ...applicants[0], ...await api("/auth/login", "POST", { email: applicants[0].email, password }) };
  await api("/auth/login", "POST", { email: applicants[1].email, password }, undefined, 403);
  pass("Approve and Reject persist; approved counsellor can sign in and rejected counsellor cannot");

  await click("User management");
  await setInput('input[placeholder="Search users"]', student.email);
  await sees("Admin Student"); await sees("Registered:"); await sees("Last sign-in:");
  await accountAction(student.user.id, "Deactivate Admin Student"); await sees("Admin Student: deactivated.");
  await api("/auth/login", "POST", { email: student.email, password }, undefined, 403);
  await accountAction(student.user.id, "Activate Admin Student"); await sees("Admin Student: activated.");
  await api("/auth/login", "POST", { email: student.email, password });
  failNextRequest = { method: "GET", path: "/api/admin/users" };
  await click("Refresh"); await sees("Isolated test transport failure");
  await click("Refresh"); await sees("Admin Student");
  pass("user search, registration/sign-in dates, activation, deactivation and retry work");

  await api("/tracking/moods", "POST", { mood: "low", stressLevel: 3, note: "PRIVATE_MOOD_NOTE" }, student, 201);
  await api("/tracking/journals", "POST", { title: "PRIVATE_JOURNAL_TITLE", content: "PRIVATE_JOURNAL_TEXT" }, student, 201);
  for (const [rating, helpfulness] of [[4, 5], [2, 3]]) await api("/feedback", "POST", { category: "overall", rating, helpfulness, comment: "PRIVATE_FEEDBACK_COMMENT" }, student, 201);
  const { default: ConversationMessage } = await import("../models/ConversationMessage.js");
  await ConversationMessage.create([{ student: student.user.id, role: "student", content: "PRIVATE_ASSISTANT_QUESTION" }, { student: student.user.id, role: "assistant", content: "PRIVATE_ASSISTANT_REPLY" }]);
  const scheduled = new Date(Date.now() + 2 * 86400000); scheduled.setUTCHours(10, 0, 0, 0);
  await Appointment.create({ student: student.user.id, counsellor: approved.user.id, status: "approved", scheduledFor: scheduled, concernType: "general", counsellorNotes: "PRIVATE_COUNSELLOR_NOTE", notes: "PRIVATE_APPOINTMENT_CONCERN" });
  await click("Usage & reports"); await click("Refresh");
  await sees("1 student has recorded activity"); await sees("Daily platform activity");
  await until("[...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes('AI Assistant messages') && row.querySelector('td')?.textContent === '1')");
  await click("Monthly"); await sees("Monthly report · last 30 days"); await sees("1 student has recorded activity in the last 30 days");
  await click("User satisfaction"); await sees("3.0 / 5"); await sees("4.0 / 5"); await sees("More feedback is needed to compare periods");
  const report = (await api("/admin/overview?period=monthly", "GET", undefined, admin)).overview;
  assert.equal(report.report.current.assistantMessages, 1);
  assert.equal(report.report.current.satisfaction.responses, 2);
  assert.equal(report.report.current.satisfaction.averageRating, 3);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|@admin-ui.test|@summary-ui.test|performance|modelName|riskCategory/);
  assert.doesNotMatch(await evaluate("document.body.innerText"), /PRIVATE_/);
  pass("weekly/monthly usage and feedback reflect saved records without exposing content or counting assistant replies");

  await click("Dashboard"); await sees("Programme at a glance");
  fs.writeFileSync(path.join(root, "tmp/admin-dashboard-desktop.png"), Buffer.from((await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
  for (const section of ["Dashboard", "Counsellor requests", "User management", "Usage & reports", "User satisfaction"]) {
    await click(section);
    for (const width of [1440, 768, 390, 320]) {
      await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), section + " overflow at " + width);
    }
  }
  await click("Usage & reports"); await sees("Daily platform activity");
  fs.writeFileSync(path.join(root, "tmp/admin-reports-mobile.png"), Buffer.from((await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
  assert.deepEqual(browserErrors, []);
  pass("all Admin sections fit desktop/tablet/mobile without browser errors");
  await logout(); await login(student); await navigate("/admin"); await sees("Admin access required");
  await api("/admin/overview", "GET", undefined, student, 403);
  pass("non-admin users cannot view the Admin workspace or its data");
  console.log("RESULT: " + checks + " Admin browser groups passed; all data disposable.");

} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally {
  globalThis.fetch = originalFetch; delete process.env.OPENAI_API_KEY;
  ws?.close(); chrome?.kill();
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await mongoose.disconnect(); await database?.stop();
  console.log("CLEANUP: disposable test database stopped; no existing application records were accessed or modified.");
}
