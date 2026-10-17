// Run from the repository root after pnpm build:
// node backend/src/tests/freshUser.browser.mjs
// No .env/application DB access. Local Ollama requests use an explicit test mock.
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
// Deterministic unavailable-provider case; never probe a developer's live model.
process.env.COUNSELLOR_BRIEFING_PROVIDER = "unsupported-test-provider";
process.env.JWT_SECRET = "fresh-user-disposable-test-secret-at-least-32-characters";
process.env.TZ = "Asia/Kolkata";
process.env.MONGOMS_DOWNLOAD_DIR = path.join(root, ".test-cache/mongodb");
const { default: app } = await import("../app.js");
const { configureSocketServer } = await import("../socket.js");
const { default: User } = await import("../models/User.js");
const { default: Appointment } = await import("../models/Appointment.js");
const { default: StudentProfile } = await import("../models/StudentProfile.js");
const { default: MoodLog } = await import("../models/MoodLog.js");
const { default: JournalEntry } = await import("../models/JournalEntry.js");
const { default: CounsellingMessage } = await import("../models/CounsellingMessage.js");
const { default: ConversationMessage } = await import("../models/ConversationMessage.js");
const { default: WellnessContextSnapshot } = await import("../models/WellnessContextSnapshot.js");
const { initialWellnessContract: contract } = await import("../utils/initialWellnessAssessment.js");
const { toLocalDateTimeInput } = await import("../../../frontend/src/utils/appointmentTime.js");
const { DEPARTMENTS, STUDENT_YEARS } = await import("../constants/studentOptions.js");
const browserFetch = globalThis.fetch;
const localMetadata = { details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] };
globalThis.fetch = async (input, init) => {
  if (String(input).startsWith("http://127.0.0.1:11434/")) {
    if (String(input).endsWith("/api/show")) return { ok: true, json: async () => localMetadata };
    const body = JSON.parse(init.body);
    const question = body.messages.at(-1)?.content || "";
    const content = question.includes("What should I do about it?")
      ? "About sleep you mentioned earlier, choose one small wind-down step tonight and notice whether it helps."
      : question.includes("saved records say")
        ? "Your saved assessment records poor sleep and study pressure. What feels different today?"
        : question.includes("friendships")
          ? "Your saved records include restful sleep and positive friendships. What would you like to understand?"
          : "A mocked local model reply: one small wind-down step may be a manageable place to start.";
    return { ok: true, json: async () => ({ done: true, done_reason: "stop", message: { role: "assistant", content } }) };
  }
  return browserFetch(input, init);
};

let database, server, io, chrome, ws, failNextChat = false, rejectSocketConnections = false;
const pending = new Map();
const browserErrors = [];
let failNextRequest;
let sequence = 0, checks = 0;
const password = "Fresh-user-only-password-2026";
const run = Date.now().toString(36);
const studentA = { name: "Fresh Student A", email: "a-" + run + "@fresh.test" };
const studentB = { name: "Fresh Student B", email: "b-" + run + "@fresh.test" };
const privateNote = "PRIVATE_COUNSELLOR_" + run;
const sharedProgress = "SHARED_PROGRESS_" + run + ": agreed a wind-down routine.";
const journalA = "A_PRIVATE_" + run + ": exam preparation interrupts my sleep at night.";
const journalB = "B_PRIVATE_" + run + ": enjoyed friends and feel rested.";
const noteA = "A_BASELINE_" + run + ": noisy dorm interrupts sleep.";
const noteB = "B_BASELINE_" + run + ": strong support from friends.";
const answersA = {
  ...Object.fromEntries(contract.questions.filter(q => !q.optional).map(q => [q.id, q.options[2]])),
  academicPressure: "High", sleepQuality: "Poor", sleepHours: "5–6",
  primaryConcern: "Academic/study pressure", preferredSupport: "Someone to talk to", additionalNotes: noteA
};
const answersB = {
  ...answersA, academicPressure: "Low", sleepQuality: "Very good", sleepHours: "7–8",
  primaryConcern: "Relationships/friendships", additionalNotes: noteB
};
function pass(name) { checks++; console.log("PASS " + checks + ": " + name); }

