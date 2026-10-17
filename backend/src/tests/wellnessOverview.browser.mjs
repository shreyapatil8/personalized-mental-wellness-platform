// Focused Wellness Overview verification: run after pnpm build.
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
process.env.JWT_SECRET = "overview-isolated-verification-secret-at-least-32-characters";
process.env.MONGOMS_DOWNLOAD_DIR = path.join(root, ".test-cache/mongodb");
delete process.env.OPENAI_API_KEY;
const { default: app } = await import("../app.js");
const { default: User } = await import("../models/User.js");
const { default: StressSurvey } = await import("../models/StressSurvey.js");
const { default: WellnessPrediction } = await import("../models/WellnessPrediction.js");
const { initialWellnessContract: contract } = await import("../utils/initialWellnessAssessment.js");
const { DEPARTMENTS, STUDENT_YEARS } = await import("../constants/studentOptions.js");
let database, server, chrome, ws, failNextRequest;
const pending = new Map(), browserErrors = [];
let sequence = 0, checks = 0;
const password = "Overview-disposable-only-password-2026";
function pass(name) { console.log("PASS " + (++checks) + ": " + name); }
try {
  database = await MongoMemoryServer.create({ instance: { dbName: "wellness_overview_verification" } });
  const uri = database.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri);
  await User.init();
  await WellnessPrediction.init();
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
    const account = { name, email: name.replaceAll(" ", "-").toLowerCase() + "@overview.test" };
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
  async function disclosure(label) {
    await evaluate("[...document.querySelectorAll('summary')].find(e => e.textContent === " + JSON.stringify(label) + ").click()");
  }
  async function overviewReady() {
    await navigate("/wellness-overview");
    await sees("Your reflections over time");
    await until("!document.body.innerText.includes('Checking your current estimate...')");
  }
  const a = await register("Overview Student A"), b = await register("Overview Student B");
  await api("/dashboard/me", "GET", undefined, undefined, 401);
  await login(a);
  await overviewReady();
  await sees("No mood check-ins yet.");
  await sees("Complete Your Wellness Assessment");
  await sees("There's nothing in your journal yet.");
  await sees("No current estimate is available.");
  await disclosure("Your short well-being check-in (WHO-5)");
  await sees("You haven't taken this optional short check-in yet.");
  assert.equal(await evaluate("document.querySelectorAll('.recharts-wrapper').length"), 0);
  pass("authenticated empty overview; all missing-data states, no invented score/chart; unauthenticated API denied");

  const answers = {
    ...Object.fromEntries(contract.questions.filter(q => !q.optional).map(q => [q.id, q.options[2]])),
    overallWellbeing: "Good", primaryConcern: "Academic/study pressure", preferredSupport: "Someone to talk to",
    additionalNotes: "PRIVATE_BASELINE_NOT_FOR_OVERVIEW"
  };
  await api("/profile/me", "PUT", { rollNumber: "1234", urn: "12345678", department: DEPARTMENTS[0], year: STUDENT_YEARS[0], wellnessGoals: ["Make room for a quiet evening"] }, a);
  await api("/profile/me/initial-assessment", "PUT", { schemaVersion: contract.version, responses: answers }, a);
  await api("/tracking/moods", "POST", { mood: "low", stressLevel: 4, loggedFor: new Date(Date.now() - 3 * 86400000).toISOString() }, a, 201);
  await api("/tracking/moods", "POST", { mood: "good", stressLevel: 2, loggedFor: new Date(Date.now() - 86400000).toISOString() }, a, 201);
  await api("/tracking/journals", "POST", { title: "Private reflection", content: "PRIVATE_JOURNAL_NOT_FOR_OVERVIEW" }, a, 201);
  await api("/tracking/assessments", "POST", { responses: [3, 4, 3, 2, 4] }, a, 201);
  const dashboard = (await api("/dashboard/me", "GET", undefined, a)).dashboard;
  await overviewReady();
  await sees("Make room for a quiet evening");
  await sees("Academic/study pressure");
  await sees("Someone to talk to");
  await sees("Last updated");
  await sees("Average mood: 3 / 5");
  await sees("most recent mood check-in was good");
  await sees("Mood history");
  await disclosure("View chart data");
  assert.deepEqual(await evaluate("[...document.querySelector('table tbody').rows].map(r => [...r.cells].map(c => c.textContent))"), dashboard.trend.moodDaily.map(d => [d.date, String(d.value), String(d.movingAverage)]));
  assert.equal(await evaluate("document.querySelectorAll('.recharts-wrapper').length"), 1);
  assert.deepEqual(await evaluate("[...document.querySelector('[aria-labelledby=progress-heading]').querySelectorAll('dd > span')].map(e => e.textContent)"), ["2", "1", "Completed"]);
  await disclosure("More of your assessment responses");
  await disclosure("Your short well-being check-in (WHO-5)");
  await sees("WHO-5 check-in: 64 / 100");
  const text = await evaluate("document.body.innerText");
  assert.ok(!text.includes("PRIVATE_BASELINE") && !text.includes("PRIVATE_JOURNAL"));
  assert.ok(!text.includes("Wellness score"));
  pass("API-entered profile, dated assessment, two mood days, private journal count and WHO-5 rendered accurately; free-text notes hidden");

  await disclosure("Complete or update your stress check-in");
  await until("document.querySelectorAll('.wellness-overview select').length === 22");
  for (let i = 1; i <= 22; i++) await setInput('.wellness-overview form label:nth-of-type(' + i + ') select', 2);
  await click("Save and update summary");
  await sees("Based on your saved stress check-in.");
  const prediction = (await api("/predictions/me", "GET", undefined, a)).prediction;
  assert.equal(prediction.student, a.user.id);
  assert.equal(prediction.modelSource, "trained_model");
  assert.equal(await WellnessPrediction.countDocuments({ student: a.user.id }), 1);
  const expectedCopy = prediction.riskCategory === "distress" ? "stress may feel difficult to manage" : "stress may feel motivating or manageable";
  await sees(expectedCopy);
  const estimateText = await evaluate("document.querySelector('[aria-labelledby=estimate-heading]').innerText");
  assert.ok(estimateText.includes("not a diagnosis"));
  assert.doesNotMatch(estimateText, /Eustress|Distress|probability|model version|feature vector|preprocessing|survey_01/);
  await logout(); await login(a); await overviewReady(); await sees(expectedCopy);
  pass("actual 22-question UI input produces a real saved model estimate; plain-language non-diagnostic display persists after re-login");

  failNextRequest = { method: "GET", path: "/api/dashboard/me" };
  await click("Refresh");
  await sees("We couldn't load your overview.");
  assert.ok(!(await evaluate("document.body.innerText")).includes(expectedCopy));
  await click("Try again"); await sees(expectedCopy);
  failNextRequest = { method: "GET", path: "/api/dashboard/me" };
  await navigate("/wellness-overview"); await sees("We couldn't load your overview.");
  assert.ok(!(await evaluate("document.body.innerText")).includes("No mood check-ins yet."));
  await click("Try again"); await sees(expectedCopy);
  pass("refresh and initial-load failures are actionable, not confused with empty data; cached estimate hidden until revalidated");

  // Only this disposable survey is aged; the original application database is never connected.
  await StressSurvey.collection.updateOne({ _id: new mongoose.Types.ObjectId(prediction.survey) }, { $set: { createdAt: new Date(Date.now() - 31 * 86400000) } });
  await overviewReady(); await sees("No current estimate is available.");
  assert.equal((await api("/predictions/me", "GET", undefined, a)).prediction, null);
  assert.equal(await WellnessPrediction.countDocuments({ student: a.user.id }), 1);
  await disclosure("Complete or update your stress check-in");
  await until("document.querySelectorAll('.wellness-overview select').length === 22");
  failNextRequest = { method: "POST", path: "/api/predictions/me" };
  await setInput('.wellness-overview form label:nth-of-type(1) select', 3);
  await click("Save and update summary");
  await sees("Your estimate couldn't be updated.");
  await sees("No current estimate is available.");
  assert.equal((await api("/predictions/me", "GET", undefined, a)).prediction, null);
  assert.equal(await WellnessPrediction.countDocuments({ student: a.user.id }), 1);
  pass("expired and changed-input estimates excluded; failed generation never shows a fake/old result and preserves history");

  await api("/profile/me", "PUT", { rollNumber: "5678", urn: "87654321", department: DEPARTMENTS[1], year: STUDENT_YEARS[1], wellnessGoals: ["B_ONLY_PERSONAL_GOAL"] }, b);
  await api("/tracking/assessments", "POST", { responses: [1, 1, 1, 1, 1] }, b, 201);
  const bDashboard = (await api("/dashboard/me?student=" + a.user.id, "GET", undefined, b)).dashboard;
  assert.equal(bDashboard.profile.user, b.user.id);
  assert.equal(bDashboard.overview.moodSummary.entries, 0);
  assert.equal(bDashboard.overview.journalEntryCount, 0);
  assert.equal(bDashboard.overview.latestPrediction, null);
  assert.equal(bDashboard.profile.initialWellnessAssessment ?? null, null);
  await logout(); await login(b); await overviewReady();
  await sees("B_ONLY_PERSONAL_GOAL"); await sees("No mood check-ins yet.");
  assert.ok(!(await evaluate("document.body.innerText")).includes("Make room for a quiet evening"));
  await disclosure("Stress & well-being history");
  await sees("WHO-5 assessment history");
  await disclosure("Your short well-being check-in (WHO-5)"); await sees("WHO-5 check-in: 20 / 100");
  await logout(); await login(a); await overviewReady();
  assert.ok(!(await evaluate("document.body.innerText")).includes("B_ONLY_PERSONAL_GOAL"));
  pass("student isolation with two authenticated accounts; WHO-5-only history remains accessible without mood/initial assessment");

  const links = [
    ["Talk to your Wellness Assistant", "/assistant"], ["Add Mood Check-in", "/tracking?tab=mood"],
    ["Write in Journal", "/tracking?tab=journal"], ["View / Update Assessment", "/wellness-assessment"],
    ["Talk with a counsellor / Book Counselling", "/counselling"]
  ];
  for (const [label, route] of links) {
    await click(label);
    await until("location.pathname + location.search === " + JSON.stringify(route));
    await overviewReady();
  }
  pass("existing Assistant, Mood, Journal, Assessment and Counselling navigation preserved");

  await disclosure("More of your assessment responses");
  await disclosure("View chart data");
  await disclosure("Stress & well-being history");
  await sees("WHO-5 assessment history");
  await disclosure("Your short well-being check-in (WHO-5)");
  await disclosure("Complete or update your stress check-in");
  await until("document.querySelectorAll('.wellness-overview select').length === 22");
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  for (const width of [1440, 768, 390, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.ok(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Viewport overflow at " + width);
    assert.ok(await evaluate("document.querySelectorAll('.recharts-wrapper').length === 3"));
    assert.ok(await evaluate("[...document.querySelectorAll('.recharts-wrapper')].every(e => e.getBoundingClientRect().width > 0)"));
    assert.ok(await evaluate("[...document.querySelectorAll('.recharts-xAxis')].every(axis => { const labels = [...axis.querySelectorAll('.recharts-cartesian-axis-tick-value')].map(e => e.textContent); return new Set(labels).size === labels.length; })"), "Repeated chart date labels at " + width);
  }
  await overviewReady();
  await cdp("Page.bringToFront");
  await sees("Mood history");
  await evaluate("document.querySelector('.wellness-overview summary').focus()");
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until("document.activeElement.closest('details')?.open");
  assert.notEqual(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "none");
  const screenshots = path.join(root, ".test-cache/ui-review");
  fs.mkdirSync(screenshots, { recursive: true });
  const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(screenshots, "wellness-overview-mobile.png"), Buffer.from(shot.data, "base64"));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await new Promise(resolve => setTimeout(resolve, 350));
  const desktop = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(screenshots, "wellness-overview-desktop.png"), Buffer.from(desktop.data, "base64"));
  assert.deepEqual(browserErrors, []);
  pass("expanded/collapsed layouts at 1440/768/390/320px; keyboard disclosure/focus, reduced motion, zero browser exceptions/console errors");
  console.log("RESULT: " + checks + " focused checks passed using new API/UI inputs and real inference in a disposable database.");
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  ws?.close(); chrome?.kill();
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await mongoose.disconnect(); await database?.stop();
  console.log("CLEANUP: isolated test database stopped; existing application data was not accessed or changed.");
}
