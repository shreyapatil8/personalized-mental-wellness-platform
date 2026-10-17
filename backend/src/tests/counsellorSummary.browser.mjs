// Focused counsellor-summary UI verification; simulated Ollama transport is NOT live generation.
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
process.env.COUNSELLOR_BRIEFING_PROVIDER = "ollama";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
process.env.OLLAMA_MODEL = "qwen3:1.7b";
process.env.JWT_SECRET = "counsellor-summary-isolated-verification-secret-at-least-32-characters";
process.env.MONGOMS_DOWNLOAD_DIR = path.join(root, ".test-cache/mongodb");
delete process.env.OPENAI_API_KEY;
const { default: app } = await import("../app.js");
const { default: User } = await import("../models/User.js");
const { default: Appointment } = await import("../models/Appointment.js");

const { initialWellnessContract: contract } = await import("../utils/initialWellnessAssessment.js");
const { DEPARTMENTS, STUDENT_YEARS } = await import("../constants/studentOptions.js");
let database, server, chrome, ws, failNextRequest;
const originalFetch = globalThis.fetch;
let localOnline = false;
globalThis.fetch = (url, options) => {
  if (String(url).startsWith("http://127.0.0.1:11434/")) throw new Error("Simulated offline Ollama");
  return originalFetch(url, options);
};
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
  async function expandInitialAssessment() {
    await until("[...document.querySelectorAll('summary')].some(e => e.textContent.trim() === 'Initial assessment')");
    assert.equal(await evaluate("[...document.querySelectorAll('summary')].find(e => e.textContent.trim() === 'Initial assessment').parentElement.open"), false, "Initial assessment starts collapsed");
    await evaluate("(() => { const e = [...document.querySelectorAll('summary')].find(e => e.textContent.trim() === 'Initial assessment'); if (!e.parentElement.open) e.click(); })()");
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
  const student = await register("Summary Student");
  // Exercise the real freshness callback without making the test wait a minute.
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    const originalInterval = window.setInterval;
    window.setInterval = (callback, delay, ...args) => {
      if (delay === 60000) window.runBriefingFreshnessCheck = callback;
      return originalInterval(callback, delay, ...args);
    };
  ` });
  const counsellorAccount = { name: "Summary Counsellor", email: "counsellor@summary-ui.test" };
  await User.create({ ...counsellorAccount, password, role: "counsellor", isActive: true });
  const counsellor = { ...counsellorAccount, ...await api("/auth/login", "POST", { email: counsellorAccount.email, password }) };
  await api("/profile/me", "PUT", { rollNumber: "1234", urn: "12345678", department: DEPARTMENTS[0], year: STUDENT_YEARS[0], wellnessGoals: ["Improve sleep"], consentForCounsellorSummary: true }, student);
  const answers = { ...Object.fromEntries(contract.questions.filter(q => !q.optional).map(q => [q.id, q.options[2]])), sleepQuality: "Poor", sleepHours: "5–6", additionalNotes: "Sleep is disrupted by late study sessions." };
  await api("/profile/me/initial-assessment", "PUT", { schemaVersion: contract.version, responses: answers }, student);
  await api("/tracking/moods", "POST", { mood: "low", stressLevel: 4, sleepHours: 5 }, student, 201);
  await api("/tracking/journals", "POST", { title: "Sleep reflection", content: "PRIVATE_JOURNAL_TEXT: noise makes sleep difficult." }, student, 201);
  const scheduled = new Date(Date.now() + 86400000 * 2); scheduled.setUTCHours(10, 30, 0, 0);
  const booking = await api("/counselling/appointments", "POST", { counsellorId: counsellor.user.id, scheduledFor: scheduled.toISOString(), concernType: "sleep", notes: "Academic workload and career preparation affect my sleep.", shareSummary: true }, student, 201);
  const base = "/counselling/appointments/" + booking.appointment._id;
  await login(counsellor); await navigate("/counselling");
  await sees("Initial assessment"); await expandInitialAssessment(); await sees("Poor");
  await sees("AI-assisted pre-session briefing"); await sees(answers.additionalNotes);
  await sees("Academic workload and career preparation affect my sleep.");
  await sees("Local AI is unavailable.");
  assert.ok(await evaluate("[...document.querySelectorAll('button')].find(e => e.textContent === 'Generate AI briefing').disabled"));
  await click("Approve"); await sees("Appointment marked Approved."); await sees("Initial assessment");
  assert.equal((await api("/counselling/appointments", "GET", undefined, counsellor)).appointments[0].status, "approved");
  assert.doesNotMatch(await evaluate("document.body.innerText"), /PRIVATE_BASELINE_TEXT|PRIVATE_JOURNAL_TEXT/);
  pass("pending/approved appointment factual overview works; offline Ollama explicitly disables generation without a fake result");

  let mode = "success", release, providerStarted = false;
  const draft = "Current context\nThe student reported poor sleep.\nAreas to explore\nAsk how rest feels now. [SIMULATED TRANSPORT TEST]";
  globalThis.fetch = async (url, options) => {
    if (String(url) === "http://127.0.0.1:11434/api/show") {
      if (!localOnline) throw new Error("Simulated offline Ollama");
      return { ok: true, json: async () => ({ details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] }) };
    }
    if (String(url) === "http://127.0.0.1:11434/api/chat") {
      providerStarted = true;
      const body = JSON.parse(options.body);
      assert.equal(body.stream, false);
      assert.match(body.messages[1].content, /Sleep quality:/);
      assert.doesNotMatch(body.messages[1].content, /PRIVATE_BASELINE_TEXT|PRIVATE_COUNSELLOR_NOTE|PRIVATE_JOURNAL_TEXT/);
      assert.ok(body.messages[1].content.includes(answers.additionalNotes));
      if (mode === "fail") return { ok: false, status: 503 };
      if (mode === "wait") await new Promise(resolve => { release = resolve; });
      return { ok: true, json: async () => ({ done: true, done_reason: "stop", message: { role: "assistant", content: draft } }) };
    }
    assert.ok(String(url).startsWith(origin), "Only isolated loopback requests are permitted");
    return originalFetch(url, options);
  };
  localOnline = true;
  await click("Refresh overview"); await sees("Recorded wellness measures");
  await until("[...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Generate AI briefing' && !e.disabled)");
  mode = "wait";
  await click("Generate AI briefing"); await sees("Generating briefing.");
  for (let attempt = 0; attempt < 100 && !release; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(providerStarted);
  await sees("Initial assessment"); await sees("Poor");
  release(); await sees("Ask how rest feels now."); await sees("Generated locally");
  await sees("Backend-calculated from shared records");
  await navigate("/counselling"); await sees("Ask how rest feels now.");
  mode = "fail";
  await click("Regenerate AI briefing"); await sees("The AI briefing could not be generated."); await sees("Ask how rest feels now.");
  pass("a failed refresh retains the previously saved briefing and factual overview");
  mode = "success";
  localOnline = false;
  await click("Refresh overview"); await sees("Local AI is unavailable."); await sees("Ask how rest feels now.");
  localOnline = true;
  await click("Refresh overview");
  await until("[...document.querySelectorAll('button')].some(e => e.textContent.includes('AI briefing') && !e.disabled)");
  pass("simulated provider draft is distinct, dated and retained after refresh; factual information stays visible during generation");

  await api(base + "/notes", "PATCH", { counsellorNotes: "PRIVATE_COUNSELLOR_NOTE", progressUpdate: "SHARED_PROGRESS" }, counsellor);
  const studentAppointments = await api("/counselling/appointments", "GET", undefined, student);
  assert.doesNotMatch(JSON.stringify(studentAppointments), /PRIVATE_COUNSELLOR_NOTE|SIMULATED TRANSPORT/);
  assert.match(JSON.stringify(studentAppointments), /SHARED_PROGRESS/);
  await api("/tracking/moods", "POST", { mood: "good", stressLevel: 2, sleepHours: 8 }, student, 201);
  await evaluate("window.runBriefingFreshnessCheck()"); await sees("Saved briefing is out of date for the current shared records.");
  assert.ok(!(await evaluate("document.body.innerText")).includes("Ask how rest feels now."));
  mode = "fail";
  await click("Generate AI briefing"); await sees("The AI briefing could not be generated."); await sees("Initial assessment");
  assert.ok(!(await evaluate("document.body.innerText")).includes("Ask how rest feels now."), "stale briefing text stays hidden after a failed retry");
  mode = "success";
  await click("Generate AI briefing"); await sees("Ask how rest feels now.");
  pass("stale drafts are hidden, provider errors are actionable and retry works; student gets shared progress but not private notes/draft");

  await api(base + "/sharing", "PATCH", { shareSummary: false }, student);
  await click("Refresh overview"); await sees("“Allow summary sharing” is off for this appointment");
  assert.ok(!(await evaluate("document.body.innerText")).includes("Ask how rest feels now."));
  assert.ok(!(await evaluate("document.body.innerText")).includes("Initial assessment"));
  await api(base + "/sharing", "PATCH", { shareSummary: true }, student);
  await click("Refresh overview"); await sees("Initial assessment");
  await until("[...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Generate AI briefing' && !e.disabled)");
  mode = "wait"; release = undefined;
  await click("Generate AI briefing"); await sees("Generating briefing.");
  for (let attempt = 0; attempt < 100 && !release; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  await api(base + "/sharing", "PATCH", { shareSummary: false }, student);
  release(); await sees("“Allow summary sharing” is off for this appointment");
  assert.ok(!(await evaluate("document.body.innerText")).includes("Ask how rest feels now."));
  await click("Complete"); await sees("Shared wellness information is available only for pending or approved appointments.");
  pass("refresh revocation and consent changes during generation hide private information; completed session obeys existing restriction");

  for (const width of [1440, 768, 390, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Overflow at " + width);
  }
  assert.deepEqual(browserErrors, []);
  pass("summary UI has no browser exceptions/console errors or viewport overflow");
  console.log("RESULT: " + checks + " summary UI groups passed. Provider responses were explicitly simulated; live model generation was NOT verified by this simulated test.");
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally {
  globalThis.fetch = originalFetch; delete process.env.OPENAI_API_KEY;
  ws?.close(); chrome?.kill();
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await mongoose.disconnect(); await database?.stop();
  console.log("CLEANUP: disposable test database stopped; no existing application records were accessed or modified.");
}