try {
  database = await MongoMemoryServer.create({ instance: { dbName: "fresh_user_verification" } });
  const testUri = database.getUri();
  assert.match(testUri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(testUri);
  await User.init();
  await Appointment.init();
  await CounsellingMessage.init();
  assert.equal(await User.countDocuments(), 0);

  const site = express();
  site.use((req, res, next) => {
    if (failNextRequest && req.method === failNextRequest.method && req.path === failNextRequest.path) {
      failNextRequest = null;
      return res.status(503).json({ message: "Test-only unavailable request" });
    }
    // A single simulated transport failure tests UI recovery, never AI output.
    if (failNextChat && req.method === "POST" && req.path === "/api/chat/messages") {
      failNextChat = false;
      return res.status(503).json({ message: "Disposable test transport unavailable; retry." });
    }
    return req.path.startsWith("/api/") ? app(req, res, next) : next();
  });
  const dist = path.join(root, "frontend/dist");
  assert.ok(fs.existsSync(path.join(dist, "index.html")), "Run pnpm build first.");
  site.get("/assets/:file", (req, res, next) => {
    if (!req.params.file.endsWith(".js")) return next();
    // Override the development API origin only in the served test response.
    // The build, env files and existing application are not altered.
    res.type("js").send(fs.readFileSync(path.join(dist, "assets", path.basename(req.params.file)), "utf8")
      .replaceAll("http://localhost:5000", ""));
  });
  site.use(express.static(dist));
  site.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  server = await new Promise(resolve => {
    const listener = site.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  process.env.CLIENT_ORIGIN = origin;
  io = configureSocketServer(server);
  io.use((_socket, next) => next(rejectSocketConnections ? new Error("Disposable test socket unavailable") : undefined));

  async function api(route, method = "GET", body, account, status = 200) {
    const response = await fetch(origin + "/api" + route, {
      method, headers: { "Content-Type": "application/json", ...(account ? { Authorization: "Bearer " + account.token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : null;
    assert.equal(response.status, status, method + " " + route + ": " + text);
    return result;
  }

  // Only the operator bootstrap is provisioned directly; all wellness records use HTTP.
  await User.create({ name: "Disposable Admin", email: "admin-" + run + "@fresh.test", password, role: "admin" });
  const admin = await api("/auth/login", "POST", { email: "admin-" + run + "@fresh.test", password });
  async function register(account, role = "student") {
    await api("/auth/register", "POST", { ...account, password, role }, undefined, 201);
    if (role === "counsellor") {
      await api("/auth/login", "POST", { email: account.email, password }, undefined, 403);
      const users = await api("/admin/users?role=counsellor&search=" + encodeURIComponent(account.email), "GET", undefined, admin);
      await api("/admin/users/" + users.users[0].id + "/status", "PATCH", { isActive: true }, admin);
    }
    return { ...account, ...await api("/auth/login", "POST", { email: account.email, password }) };
  }
  const counsellor = await register({ name: "Fresh Counsellor", email: "c-" + run + "@fresh.test" }, "counsellor");
  const unrelated = await register({ name: "Other Counsellor", email: "d-" + run + "@fresh.test" }, "counsellor");

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
    await until("[...document.querySelectorAll('button,a')].some(e => e.textContent.trim() === " + JSON.stringify(text) + " || e.getAttribute('aria-label') === " + JSON.stringify(text) + ")");
    await evaluate("[...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === " + JSON.stringify(text) + " || e.getAttribute('aria-label') === " + JSON.stringify(text) + ").click()");
  }
  async function expandDisclosure(text) {
    await until("[...document.querySelectorAll('summary')].some(e => e.textContent.trim() === " + JSON.stringify(text) + ")");
    await evaluate("[...document.querySelectorAll('summary')].find(e => e.textContent.trim() === " + JSON.stringify(text) + ").click()");
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
  async function relogin(account, route, expectedText) {
    await logout();
    const fresh = await login(account);
    assert.equal(fresh.user.id, account.user.id);
    await navigate(route);
    await sees(expectedText);
    // A second full page load independently proves retrieval.
    await navigate(route);
    await sees(expectedText);
    return fresh;
  }

  await navigate("/register");
  await until("!!document.querySelector('[name=name]')");
  assert.equal(await evaluate("document.querySelector('form').checkValidity()"), false);
  await setInput('[name="name"]', studentA.name);
  await setInput('[name="email"]', "not-an-email");
  assert.equal(await evaluate("document.querySelector('[name=email]').validity.typeMismatch"), true);
  await setInput('[name="email"]', studentA.email);
  await setInput('[name="password"]', password);
  await setInput('[name="confirmPassword"]', password + "-wrong");
  await click("Register");
  await sees("Passwords do not match");
  assert.equal(await User.countDocuments({ role: "student" }), 0);
  await setInput('[name="confirmPassword"]', password);
  await click("Register");
  await sees("Your account has been created");
  let a = await login(studentA);
  await sees("Start Assessment");
  a = await relogin(a, "/wellness-assessment", "Start Assessment");
  assert.equal(await User.countDocuments({ email: studentA.email }), 1);
  pass("new student registered in browser; logout/login retains the same account");

  await click("Start Assessment");
  await click("Next");
  await sees("Please choose a response before continuing.");
  for (let index = 0; index < contract.questions.length; index++) {
    const question = contract.questions[index];
    await sees("Question " + (index + 1) + " of 15");
    if (question.optional) await setInput("textarea", answersA[question.id]);
    else await evaluate("[...document.querySelectorAll('input[type=radio]')].find(e => e.value === " + JSON.stringify(answersA[question.id]) + ").click()");
    await click(index === 14 ? "Submit Assessment" : "Next");
  }
  await sees("Assessment complete");
  const savedA = await api("/profile/me/initial-assessment", "GET", undefined, a);
  assert.deepEqual(savedA.assessment.responses, answersA);
  assert.deepEqual((await StudentProfile.findOne({ user: a.user.id }).lean()).initialWellnessAssessment.responses, answersA);
  a = await relogin(a, "/wellness-assessment", noteA);
  pass("all 15 assessment answers entered in browser, persisted under A, reloaded after login");

  const profileInput = {
    rollNumber: "4827", urn: "82649173", department: DEPARTMENTS[0], year: STUDENT_YEARS[0], age: 21, gender: "Not specified",
    wellnessGoals: ["Improve sleep and study balance"], emergencyContact: { name: "Saved contact", phone: "5550100", relation: "Sibling" },
    consentForCounsellorSummary: true, consentForAssistantJournalContext: false
  };
  await StudentProfile.updateOne({ user: a.user.id }, { $set: profileInput });
  await navigate("/profile");
  await sees("My Profile");
  await sees(a.user.name);
  await sees(a.user.email);
  const profileFields = await evaluate(`(() => ({
    labels: document.body.innerText,
    inputs: [...document.querySelectorAll('input, select, textarea')].map(element => element.name || element.id),
    counsellorConsent: document.querySelector('#consentForCounsellorSummary').checked,
    journalConsent: document.querySelector('#consentForAssistantJournalContext').checked
  }))()`);
  for (const label of ["Roll number", "URN", "Department", "Academic details", "Emergency contact", "Wellness goals", "Age", "Gender"]) assert.equal(profileFields.labels.includes(label), false, `profile should not show ${label}`);
  for (const name of ["rollNumber", "urn", "department", "year", "age", "gender", "wellnessGoals", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation"]) assert.equal(profileFields.inputs.includes(name), false, `profile should not contain ${name}`);
  assert.equal(profileFields.counsellorConsent, true);
  assert.equal(profileFields.journalConsent, false);
  await evaluate("document.getElementById('consentForAssistantJournalContext').click()");
  await click("Save privacy settings");
  await sees("Privacy settings saved.");
  const savedProfile = (await api("/profile/me", "GET", undefined, a)).profile;
  assert.equal(savedProfile.consentForCounsellorSummary, true);
  assert.equal(savedProfile.consentForAssistantJournalContext, true);
  assert.equal(savedProfile.rollNumber, profileInput.rollNumber);
  assert.equal(savedProfile.urn, profileInput.urn);
  assert.equal(savedProfile.age, profileInput.age);
  assert.equal(savedProfile.gender, profileInput.gender);
  assert.deepEqual(savedProfile.wellnessGoals, profileInput.wellnessGoals);
  assert.deepEqual(savedProfile.emergencyContact, profileInput.emergencyContact);
  await click("View / Update Assessment");
  await sees("Your wellness assessment");
  pass("compact profile shows actual account details, hides legacy fields, preserves saved data and updates consent without resetting it; assessment link works");
  await navigate("/tracking?tab=mood");
  await until('!!document.querySelector("input[name=mood][value=low]")');
  await evaluate('document.querySelector("input[name=mood][value=low]").click()');
  await setInput('[name="stressLevel"]', 4);
  await setInput('[name="sleepHours"]', 5);
  await setInput("form textarea", "A_MOOD_" + run + ": tired after studying");
  await click("Save mood");
  await sees("Your mood has been recorded.");
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  await api("/tracking/moods", "POST", { mood: "good", stressLevel: 2, sleepHours: 8, loggedFor: yesterday, note: "A_YESTERDAY_" + run }, a, 201);
  a = await relogin(a, "/tracking?tab=mood", "A_YESTERDAY_" + run);
  await sees("A_MOOD_" + run);
  await sees("Stress 4/5");
  await sees("Stress 2/5");
  const moodsA = (await api("/tracking/moods", "GET", undefined, a)).moodLogs;
  assert.equal(moodsA.length, 2);
  assert.deepEqual(moodsA.map(m => m.mood), ["low", "good"]);
  assert.notEqual(moodsA[0].loggedFor.slice(0, 10), moodsA[1].loggedFor.slice(0, 10));
  assert.equal(await MoodLog.countDocuments({ student: a.user.id }), 2);
  pass("two new moods on different dates saved via UI/API and redisplayed after refresh/relogin");

  await navigate("/tracking?tab=journal");
  await until("!!document.querySelector('[name=title]')");
  assert.equal(await evaluate("document.querySelector('form').checkValidity()"), false);
  await setInput('[name="title"]', "Fresh exam and sleep reflection");
  await setInput("form textarea", journalA);
  await evaluate("document.querySelector('form details summary').click()");
  await setInput('[name="tags"]', "sleep, exam");
  await setInput('[name="sentiment"]', "negative");
  await click("Save journal");
  await sees("Your reflection has been saved.");
  a = await relogin(a, "/tracking?tab=journal", journalA);
  const journalsA = (await api("/tracking/journals", "GET", undefined, a)).journalEntries;
  assert.equal(journalsA.length, 1);
  assert.equal(journalsA[0].content, journalA);
  assert.equal((await JournalEntry.findOne({ student: a.user.id })).content, journalA);
  await StudentProfile.updateOne({ user: a.user.id }, { $set: { consentForAssistantJournalContext: true } });
  pass("new journal saved through browser, persisted and displayed after refresh/relogin");

  const dashboard = (await api("/dashboard/me", "GET", undefined, a)).dashboard;
  assert.equal(dashboard.overview.moodSummary.entries, 2);
  assert.equal(dashboard.overview.journalEntryCount, 1);
  assert.deepEqual(dashboard.profile.initialWellnessAssessment.responses, answersA);
  await navigate("/wellness-overview");
  await sees("Average mood");
  await sees("Average mood: " + dashboard.overview.moodSummary.averageMood + " / 5");
  await sees("Mood history");
  await evaluate("[...document.querySelectorAll('summary')].filter(e => e.textContent === 'View chart data').forEach(e => e.click())");
  const renderedMoodRows = await evaluate("[...document.querySelectorAll('table')[0].querySelectorAll('tbody tr')].map(row => [...row.cells].map(cell => cell.textContent))");
  assert.deepEqual(renderedMoodRows, dashboard.trend.moodDaily.map(day => [day.date, String(day.value), String(day.movingAverage)]));
  pass("dashboard API and rendered overview use fresh assessment/mood/journal data");

  // B's contrasting information is present before A's assistant requests.
  let b = await register(studentB);
  await api("/profile/me/initial-assessment", "PUT", { schemaVersion: contract.version, responses: answersB }, b);
  const moodB = (await api("/tracking/moods", "POST", { mood: "great", stressLevel: 1, sleepHours: 8, note: "B_MOOD_" + run }, b, 201)).moodLog;
  const entryB = (await api("/tracking/journals", "POST", { title: "Fresh friendship reflection", content: journalB, tags: ["friends"], sentiment: "positive" }, b, 201)).journalEntry;
  async function chatUI(message) {
    const before = await ConversationMessage.countDocuments({ student: a.user.id, role: "assistant" });
    await setInput("#assistant-message", message);
    await click("Send message");
    await until("!document.querySelector('#assistant-message').disabled");
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await ConversationMessage.countDocuments({ student: a.user.id, role: "assistant" }) > before) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const result = await ConversationMessage.findOne({ student: a.user.id, role: "assistant" }).sort({ createdAt: -1 });
    assert.equal(await ConversationMessage.countDocuments({ student: a.user.id, role: "assistant" }), before + 1);
    await sees(result.content);
    return result;
  }
  await navigate("/assistant");
  await sees("Your Wellness Assistant");
  const reply1 = await chatUI("I am having trouble sleeping because I keep thinking about my studies. What do my saved records say?");
  assert.equal(reply1.responseSource, "ollama");
  assert.match(reply1.content, /poor sleep and study pressure/i);
  const contextA = (await api("/intelligence/context/me", "GET", undefined, a)).context;
  assert.equal(contextA.student, a.user.id);
  assert.match(contextA.structuredPrompt, /Sleep quality: Poor/);
  for (const kind of ["initial_assessment", "initial_assessment_detail", "mood", "journal"]) {
    assert.ok(contextA.selectedItems.some(item => item.sourceType === kind), kind);
  }
  assert.match(JSON.stringify(contextA), new RegExp("A_PRIVATE_" + run));
  assert.doesNotMatch(JSON.stringify(contextA) + reply1.content, /B_PRIVATE_|B_BASELINE_|B_MOOD_/);
  const reply2 = await chatUI("What should I do about it?");
  assert.equal(reply2.responseSource, "ollama");
  assert.match(reply2.content, /sleep|wind.down|bedtime/i);
  assert.match(reply2.content, /earlier|continu|previous|mentioned|discuss/i);
  a = await relogin(a, "/assistant", reply2.content);
  await sees(reply1.content);
  const historyA = (await api("/chat/messages", "GET", undefined, a)).messages;
  assert.equal(historyA.length, 4);
  assert.equal(historyA[1].replyTo, historyA[0]._id);
  assert.equal(historyA[3].replyTo, historyA[2]._id);
  const snapshotsBeforeSafety = await WellnessContextSnapshot.countDocuments({ student: a.user.id });
  const safety = await chatUI("I cannot stay safe");
  assert.equal(safety.responseSource, "safety_message");
  assert.match(safety.content, /emergency services/);
  assert.equal(await WellnessContextSnapshot.countDocuments({ student: a.user.id }), snapshotsBeforeSafety);
  pass("browser assistant persists mocked Ollama replies, selected context, follow-up history and safety response");

  const replyB = await api("/chat/messages", "POST", { message: "What do you know about my sleep and friendships from my saved records?" }, b, 201);
  assert.equal(replyB.assistantMessage.responseSource, "ollama");
  const contextB = (await api("/intelligence/context/me", "GET", undefined, b)).context;
  assert.equal(contextB.student, b.user.id);
  assert.match(JSON.stringify(contextB), /Very good/);
  assert.doesNotMatch(JSON.stringify(contextB) + replyB.assistantMessage.content, /A_PRIVATE_|A_BASELINE_|A_MOOD_|A_YESTERDAY_/);
  for (const [actor, other, ownMood, otherMood, ownJournal, otherJournal] of [
    [a, b, moodsA[0], moodB, journalsA[0], entryB],
    [b, a, moodB, moodsA[0], entryB, journalsA[0]]
  ]) {
    const moods = await api("/tracking/moods?student=" + other.user.id, "GET", undefined, actor);
    assert.ok(moods.moodLogs.every(item => item.student === actor.user.id));
    assert.ok(moods.moodLogs.some(item => item._id === ownMood._id));
    const journals = await api("/tracking/journals?student=" + other.user.id, "GET", undefined, actor);
    assert.ok(journals.journalEntries.every(item => item.student === actor.user.id));
    assert.ok(journals.journalEntries.some(item => item._id === ownJournal._id));
    for (const [collection, record, update] of [["moods", otherMood, { mood: "neutral" }], ["journals", otherJournal, { content: "Unauthorized update" }]]) {
      await api("/tracking/" + collection + "/" + record._id, "PUT", update, actor, 404);
      await api("/tracking/" + collection + "/" + record._id, "DELETE", undefined, actor, 404);
    }
    const assessment = await api("/profile/me/initial-assessment?student=" + other.user.id, "GET", undefined, actor);
    assert.equal(assessment.assessment.responses.additionalNotes, actor.user.id === a.user.id ? noteA : noteB);
    const history = await api("/chat/messages?student=" + other.user.id, "GET", undefined, actor);
    assert.ok(history.messages.every(item => item.student === actor.user.id));
  }
  assert.equal((await JournalEntry.findById(journalsA[0]._id)).content, journalA);
  assert.equal((await JournalEntry.findById(entryB._id)).content, journalB);
  pass("two fresh students have separate records, assistant contexts and histories; reciprocal unauthorized writes/deletes fail");

  // Force REST transport, inject one HTTP failure, then retry through the normal composer.
  rejectSocketConnections = true;
  io.disconnectSockets(true);
  await cdp("Network.setBlockedURLs", { urls: ["http://localhost:5000/*", "*socket.io*"] });
  await navigate("/assistant");
  await sees("Your Wellness Assistant");
  const countBeforeFailure = await ConversationMessage.countDocuments({ student: a.user.id });
  failNextChat = true;
  await setInput("#assistant-message", "Can you help me plan tonight's wind-down?");
  await click("Send message");
  await sees("Disposable test transport unavailable");
  await until("[...document.querySelectorAll('[role=alert] button')].some(button => button.textContent.trim() === 'Retry' && !button.disabled)");
  assert.equal(await ConversationMessage.countDocuments({ student: a.user.id }), countBeforeFailure);
  await sees("Can you help me plan tonight's wind-down?");
  await click("Retry");
  await until("!document.querySelector('#assistant-message').disabled");
  const retry = await ConversationMessage.findOne({ student: a.user.id, role: "assistant" }).sort({ createdAt: -1 });
  await sees(retry.content);
  assert.equal(await ConversationMessage.countDocuments({ student: a.user.id }), countBeforeFailure + 2);
  assert.equal(retry.responseSource, "ollama");
  await cdp("Network.setBlockedURLs", { urls: ["http://localhost:5000/*"] });
  rejectSocketConnections = false;
  pass("failed assistant transport shows honest error, unlocks composer and succeeds on resubmission");

  await navigate("/counselling");
  await setInput('[name="counsellorId"]', counsellor.user.id);
  await setInput('[name="concernType"]', "sleep");
  const slot = new Date(Date.now() + 86400000);
  slot.setHours(10, 0, 0, 0);
  for (const minute of [0, 30]) {
    slot.setMinutes(minute);
    await setInput('[name="scheduledFor"]', toLocalDateTimeInput(slot));
    assert.equal(await evaluate("document.querySelector('input[type=datetime-local]').checkValidity()"), true);
  }
  slot.setMinutes(17);
  await setInput('[name="scheduledFor"]', toLocalDateTimeInput(slot));
  assert.equal(await evaluate("document.querySelector('input[type=datetime-local]').validity.stepMismatch"), true);
  await setInput('[name="scheduledFor"]', toLocalDateTimeInput(new Date(Date.now() - 86400000)));
  assert.equal(await evaluate("document.querySelector('input[type=datetime-local]').validity.rangeUnderflow"), true);
  slot.setMinutes(30);
  await setInput('[name="scheduledFor"]', toLocalDateTimeInput(slot));
  await evaluate("document.querySelector('form input[type=checkbox]').click()");
  await click("Book appointment");
  await sees("Appointment request sent.");
  const appointments = (await api("/counselling/appointments", "GET", undefined, a)).appointments;
  assert.equal(appointments.length, 1);
  const appointment = appointments[0];
  assert.equal(appointment.scheduledFor, slot.toISOString());
  assert.equal(await Appointment.countDocuments({ student: a.user.id }), 1);
  a = await relogin(a, "/counselling", "Pending");
  pass("fresh student books future half-hour through real browser; appointment persists after relogin");

  const summaryPath = "/counselling/appointments/" + appointment._id + "/summary";
  await logout();
  await login(counsellor);
  await navigate("/counselling");
  await expandDisclosure("Initial assessment");
  await sees("Student-reported baseline ·");
  await sees("5–6");
  await sees("Poor");
  const summary = (await api(summaryPath, "GET", undefined, counsellor)).summary;
  assert.equal(summary.initialAssessment.responses.find(item => item.id === "sleepQuality").response, "Poor");
  assert.equal(summary.initialAssessment.recordedAt, savedA.assessment.updatedAt);
  assert.equal(summary.narrative, null);
  assert.equal(summary.assessmentNote, noteA, "Relevant notes are shared only with both consent gates enabled");
  assert.doesNotMatch(JSON.stringify(summary), /A_PRIVATE_|B_PRIVATE_|B_BASELINE_/);
  await click("Approve");
  await sees("Appointment marked Approved.");
  await until("document.querySelectorAll('form textarea').length === 2");
  await setInput("form textarea:first-of-type", privateNote);
  // Textareas live in separate labels, so target the second element explicitly.
  await evaluate("document.querySelectorAll('form textarea')[1].setAttribute('data-test-progress','true')");
  await setInput("[data-test-progress]", sharedProgress);
  await click("Save session notes");
  await sees("Session notes saved.");
  assert.equal((await Appointment.findById(appointment._id).select("+counsellorNotes")).counsellorNotes, privateNote);
  // Two isolated browser contexts, each signed in through the real UI.
  const { browserContextId } = await send("Target.createBrowserContext");
  const studentTarget = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const attached = await send("Target.attachToTarget", { targetId: studentTarget.targetId, flatten: true });
  const studentCDP = (method, params) => send(method, params, attached.sessionId);
  await studentCDP("Page.enable"); await studentCDP("Runtime.enable"); await studentCDP("Network.enable");
  await studentCDP("Network.setBlockedURLs", { urls: ["http://localhost:5000/*"] });
  await studentCDP("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  async function studentEvaluate(expression) {
    const value = await studentCDP("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  }
  async function studentUntil(expression) {
    for (let i = 0; i < 150; i++) {
      try { if (await studentEvaluate(expression)) return; } catch (err) { if (!/context|navigat/i.test(err.message)) throw err; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Student browser condition failed: " + expression + "\n" + await studentEvaluate("document.body.innerText"));
  }
  const studentSees = (text) => studentUntil("document.body.innerText.includes(" + JSON.stringify(text) + ")");
  async function studentNavigate(route) {
    await studentCDP("Page.navigate", { url: origin + route });
    await studentUntil("location.origin === " + JSON.stringify(origin) + " && document.readyState === 'complete'");
  }
  async function studentFill(selector, value) {
    await studentUntil("!!document.querySelector(" + JSON.stringify(selector) + ")");
    await studentEvaluate("(() => { const e=document.querySelector(" + JSON.stringify(selector) + "); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e," + JSON.stringify(value) + "); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); })()");
  }
  async function studentClick(label) {
    await studentUntil("[...document.querySelectorAll('button,a')].some(e => e.textContent.trim() === " + JSON.stringify(label) + " || e.getAttribute('aria-label') === " + JSON.stringify(label) + ")");
    await studentEvaluate("[...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === " + JSON.stringify(label) + " || e.getAttribute('aria-label') === " + JSON.stringify(label) + ").click()");
  }
  async function studentLogin() {
    await studentNavigate("/login");
    await studentFill('[name="email"]', a.email); await studentFill('[name="password"]', password); await studentClick("Login");
    await studentUntil("!!localStorage.getItem('wellness_auth') && location.pathname !== '/login'");
  }
  const sessionRoute = `/counselling/${appointment._id}/session`;
  await studentLogin(); await studentNavigate("/counselling"); await studentClick("Open counselling chat");
  await studentSees("Connected");
  await click("Open counselling chat"); await sees("Connected");
  const studentMessage = "STUDENT_SESSION_" + run + ": I would like to talk about exam stress.";
  const counsellorReply = "COUNSELLOR_SESSION_" + run + ": We can talk through what feels most difficult.";
  await studentFill("#counselling-message", studentMessage); await studentClick("Send message");
  await sees(studentMessage); // No navigation or refresh on the receiving counsellor screen.
  await setInput("#counselling-message", counsellorReply); await click("Send message");
  await studentSees(counsellorReply); // No refresh on the receiving student screen.
  assert.equal(await CounsellingMessage.countDocuments({ appointment: appointment._id }), 2);
  assert.equal(await studentEvaluate("document.body.innerText.includes(" + JSON.stringify(privateNote) + ")"), false);
  const firstSessionMessage = await CounsellingMessage.findOne({ appointment: appointment._id, sender: a.user.id });
  await api(`/counselling/appointments/${appointment._id}/chat/messages`, "POST", { clientMessageId: firstSessionMessage.clientMessageId, content: firstSessionMessage.content }, a, 201);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await studentEvaluate("document.querySelectorAll('[data-message-id]').length"), 2);
  assert.equal(await evaluate("document.querySelectorAll('[data-message-id]').length"), 2);
  await studentNavigate(sessionRoute); await studentSees(counsellorReply);
  await studentNavigate("/"); await studentClick("Sign out");
  await studentUntil("!localStorage.getItem('wellness_auth')");
  await studentLogin(); await studentNavigate(sessionRoute); await studentSees(studentMessage); await studentSees(counsellorReply);
  await navigate(sessionRoute); await sees(studentMessage); await sees(counsellorReply);
  assert.ok(await studentEvaluate("document.documentElement.scrollWidth <= innerWidth"));
  const imageFolder = path.join(root, ".test-cache/ui-review"); fs.mkdirSync(imageFolder, { recursive: true });
  const sessionScreenshot = await studentCDP("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(imageFolder, "counselling-session-mobile.png"), Buffer.from(sessionScreenshot.data, "base64"));
  pass("two authenticated browser screens exchange live counselling messages, deduplicate broadcasts, retain history after refresh/relogin, and exclude private notes");

  // A forced transport outage exercises the actual REST fallback and same-ID retry.
  rejectSocketConnections = true; io.disconnectSockets(true);
  await studentCDP("Network.setBlockedURLs", { urls: ["http://localhost:5000/*", "*socket.io*"] });
  await studentNavigate(sessionRoute); await studentSees(counsellorReply); await studentSees("Connection unavailable");
  failNextRequest = { method: "POST", path: `/api/counselling/appointments/${appointment._id}/chat/messages` };
  const retryText = "SESSION_RETRY_" + run;
  await studentFill("#counselling-message", retryText); await studentClick("Send message");
  await studentSees("Retry message");
  assert.equal(await studentEvaluate("document.querySelector('#counselling-message').value"), retryText);
  await studentClick("Retry message"); await studentSees(retryText);
  assert.equal(await CounsellingMessage.countDocuments({ appointment: appointment._id, content: retryText }), 1);
  rejectSocketConnections = false;
  await studentCDP("Network.setBlockedURLs", { urls: ["http://localhost:5000/*"] });
  await studentNavigate(sessionRoute); await studentSees("Connected");
  await navigate(sessionRoute); await sees("Connected"); await sees(retryText);
  assert.equal(await studentEvaluate("document.querySelectorAll('[data-message-id]').length"), 3);
  pass("counselling network failure preserves draft, REST retry persists once, and reconnect reloads the saved conversation");
  const liveStudentSocket = [...io.sockets.sockets.values()].find(socket => String(socket.user._id) === a.user.id && socket.rooms.has(`counselling:${appointment._id}`));
  assert.ok(liveStudentSocket);
  liveStudentSocket.conn.close(); // A transport loss, not a page reload or a mocked chat.
  const missedText = "MISSED_WHILE_RECONNECTING_" + run;
  await api(`/counselling/appointments/${appointment._id}/chat/messages`, "POST", { clientMessageId: "adbd4195-4424-4d5f-b0fc-32dca88893e9", content: missedText }, counsellor, 201);
  await studentSees(missedText); await studentSees("Connected");
  assert.equal(await studentEvaluate("document.querySelectorAll('[data-message-id]').length"), 4);
  pass("student socket automatically reconnects and catches up a missed persisted counsellor message without refreshing");
  await send("Target.disposeBrowserContext", { browserContextId });
  await navigate("/counselling"); await expandDisclosure("Initial assessment"); await sees("Student-reported baseline ·");
  await sees("Local AI generation is unavailable");
  assert.ok(await evaluate("[...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Generate AI briefing').disabled"));
  await relogin(counsellor, "/counselling", "Initial assessment");
  assert.equal(await evaluate("document.querySelector('form textarea').value"), privateNote);
  pass("new authorized counsellor approves, sees dated factual assessment without OpenAI, saves private notes/shared progress");

  await api(summaryPath, "GET", undefined, undefined, 401);
  await api(summaryPath, "GET", undefined, a, 403);
  await api(summaryPath, "GET", undefined, b, 403);
  await api(summaryPath, "GET", undefined, admin, 403);
  await api(summaryPath, "GET", undefined, unrelated, 404);
  const appointmentPath = "/counselling/appointments/" + appointment._id;
  await api(appointmentPath + "/notes", "PATCH", { counsellorNotes: "Not allowed", progressUpdate: "Not allowed" }, unrelated, 404);
  await api(appointmentPath + "/sharing", "PATCH", { shareSummary: false }, b, 404);
  await api(appointmentPath + "/sharing", "PATCH", { shareSummary: false }, a);
  let denied = (await api(summaryPath, "GET", undefined, counsellor)).summary;
  assert.equal(denied.consentGranted, false);
  assert.equal(denied.initialAssessment, undefined);
  await api(appointmentPath + "/sharing", "PATCH", { shareSummary: true }, a);
  await api("/profile/me", "PUT", { ...profileInput, consentForCounsellorSummary: false }, a);
  denied = (await api(summaryPath, "GET", undefined, counsellor)).summary;
  assert.equal(denied.consentGranted, false);
  assert.equal(denied.initialAssessment, undefined);
  await api("/profile/me", "PUT", profileInput, a);
  await logout();
  a = await login(a);
  await navigate("/counselling");
  await sees(sharedProgress);
  await sees("Approved");
  assert.equal(await evaluate("document.body.innerText.includes(" + JSON.stringify(privateNote) + ")"), false);
  a = await relogin(a, "/counselling", sharedProgress);
  const studentAppointments = await api("/counselling/appointments", "GET", undefined, a);
  assert.doesNotMatch(JSON.stringify(studentAppointments), new RegExp(privateNote));
  assert.doesNotMatch(JSON.stringify(await api("/dashboard/me", "GET", undefined, a)), new RegExp(privateNote));
  assert.equal((await api("/counselling/appointments", "GET", undefined, b)).appointments.length, 0);
  pass("both consent gates, roles and counsellor ownership enforced; student sees persistent progress but never private notes");

  await api("/auth/register", "POST", { ...studentA, password }, undefined, 409);
  await api("/auth/register", "POST", { name: "", email: "invalid", password: "x" }, undefined, 400);
  await api("/auth/login", "POST", { email: studentA.email, password: "incorrect-password" }, undefined, 401);
  await api("/profile/me/initial-assessment", "PUT", { schemaVersion: contract.version, responses: {} }, a, 400);
  await api("/tracking/moods", "POST", { mood: "unknown", stressLevel: 99 }, a, 400);
  await api("/tracking/journals", "POST", { content: "" }, a, 400);
  await api("/chat/messages", "POST", { message: "" }, a, 400);
  await api("/tracking/moods", "GET", undefined, undefined, 401);
  await api("/tracking/moods", "GET", undefined, counsellor, 403);
  for (const time of ["not-a-date", new Date(Date.now() - 86400000).toISOString(), new Date(slot.getTime() + 17 * 60000).toISOString()]) {
    await api("/counselling/appointments", "POST", { counsellorId: counsellor.user.id, scheduledFor: time, concernType: "sleep" }, a, 400);
  }
  await api("/counselling/appointments", "POST", { counsellorId: counsellor.user.id, scheduledFor: slot.toISOString(), concernType: "sleep" }, a, 409);
  assert.equal(await Appointment.countDocuments(), 1);
  pass("invalid/empty/duplicate registration, assessment, tracking, assistant and appointment inputs rejected without extra records");

  await logout();
  b = await login(b);
  await navigate("/wellness-assessment");
  await sees(noteB);
  await navigate("/tracking?tab=journal");
  await sees(journalB);
  assert.equal(await evaluate("document.body.innerText.includes(" + JSON.stringify(journalA) + ")"), false);
  await navigate("/assistant");
  await sees(replyB.assistantMessage.content);
  assert.equal(await evaluate("document.body.innerText.includes(" + JSON.stringify(reply1.content) + ")"), false);
  b = await relogin(b, "/tracking?tab=mood", "B_MOOD_" + run);
  pass("second fresh student logs in through browser and retrieves only their own assessment, mood, journal and conversation");

  // Reconnect the DB client and authenticate afresh: assertions cannot rely on browser state.
  await logout();
  await mongoose.disconnect();
  await mongoose.connect(testUri);
  a = await login(a);
  assert.deepEqual((await api("/profile/me/initial-assessment", "GET", undefined, a)).assessment.responses, answersA);
  assert.equal((await api("/tracking/moods", "GET", undefined, a)).moodLogs.length, 2);
  assert.equal((await api("/tracking/journals", "GET", undefined, a)).journalEntries[0].content, journalA);
  assert.equal((await api("/counselling/appointments", "GET", undefined, a)).appointments[0].progressUpdate, sharedProgress);
  await navigate("/counselling");
  await sees(sharedProgress);
  pass("fresh authentication after database client reconnect retrieves all newly entered records");

  // UI-only recovery checks: failed writes must retain entered text and create no records.
  failNextRequest = { method: "GET", path: "/api/profile/me" };
  await navigate("/profile");
  await sees("load your profile");
  assert.equal(await evaluate("!!document.querySelector('form')"), false);
  await click("Try again");
  await until("!!document.querySelector('#consentForAssistantJournalContext')");
  const savedBeforeFailedPrivacyUpdate = (await api("/profile/me", "GET", undefined, a)).profile;
  const originalJournalConsent = savedBeforeFailedPrivacyUpdate.consentForAssistantJournalContext;
  assert.equal(await evaluate("document.querySelector('#consentForAssistantJournalContext').checked"), originalJournalConsent);
  await evaluate("document.getElementById('consentForAssistantJournalContext').click()");
  failNextRequest = { method: "PUT", path: "/api/profile/me" };
  await click("Save privacy settings");
  await sees("Your changes are still here.");
  assert.equal(await evaluate("document.querySelector('#consentForAssistantJournalContext').checked"), !originalJournalConsent);
  const savedAfterFailedPrivacyUpdate = (await api("/profile/me", "GET", undefined, a)).profile;
  assert.equal(savedAfterFailedPrivacyUpdate.consentForAssistantJournalContext, originalJournalConsent);
  assert.deepEqual(savedAfterFailedPrivacyUpdate.wellnessGoals, profileInput.wellnessGoals);
  await navigate("/tracking?tab=journal");
  await setInput("form textarea", "Keep this unsaved thought");
  failNextRequest = { method: "POST", path: "/api/tracking/journals" };
  await click("Save journal");
  await sees("Your answers are still here.");
  assert.equal(await evaluate("document.querySelector('form textarea').value"), "Keep this unsaved thought");
  assert.equal(await JournalEntry.countDocuments({ student: a.user.id }), 1);
  pass("profile load retry, failed privacy save and failed journal save preserve data and show accessible errors");

  await setInput("form textarea", "   "); await click("Save journal");
  await sees("Please write a reflection before saving your journal.");
  assert.equal(await JournalEntry.countDocuments({ student: a.user.id }), 1);

  await navigate("/feedback"); await sees("Research feedback");
  await setInput("form label:nth-of-type(2) select", "4");
  await setInput("form label:nth-of-type(3) select", "5");
  await setInput("form textarea", "Disposable usability feedback");
  failNextRequest = { method: "POST", path: "/api/feedback" };
  await click("Submit feedback"); await sees("Test-only unavailable request");
  assert.equal(await evaluate("document.querySelector('form textarea').value"), "Disposable usability feedback");
  await click("Submit feedback"); await sees("Your feedback has been recorded.");
  const feedback = (await api("/feedback/me", "GET", undefined, a)).feedback;
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].rating, 4); assert.equal(feedback[0].helpfulness, 5);
  assert.equal((await api("/feedback/me", "GET", undefined, b)).feedback.length, 0);
  pass("feedback preserves failed drafts, retries once and isolates saved ratings by account");

  await navigate("/intelligence"); await sees("Wellness Intelligence Engine");
  await setInput("form textarea", "I cannot sleep well because of exam stress.");
  await click("Build intelligence context");
  await until("!!document.querySelector('pre')?.textContent");
  const context = (await api("/intelligence/context/me", "GET", undefined, a)).context;
  assert.equal(context.userMessage, "I cannot sleep well because of exam stress.");
  assert.equal(await evaluate("document.querySelector('pre').textContent"), context.structuredPrompt);
  assert.ok(context.selectedItems.length > 0);
  assert.ok(context.estimatedTokens <= 1400);
  assert.doesNotMatch(JSON.stringify(context), /B_PRIVATE_|B_BASELINE_/);
  await navigate("/intelligence");
  await until("!!document.querySelector('pre')?.textContent");
  assert.equal(await evaluate("document.querySelector('pre').textContent"), context.structuredPrompt);
  pass("intelligence page builds and reloads the student's context within its token budget");

  const screenshots = path.join(root, ".test-cache/ui-review");
  fs.mkdirSync(screenshots, { recursive: true });
  async function screenshot(name) {
    const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(screenshots, name + ".png"), Buffer.from(data, "base64"));
  }
  const pages = [["/", "A little reflection"], ["/assistant", "Your Wellness Assistant"], ["/tracking?tab=mood", "Mood Check-in"], ["/tracking?tab=journal", "New journal entry"], ["/wellness-overview", "Average mood"], ["/counselling", "My appointments"], ["/profile", "Save privacy settings"], ["/prediction", "Your stress check-in"], ["/wellness-assessment", "Your wellness assessment"], ["/feedback", "Research feedback"], ["/intelligence", "Wellness Intelligence Engine"]];
  for (const width of [1440, 768, 390, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
    for (const [route, ready] of pages) {
      await navigate(route); await sees(ready);
      await new Promise(resolve => setTimeout(resolve, 250));
      const sizes = await evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth})");
      assert.ok(sizes.scroll <= sizes.width, route + " overflows at " + width + ": " + JSON.stringify(sizes));
      assert.equal(await evaluate("document.querySelectorAll('h1').length"), 1, route + " needs one page heading");
      if ([1440, 390].includes(width)) await screenshot(width + "-" + (route.slice(1).replace(/[^a-z]/gi, "-") || "home"));
    }
  }
  pass("eleven student pages fit desktop, tablet and 390/320px mobile viewports with one main heading each");
  await navigate("/"); await sees("A little reflection");
  await cdp("Page.bringToFront");
  await evaluate("document.querySelector('header summary').focus()");
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until("document.querySelector('header details').open");
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate("document.querySelector('header details').open"), false);
  assert.equal(await evaluate("document.activeElement.tagName"), "SUMMARY");
  assert.notEqual(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "none");
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), true);
  await navigate("/wellness-assessment"); await sees("Your wellness assessment");
  await click("Update Assessment"); await sees("Question 1 of 15");
  assert.equal(await evaluate("document.activeElement.id"), "assessment-question");
  await screenshot("320-guided-assessment");
  pass("keyboard menu, visible focus, guided question focus and reduced-motion preference verified");
  await logout();
  for (const width of [1440, 390, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
    for (const [route, ready] of [["/", "Make room for you."], ["/login", "Welcome back"], ["/register", "Create your student account"]]) {
      await navigate(route); await sees(ready);
      assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), route + " overflow at " + width);
      if (width !== 320) await screenshot(width + "-public-" + (route.slice(1) || "landing"));
    }
  }
  for (const corrupt of ["{broken", "null", "[]"]) {
    await evaluate("localStorage.setItem('wellness_auth', " + JSON.stringify(corrupt) + ")");
    await navigate("/"); await sees("Make room for you.");
    assert.equal(await evaluate("localStorage.getItem('wellness_auth')"), null);
  }
  pass("corrupted saved sessions recover to the public page without a blank screen");
  assert.deepEqual(browserErrors, [], "No uncaught browser exceptions or console errors");
  pass("landing/login/register responsive; no browser exceptions or console errors across the run");

  console.log("RESULT: " + checks + " fresh-user workflow groups passed; zero existing/demo wellness records used.");
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  ws?.close();
  chrome?.kill();
  io?.disconnectSockets(true);
  if (io) await new Promise(resolve => io.close(resolve));
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await mongoose.disconnect();
  await database?.stop();
  console.log("CLEANUP: disposable database stopped; application database was never connected.");
}
