// Focused assistant UI/API verification: run after pnpm build.
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
process.env.JWT_SECRET = "assistant-isolated-verification-secret-at-least-32-characters";
process.env.MONGOMS_DOWNLOAD_DIR = path.join(root, ".test-cache/mongodb");
const { default: app } = await import("../app.js");
const { default: User } = await import("../models/User.js");
const { configureSocketServer } = await import("../socket.js");
const { default: ConversationMessage } = await import("../models/ConversationMessage.js");
const { default: StudentProfile } = await import("../models/StudentProfile.js");
const { default: WellnessContextSnapshot } = await import("../models/WellnessContextSnapshot.js");

const { initialWellnessContract: contract } = await import("../utils/initialWellnessAssessment.js");
const { DEPARTMENTS, STUDENT_YEARS } = await import("../constants/studentOptions.js");
const browserFetch = globalThis.fetch;
const localMetadata = { details: { format: "gguf" }, model_info: { "general.architecture": "qwen3" }, capabilities: ["completion"] };
globalThis.fetch = async (input, init) => {
  if (String(input).startsWith("http://127.0.0.1:11434/")) {
    if (String(input).endsWith("/api/show")) return { ok: true, json: async () => localMetadata };
    const body = JSON.parse(init.body);
    const question = body.messages.at(-1)?.content || "";
    const context = body.messages[1]?.content || "";
    const content = question.includes("lonely today")
      ? "Who would feel easiest to reach out to today?"
      : question.includes("study technique for mathematics")
      ? "Try recalling a small topic and summarizing it from memory. This is a general study technique."
        : context.includes("Sleep quality: Good")
          ? "Your assessment recorded good sleep and 7–8 hours. What has felt hardest about rest this week?"
      : question.includes("having trouble sleeping")
      ? "Your assessment recorded poor sleep and 5–6 hours. What has felt hardest about rest this week?"
      : "About sleep you mentioned earlier: try one small wind-down tonight and notice whether it helps. Your assessment recorded poor sleep and 5–6 hours. What feels manageable?";
    return { ok: true, json: async () => ({ done: true, done_reason: "stop", message: { role: "assistant", content } }) };
  }
  return browserFetch(input, init);
};
let database, server, chrome, ws, io, failNextRequest, rejectSockets = false;
const pending = new Map(), browserErrors = [];
let sequence = 0, checks = 0;
const password = "Overview-disposable-only-password-2026";
function pass(name) { console.log("PASS " + (++checks) + ": " + name); }
try {
  database = await MongoMemoryServer.create({ instance: { dbName: "assistant_ui_verification" } });
  const uri = database.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri);
  await User.init();

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
  process.env.CLIENT_ORIGIN = origin;
  io = configureSocketServer(server);
  io.use((_socket, next) => next(rejectSockets ? new Error("Isolated connection failure") : undefined));
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
    const account = { name, email: name.replaceAll(" ", "-").toLowerCase() + "@assistant-ui.test" };
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
    await until("[...document.querySelectorAll('button,a')].some(e => e.textContent.trim() === " + JSON.stringify(text) + " || e.getAttribute('aria-label') === " + JSON.stringify(text) + ")");
    await evaluate("[...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === " + JSON.stringify(text) + " || e.getAttribute('aria-label') === " + JSON.stringify(text) + ").click()");
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
  const a = await register("Assistant Student A"), b = await register("Assistant Student B");
  const answers = Object.fromEntries(contract.questions.filter(q => !q.optional).map(q => [q.id, q.options[2]]));
  for (const [account, sleepQuality, sleepHours] of [[a, "Poor", "5–6"], [b, "Good", "7–8"]]) {
    await api("/profile/me/initial-assessment", "PUT", { schemaVersion: contract.version, responses: { ...answers, sleepQuality, sleepHours, preferredSupport: "Help managing stress" } }, account);
  }
  await api("/tracking/moods", "POST", { mood: "low", stressLevel: 4, sleepHours: 5, loggedFor: new Date(Date.now() - 86400000).toISOString() }, a, 201);
  await api("/tracking/journals", "POST", { title: "Private evening", content: "PRIVATE_A_JOURNAL: sleep is interrupted by late noise." }, a, 201);
  await api("/tracking/journals", "POST", { title: "Private other evening", content: "PRIVATE_B_JOURNAL: sleep has been restful." }, b, 201);
  await StudentProfile.updateOne({ user: a.user.id }, { $set: { consentForAssistantJournalContext: true } });
  await login(a); await navigate("/assistant"); await sees("Your Wellness Assistant");
  await sees("A little room to talk");
  assert.equal(await evaluate("document.querySelector('button[type=submit]').disabled"), true);
  const transcriptScrollArea = await evaluate(`(() => {
    const area = document.querySelector('.assistant-transcript');
    for (let i = 0; i < 24; i++) {
      const probe = document.createElement('div'); probe.dataset.scrollProbe = 'transcript';
      probe.style.minHeight = '72px'; probe.textContent = 'Scroll input verification'; area.append(probe);
    }
    const rect = area.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, top: rect.top, bottom: rect.bottom, height: rect.height, clientHeight: area.clientHeight, scrollHeight: area.scrollHeight };
  })()`);
  assert.ok(transcriptScrollArea.scrollHeight > transcriptScrollArea.clientHeight, "long transcript is vertically scrollable");
  await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: transcriptScrollArea.x, y: transcriptScrollArea.y, deltaY: 480, deltaX: 0 });
  await until("document.querySelector('.assistant-transcript').scrollTop > 0");
  const composerVisibleAfterWheel = await evaluate("(() => { const r = document.querySelector('.assistant-composer').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()");
  assert.ok(composerVisibleAfterWheel, "composer remains visible while transcript scrolls");
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await evaluate("document.querySelector('.assistant-transcript').scrollTop = 0");
  await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: transcriptScrollArea.x, y: transcriptScrollArea.bottom - 30 }] });
  await cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: transcriptScrollArea.x, y: transcriptScrollArea.top + 30 }] });
  await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await until("document.querySelector('.assistant-transcript').scrollTop > 0");
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  await evaluate("document.querySelectorAll('[data-scroll-probe=transcript]').forEach(node => node.remove()); document.querySelector('.assistant-transcript').scrollTop = 0");
  const sidebarScrollArea = await evaluate(`(() => {
    const area = document.querySelector('.assistant-sidebar [class~="overflow-y-auto"]');
    for (let i = 0; i < 18; i++) {
      const probe = document.createElement('div'); probe.dataset.scrollProbe = 'sidebar';
      probe.style.minHeight = '48px'; probe.textContent = 'Conversation scroll verification'; area.append(probe);
    }
    const rect = area.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, clientHeight: area.clientHeight, scrollHeight: area.scrollHeight };
  })()`);
  assert.ok(sidebarScrollArea.scrollHeight > sidebarScrollArea.clientHeight, "long conversation list is vertically scrollable");
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: sidebarScrollArea.x, y: sidebarScrollArea.y });
  await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: sidebarScrollArea.x, y: sidebarScrollArea.y, deltaY: 420, deltaX: 0 });
  await new Promise(resolve => setTimeout(resolve, 150));
  const sidebarScrollTop = await evaluate("document.querySelector('.assistant-sidebar [class~=overflow-y-auto]').scrollTop");
  assert.ok(sidebarScrollTop > 0, "sidebar wheel input scrolls its history list; layout=" + JSON.stringify(sidebarScrollArea) + ", scrollTop=" + sidebarScrollTop);
  await evaluate("document.querySelectorAll('[data-scroll-probe=sidebar]').forEach(node => node.remove()); document.querySelector('.assistant-sidebar [class~=overflow-y-auto]').scrollTop = 0");
  pass("native mouse-wheel and touch gestures scroll the transcript and sidebar while the composer stays accessible");
  async function chat(message, account = a) {
    const before = await ConversationMessage.countDocuments({ student: account.user.id, role: "assistant" });
    await setInput("#assistant-message", message); await click("Send message");
    await until("!document.querySelector('#assistant-message').disabled");
    let reply;
    for (let i = 0; i < 100; i++) {
      if (await ConversationMessage.countDocuments({ student: account.user.id, role: "assistant" }) > before) {
        reply = await ConversationMessage.findOne({ student: account.user.id, role: "assistant" }).sort({ createdAt: -1, _id: -1 });
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(reply, "An assistant reply was persisted");
    assert.equal(await ConversationMessage.countDocuments({ student: account.user.id, role: "assistant" }), before + 1);
    await sees(reply.content);
    return reply;
  }
  const savedReplies = [];
  for (const message of ["I am having trouble sleeping.", "It has been happening for the last few days.", "What should I do about this?"]) {
    const reply = await chat(message);
    assert.equal(reply.responseSource, "ollama");
    assert.match(reply.content, /poor sleep and 5–6 hours/);
    if (savedReplies.length) assert.match(reply.content, /About sleep you mentioned earlier/);
    savedReplies.push(reply);
  }
  const selected = (await api("/intelligence/context/me", "GET", undefined, a)).context;
  assert.ok(selected.selectedItems.some(item => item.sourceType === "journal"));
  assert.ok(selected.selectedItems.some(item => item.sourceType === "mood"));
  const visible = await evaluate("document.body.innerText");
  assert.doesNotMatch(visible, /PRIVATE_A_JOURNAL|PRIVATE_B_JOURNAL|Prioritized context|selectionReason|sourceId/);
  pass("three-turn sleep continuity over the authenticated chat API using mocked Ollama transport, assessment/mood/journal selection, no journal quotation/internal metadata");

  await navigate("/assistant"); await sees(savedReplies[0].content); await sees(savedReplies[2].content);
  await logout(); await login(a); await navigate("/assistant"); await sees(savedReplies[2].content);
  const saved = await api("/chat/messages", "GET", undefined, a);
  assert.equal(saved.messages.length, 6);
  for (let i = 0; i < 6; i += 2) {
    assert.equal(saved.messages[i].role, "student");
    assert.equal(saved.messages[i + 1].replyTo, saved.messages[i]._id);
  }
  pass("chronological paired conversation persists across refresh and logout/login");

  const general = await chat("Can you suggest a study technique for mathematics?");
  assert.match(general.content, /recalling a small topic/);
  assert.doesNotMatch(general.content, /assessment|journal|5–6|saved estimate/);
  assert.equal((await api("/intelligence/context/me", "GET", undefined, a)).context.selectedItems.length, 0);
  const beforeSafety = await WellnessContextSnapshot.countDocuments({ student: a.user.id });
  const safety = await chat("I feel suicidal");
  assert.equal(safety.responseSource, "safety_message"); assert.match(safety.content, /emergency services/);
  assert.equal(await WellnessContextSnapshot.countDocuments({ student: a.user.id }), beforeSafety);
  pass("unrelated study question excludes private context; urgent safety bypasses context generation");

  // Force REST transport and a failure before persistence, without touching application data.
  rejectSockets = true; io.disconnectSockets(true);
  await new Promise(resolve => setTimeout(resolve, 150));
  const beforeFailure = await ConversationMessage.countDocuments({ student: a.user.id });
  failNextRequest = { method: "POST", path: "/api/chat/messages" };
  const retryMessage = "I feel lonely today";
  await setInput("#assistant-message", retryMessage); await click("Send message");
  await sees("Isolated test transport failure");
  await sees(retryMessage);
  assert.equal(await ConversationMessage.countDocuments({ student: a.user.id }), beforeFailure);
  await click("Retry");
  await until("!document.querySelector('#assistant-message').disabled");
  await until("!document.querySelector('[role=alert]')");
  assert.equal(await ConversationMessage.countDocuments({ student: a.user.id }), beforeFailure + 2);
  await sees("Who would feel easiest to reach out to today?");
  pass("REST failure retains draft, understandable retry creates one persisted exchange");

  failNextRequest = { method: "GET", path: "/api/chat/conversations" };
  await navigate("/assistant"); await sees("We couldn’t load your chat history.");
  await navigate("/assistant"); await sees(savedReplies[2].content);
  await logout(); await login(b); await navigate("/assistant");
  const bReply = await chat("I am having trouble sleeping.", b);
  assert.match(bReply.content, /good sleep and 7–8 hours/);
  assert.doesNotMatch(await evaluate("document.body.innerText"), /5–6|poor sleep|PRIVATE_A_JOURNAL|feeling lonely today/i);
  assert.ok((await api("/chat/messages?student=" + a.user.id, "GET", undefined, b)).messages.every(item => item.student === b.user.id));
  await logout(); await login(a); await navigate("/assistant"); await sees(savedReplies[2].content);
  assert.doesNotMatch(await evaluate("document.body.innerText"), /good sleep and 7–8 hours|PRIVATE_B_JOURNAL/);
  pass("history-load error recovery and account switching preserve student isolation in API and UI");

  for (const width of [1440, 768, 390, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Assistant overflow at " + width);
  }
  assert.deepEqual(browserErrors, []);
  pass("existing conversation UI remains usable at desktop/tablet/mobile widths, with no runtime exceptions or console errors");
  console.log("RESULT: " + checks + " focused assistant checks passed. Ollama transport was mocked; no live model or existing application records were used.");
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
} finally {
  ws?.close(); chrome?.kill();
  io?.disconnectSockets(true);
  if (io) await new Promise(resolve => io.close(resolve));
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await mongoose.disconnect(); await database?.stop();
  console.log("CLEANUP: isolated assistant test database stopped; existing application data was not accessed or changed.");
}
