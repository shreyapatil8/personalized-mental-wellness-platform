import assert from "node:assert/strict";
import test from "node:test";
import MoodLog from "../models/MoodLog.js";

import {
  buildWellnessContext,
  buildCandidates,
  estimateTokens,
  scoreContextItem,
  selectTopContext,
  summarizeInitialAssessment
} from "./wellnessIntelligenceEngine.js";

test("scoreContextItem rewards recent, relevant, high-priority context", () => {
  const scored = scoreContextItem(
    {
      sourceType: "journal",
      title: "Exam stress",
      content: "I feel anxious about exams and cannot sleep well.",
      timestamp: new Date("2026-09-08T00:00:00Z"),
      priority: 0.9
    },
    "I am anxious about exams",
    new Date("2026-09-08T12:00:00Z")
  );

  assert.equal(scored.recencyScore, 1);
  assert.ok(scored.relevanceScore > 0);
  assert.ok(scored.totalScore > 0.7);
});

test("selectTopContext respects item count and token budget", () => {
  const selected = selectTopContext(
    [
      { title: "A", content: "important", estimatedTokens: 100, totalScore: 0.9 },
      { title: "B", content: "second", estimatedTokens: 100, totalScore: 0.8 },
      { title: "C", content: "third", estimatedTokens: 100, totalScore: 0.7 }
    ],
    210,
    2
  );

  assert.equal(selected.length, 2);
});

test("buildWellnessContext creates a structured prompt from available records", () => {
  const context = buildWellnessContext({
    user: { name: "Test Student" },
    profile: {
      department: "Computer Science and Engineering",
      year: "Third Year",
      wellnessGoals: ["manage exams"],
      updatedAt: new Date("2026-09-08T00:00:00Z")
    },
    assessments: [
      {
        percentageScore: 44,
        rawScore: 11,
        riskLevel: "moderate",
        takenAt: new Date("2026-09-08T00:00:00Z")
      }
    ],
    moodLogs: [
      {
        mood: "low",
        moodScore: 2,
        stressLevel: 4,
        sleepHours: 5,
        note: "exam preparation pressure",
        loggedFor: new Date("2026-09-08T00:00:00Z")
      }
    ],
    journalEntries: [
      {
        title: "Study pressure",
        content: "I am worried about exams.",
        sentiment: "negative",
        tags: ["exam"],
        createdAt: new Date("2026-09-08T00:00:00Z")
      }
    ],
    latestPrediction: {
      riskCategory: "distress",
      confidence: 0.76,
      reasons: ["Recent stress levels are elevated."],
      createdAt: new Date("2026-09-08T00:00:00Z")
    },
    userMessage: "I feel stressed about exams",
    tokenBudget: 900,
    maxItems: 8,
    now: new Date("2026-09-08T12:00:00Z")
  });

  assert.ok(context.candidateCount >= 4);
  assert.ok(context.selectedItems.length > 0);
  assert.ok(context.structuredPrompt.includes("Prioritized context:"));
  assert.ok(!context.structuredPrompt.includes("Current student message:"));
  assert.ok(!context.structuredPrompt.includes("I feel stressed about exams"));
});

test("estimateTokens returns a positive rough estimate", () => {
  assert.ok(estimateTokens("hello world") > 0);
});

const now = new Date("2026-10-02T12:00:00Z");
const profile = {
  _id: "profile-one", department: "Computer Science and Engineering", year: "Third Year", wellnessGoals: ["Improve rest"], updatedAt: now,
  initialWellnessAssessment: {
    schemaVersion: "initial-wellness-v1", completedAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    responses: { overallWellbeing: "Average", primaryConcern: "Academic/study pressure", preferredSupport: "Someone to talk to",
      stressFrequency: "Often", academicPressure: "High", sleepQuality: "Poor", sleepHours: "5–6",
      peerConnection: "Connected", timeManagement: "Very difficult", additionalNotes: "Sleep is disrupted by noise in the dorm." }
  }
};

test("initial assessment produces a factual dated baseline and topic-specific details", () => {
  const context = buildWellnessContext({ profile, userMessage: "I cannot sleep", now });
  assert.doesNotMatch(context.structuredPrompt, /Primary concern: Academic\/study pressure/);
  assert.match(context.structuredPrompt, /Preferred support: Someone to talk to/);
  assert.match(context.structuredPrompt, /recorded 2026-01-01/);
  assert.match(context.structuredPrompt, /Sleep quality: Poor; Nightly sleep hours: 5–6/);
  assert.match(context.structuredPrompt, /Sleep is disrupted by noise/);
  assert.doesNotMatch(context.structuredPrompt, /Academic pressure: High|Peer connection: Connected|Time management difficulty/);
});

test("requested personal overview preserves baseline and source diversity within a crowded budget", () => {
  const context = buildWellnessContext({ profile, userMessage: "Summarize my records", now, tokenBudget: 1600, maxItems: 10,
    moodLogs: Array.from({ length: 30 }, (_, i) => ({ _id: `mood-${i}`, mood: "low", moodScore: 2, stressLevel: 5, loggedFor: now })),
    journalEntries: [{ _id: "journal", title: "Reflection", content: "I need support", sentiment: "negative", createdAt: now }],
    latestPrediction: { riskCategory: "distress", confidence: .6, createdAt: now } });
  for (const type of ["profile", "initial_assessment", "mood", "journal", "prediction"]) {
    assert.ok(context.selectedItems.some((item) => item.sourceType === type), type);
  }
  assert.match(context.structuredPrompt, /Improve rest/);
  assert.match(context.structuredPrompt, /Preferred support: Someone to talk to/);
  assert.ok(context.estimatedTokens <= 1600);
  assert.ok(context.selectedItems.length <= 10);
});

test("recent conversation informs personal relevance but is never a personal-context candidate", () => {
  const context = buildWellnessContext({ profile, userMessage: "What should I do next?", conversationTopic: "My roommate keeps waking me at night.", now });
  assert.match(context.structuredPrompt, /Sleep quality: Poor/);
  assert.doesNotMatch(context.structuredPrompt, /My roommate|What should I do next/);
  assert.ok(context.selectedItems.every((item) => item.sourceType !== "conversation"));
});

test("assessment summaries omit missing or invalid answers and bound additional notes", () => {
  assert.deepEqual(summarizeInitialAssessment({}), []);
  assert.deepEqual(summarizeInitialAssessment({ initialWellnessAssessment: { schemaVersion: "unknown", responses: {} } }), []);
  const items = summarizeInitialAssessment({ ...profile, initialWellnessAssessment: { ...profile.initialWellnessAssessment,
    responses: { overallWellbeing: "invented", preferredSupport: "Someone to talk to", additionalNotes: "sleep ".repeat(300) } } }, "summarize my assessment");
  assert.equal(items[0].content, "Preferred support: Someone to talk to");
  assert.ok(items.at(-1).content.length < 550);
  assert.match(items.at(-1).content, /excerpt truncated/);
  assert.ok(items.every((item) => !item.content.includes("undefined") && !item.content.includes("invented")));
});

test("unrelated neutral journals are excluded while relevant records are retained", () => {
  const context = buildWellnessContext({ userMessage: "sleep", now, journalEntries: [
    { _id: "unrelated", content: "Painted landscapes today", sentiment: "positive", createdAt: now },
    { _id: "relevant", content: "Sleep interrupted every night", sentiment: "unrated", createdAt: now }
  ] });
  assert.deepEqual(context.selectedItems.map((item) => item.sourceId), ["relevant"]);
});

test("insufficient budgets report an error rather than silently dropping essential context", () => {
  assert.throws(() => buildWellnessContext({ profile, userMessage: "hello", now, tokenBudget: 20 }), { statusCode: 400 });
});

test("academic and social questions select different assessment fields without leaking unrelated baseline concerns", () => {
  const complete = { ...profile, initialWellnessAssessment: { ...profile.initialWellnessAssessment,
    responses: { ...profile.initialWellnessAssessment.responses, academicSatisfaction: "Dissatisfied",
      concentration: "Often difficult", supportSatisfaction: "Satisfied" } } };
  const academic = buildWellnessContext({ profile: complete, userMessage: "I am stressed because of exams", now });
  for (const fact of ["Academic pressure: High", "Stress frequency: Often", "Academic satisfaction: Dissatisfied", "Concentration: Often difficult"]) {
    assert.ok(academic.structuredPrompt.includes(fact), fact);
  }
  assert.doesNotMatch(academic.structuredPrompt, /Peer connection|Support satisfaction|Sleep quality|Nightly sleep/);
  const social = buildWellnessContext({ profile: complete, userMessage: "I feel lonely", now });
  assert.match(social.structuredPrompt, /Peer connection: Connected; Support satisfaction: Satisfied/);
  assert.doesNotMatch(social.structuredPrompt, /Academic pressure|Academic satisfaction|Sleep quality|Primary concern: Academic/);
  assert.match(social.structuredPrompt, /recorded 2026-01-01/);
});

test("general questions select no personal records even with negative journals, predictions and preceding concerns", () => {
  for (const userMessage of ["What is the capital of France?", "What is stress?", "Tell me about sleep", "What do you know about anxiety?", "Give me general advice about sleep", "Tell me about my records without using my data"]) {
    const result = buildWellnessContext({ profile, user: { name: "PRIVATE_NAME" }, userMessage, now,
      recentConversation: [{ role: "user", content: "My exams are stressful" }, { role: "assistant", content: "Let's talk about your sleep" }],
      moodLogs: [{ moodScore: 1, stressLevel: 5, loggedFor: now }],
      journalEntries: [{ title: "Exam stress", content: "Stress at exams", sentiment: "negative", createdAt: now }],
      latestPrediction: { riskCategory: "distress", confidence: .9, createdAt: now } });
    assert.equal(result.selectedItems.length, 0, userMessage);
    assert.doesNotMatch(result.structuredPrompt, /PRIVATE_NAME|Academic pressure|Improve rest|Stress type:|Mood score/);
  }
});

test("follow-ups inherit only the student's latest concern and never the assistant's suggestions", () => {
  const history = [
    { role: "user", content: "My exams are stressful" }, { role: "assistant", content: "Perhaps sleep could help" },
    { role: "user", content: "What should I do about it?" }, { role: "assistant", content: "Discuss family relationships" }
  ];
  const followup = buildWellnessContext({ profile, userMessage: "Tell me more", recentConversation: history, now });
  assert.match(followup.structuredPrompt, /Academic pressure: High/);
  assert.doesNotMatch(followup.structuredPrompt, /Sleep quality|Peer connection|Tell me more|Perhaps sleep/);
  const changed = buildWellnessContext({ profile, userMessage: "I feel lonely", recentConversation: history, now });
  assert.match(changed.structuredPrompt, /Peer connection/);
  assert.doesNotMatch(changed.structuredPrompt, /Academic pressure|Sleep quality/);
  const unrelated = [...history, { role: "user", content: "What is the capital of France?" }, { role: "assistant", content: "Paris. Exams are difficult." }];
  assert.equal(buildWellnessContext({ profile, userMessage: "Tell me more", recentConversation: unrelated, now }).selectedItems.length, 0);
});

test("recent mood summaries compare equal seven-day periods and cap individual logs", () => {
  const logs = Array.from({ length: 5 }, (_, i) => ({
    _id: "m" + i, moodScore: i + 1, stressLevel: 5 - i, sleepHours: i + 4,
    loggedFor: new Date(now - (4 - i) * 86400000), note: i === 4 ? "Exam worry" : "Unrelated painting note"
  }));
  logs.push({ _id: "old", moodScore: 1, stressLevel: 5, loggedFor: new Date(now - 20 * 86400000) });
  logs.push({ _id: "future", moodScore: 1, stressLevel: 5, loggedFor: new Date(+now + 86400000) });
  const context = buildWellnessContext({ userMessage: "I am stressed about exams", moodLogs: logs, now });
  const pattern = context.selectedItems.find(item => item.sourceType === "mood_pattern");
  assert.ok(pattern);
  assert.deepEqual(pattern.sourceIds, ["m0", "m1", "m2", "m3", "m4"]);
  assert.match(pattern.content, /5 valid mood entries on 5 recorded UTC dates/);
  assert.match(pattern.content, /Recorded mood-score comparison: insufficient data/);
  assert.match(pattern.content, /scale: 1=very_low, 2=low, 3=neutral, 4=good, 5=great/);
  assert.match(pattern.content, /Missing dates are unknown/);
  assert.equal(context.selectedItems.filter(item => item.sourceType === "mood").length, 2);
  assert.equal(context.selectedItems.find(item => item.sourceType === "mood").sourceId, "m4");
  assert.doesNotMatch(context.structuredPrompt, /Unrelated painting note/);
  const few = buildWellnessContext({ userMessage: "My sleep is poor", moodLogs: logs.slice(0, 2), now });
  assert.match(few.selectedItems.find(item => item.sourceType === "mood_pattern").content, /insufficient data/);
  const sleep = buildWellnessContext({ userMessage: "My sleep is poor", moodLogs: logs, now });
  assert.match(sleep.structuredPrompt, /Mean recorded sleep 6 hours across 5 entries/);
});

test("deterministic mood comparison reports stable, increasing and decreasing scores only with comparable coverage", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const makeLogs = ([earlier, later]) => [
    { _id: "e1", moodScore: earlier, stressLevel: 3, loggedFor: new Date("2026-10-02T12:00:00Z") },
    { _id: "e2", moodScore: earlier, stressLevel: 3, loggedFor: new Date("2026-10-04T12:00:00Z") },
    { _id: "l1", moodScore: later, stressLevel: 3, loggedFor: new Date("2026-10-10T12:00:00Z") },
    { _id: "l2", moodScore: later, stressLevel: 3, loggedFor: new Date("2026-10-12T12:00:00Z") }
  ];
  for (const [scores, expected] of [[[3, 3], "stable"], [[2, 4], "increasing"], [[4, 2], "decreasing"]]) {
    const context = buildWellnessContext({ userMessage: "My mood lately", moodLogs: makeLogs(scores), now });
    assert.match(context.structuredPrompt, new RegExp("direction across the two equal 7-day periods: " + expected));
    assert.match(context.structuredPrompt, /Earlier 7-day period: 2 entries on 2026-10-02, 2026-10-04/);
    assert.match(context.structuredPrompt, /Later 7-day period: 2 entries on 2026-10-10, 2026-10-12/);
  }
});

test("mood comparison rejects missing, duplicate, invalid, stale and future records instead of inventing a trend", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const logs = [
    { _id: "same", moodScore: 2, stressLevel: 4, loggedFor: new Date("2026-10-02T12:00:00Z") },
    { _id: "same", moodScore: 5, stressLevel: 1, loggedFor: new Date("2026-10-03T12:00:00Z") },
    { _id: "future", moodScore: 5, stressLevel: 1, loggedFor: new Date("2026-10-16T12:00:00Z") },
    { _id: "old", moodScore: 1, stressLevel: 5, loggedFor: new Date("2026-09-01T12:00:00Z") },
    { _id: "bad", moodScore: 6, stressLevel: 2, loggedFor: new Date("2026-10-11T12:00:00Z") },
    { _id: "missing-date", moodScore: 3, stressLevel: 3 },
    { _id: "only-later", moodScore: 4, stressLevel: 2, loggedFor: new Date("2026-10-12T12:00:00Z") }
  ];
  const context = buildWellnessContext({ userMessage: "My mood", moodLogs: logs, now });
  assert.match(context.structuredPrompt, /2 valid mood entries on 2 recorded UTC dates/);
  assert.match(context.structuredPrompt, /comparison: insufficient data/);
  assert.doesNotMatch(context.structuredPrompt, /direction across.*increasing|direction across.*decreasing/);
  const empty = buildWellnessContext({ userMessage: "My mood", moodLogs: [], now });
  assert.equal(empty.selectedItems.length, 0);
  assert.match(empty.structuredPrompt, /No relevant personal wellness records/);
});

test("journal relevance uses topics without allowing unrelated negative sentiment to override relevance", () => {
  const context = buildWellnessContext({ userMessage: "I am worried about exams", now, journalEntries: [
    { _id: "social", title: "Friends", content: "An argument with a friend left me feeling lonely.", sentiment: "negative", createdAt: now },
    { _id: "academic", title: "Coursework", content: "Preparing my assignments takes too long.", sentiment: "unrated", createdAt: now },
    { _id: "blank", title: "Blank", content: "   ", sentiment: "negative", createdAt: now }
  ] });
  assert.deepEqual(context.selectedItems.map(item => item.sourceId), ["academic"]);
  assert.match(context.structuredPrompt, /Preparing my assignments takes too long/);
  assert.match(context.structuredPrompt, /not medically verified/);
});

test("long journal excerpts retain relevant original wording and negation rather than an unrelated prefix", () => {
  const sentence = "I am not sleeping badly; my late-night study schedule is improving.";
  const context = buildWellnessContext({ userMessage: "Help with my sleep", now,
    journalEntries: [{ _id: "long", content: "I painted a landscape. ".repeat(60) + sentence + " More observations.".repeat(80), createdAt: now }] });
  assert.equal(context.selectedItems.length, 1);
  assert.ok(context.selectedItems[0].content.includes(sentence));
  assert.match(context.selectedItems[0].content, /earlier text omitted/);
  assert.match(context.selectedItems[0].content, /excerpt truncated/);
  assert.ok(context.estimatedTokens <= 1400);
});

test("prediction is a dated Logistic Regression Eustress/Distress estimate distinct from Qwen and WHO-5", () => {
  const latestPrediction = { _id: "prediction", riskCategory: "distress", confidence: .71, createdAt: now, reasons: ["UNSAFE_LEGACY_DIAGNOSIS"] };
  for (const query of ["My exams are stressful", "I have trouble sleeping", "How is my wellness?"]) {
    const context = buildWellnessContext({ userMessage: query, latestPrediction, now });
    assert.equal(context.selectedItems.filter(item => item.sourceType === "prediction").length, 1);
    assert.match(context.structuredPrompt, /Stress type: distress \(not a diagnosis or clinical severity\)/);
    assert.match(context.structuredPrompt, /separate trained Logistic Regression classifier/);
    assert.match(context.structuredPrompt, /Uncalibrated model probability: 71%/);
    assert.doesNotMatch(context.structuredPrompt, /UNSAFE_LEGACY_DIAGNOSIS/);
  }
  for (const query of ["What is stress?", "I feel lonely", "Help organize my routine"]) {
    assert.equal(buildWellnessContext({ userMessage: query, latestPrediction, now }).selectedItems.length, 0);
  }
  assert.equal(buildWellnessContext({ userMessage: "I feel stressed", now }).selectedItems.length, 0);
  assert.equal(buildWellnessContext({ userMessage: "I feel stressed", now, latestPrediction: { ...latestPrediction, riskCategory: "high" } }).selectedItems.length, 0);
});

test("deduplication keeps the latest copied journal and removes repeated profile fields but retains different sources", () => {
  const context = buildWellnessContext({ profile, userMessage: "My exams are stressful", now,
    journalEntries: [
      { _id: "old-copy", title: "Original", content: "Exam pressure feels high.", createdAt: new Date(now - 86400000) },
      { _id: "new-copy", title: "Copy", content: "Exam pressure feels high.", createdAt: now }
    ],
    moodLogs: [{ _id: "mood", moodScore: 2, stressLevel: 4, note: "Exam pressure feels high.", loggedFor: now }] });
  assert.equal(context.selectedItems.filter(item => item.sourceType === "journal").length, 1);
  assert.equal(context.selectedItems.find(item => item.sourceType === "journal").sourceId, "new-copy");
  assert.ok(context.selectedItems.some(item => item.sourceType === "mood"));
  assert.ok(context.selectedItems.some(item => item.sourceType === "initial_assessment_detail"));
  assert.equal(context.structuredPrompt.split("Department:").length - 1, 1);
  assert.equal(context.structuredPrompt.split("Stress frequency:").length - 1, 1);
});

test("missing and partial sources never invent undefined facts, predictions or patterns", () => {
  for (const partial of [{}, { profile: {} }, { profile: { updatedAt: now } },
    { journalEntries: [{ content: "My exams", createdAt: "invalid" }] },
    { moodLogs: [{ loggedFor: now }] },
    { profile: { initialWellnessAssessment: { schemaVersion: "initial-wellness-v1", responses: {} } } }]) {
    const context = buildWellnessContext({ ...partial, userMessage: "I feel stressed", now, tokenBudget: 400 });
    assert.equal(context.selectedItems.length, 0);
    assert.doesNotMatch(context.structuredPrompt, /undefined|NaN|Stress type:/);
    assert.ok(context.estimatedTokens <= 400);
  }
});

test("invalid, future, and duplicate mood rows do not manufacture an aggregate pattern", () => {
  const context = buildWellnessContext({ userMessage: "My mood has felt difficult", now,
    moodLogs: [
      { _id: "bad-score", moodScore: 8, stressLevel: 4, loggedFor: now },
      { _id: "bad-time", moodScore: 2, stressLevel: 4, loggedFor: "not-a-date" },
      { _id: "future", moodScore: 2, stressLevel: 4, loggedFor: new Date(+now + 86400000) },
      { _id: "old", moodScore: 2, stressLevel: 4, loggedFor: new Date(+now - 20 * 86400000) }
    ] });
  assert.equal(context.selectedItems.some(item => item.sourceType === "mood_pattern"), false);
  assert.ok(context.estimatedTokens <= 1400);
});

test("mood aggregation retains timestamps and provenance from hydrated Mongoose records", () => {
  const rows = [1, 2, 3, 4].map(index => MoodLog.hydrate({ _id: String(index).padStart(24, "0"),
    student: "000000000000000000000099", mood: "low", moodScore: 2, stressLevel: 4,
    loggedFor: new Date(+now - index * 86400000), createdAt: now, updatedAt: now }));
  const context = buildWellnessContext({ userMessage: "My mood lately", moodLogs: rows, now });
  const pattern = context.selectedItems.find(item => item.sourceType === "mood_pattern");
  assert.ok(pattern);
  assert.equal(pattern.sourceIds.length, 4);
  assert.ok(pattern.timestamp instanceof Date);
  assert.match(pattern.content, /4 valid mood entries/);
});

test("assessment uses only the actual saved WHO-5 score and result label; absent assessment stays absent", () => {
  const withAssessment = buildWellnessContext({ userMessage: "I feel stressed about exams", now,
    assessments: [{ _id: "who5", type: "WHO5", rawScore: 12, percentageScore: 48, riskLevel: "moderate", takenAt: now }] });
  assert.match(withAssessment.structuredPrompt, /WHO-5 score 48\/100, raw score 12\/25; stored result label: moderate/);
  const missing = buildWellnessContext({ userMessage: "I feel stressed about exams", now, assessments: [] });
  assert.doesNotMatch(missing.structuredPrompt, /WHO-5 score|moderate|assessment result/);
});

test("factual instructions distinguish dated summaries, possibilities, stale or conflicting records and source claims", () => {
  const context = buildWellnessContext({ userMessage: "I feel stressed about exams", now,
    moodLogs: [{ _id: "m", moodScore: 2, stressLevel: 4, loggedFor: now }] });
  assert.match(context.structuredPrompt, /Backend-calculated dated summaries are the source of truth/);
  assert.match(context.structuredPrompt, /Missing, stale or conflicting information is unknown or uncertain/);
  assert.match(context.structuredPrompt, /Possible explanations and general suggestions are possibilities/);
});

test("selection is deterministic, explainable, and bounded after rendering dates and source labels", () => {
  const inputs = { profile, userMessage: "Help with my sleep", now, maxItems: 4, tokenBudget: 600,
    moodLogs: [{ _id: "m", moodScore: 2, stressLevel: 4, sleepHours: 5, loggedFor: now }],
    journalEntries: Array.from({ length: 8 }, (_, i) => ({ _id: "j" + i, content: "Sleep reflection " + i, createdAt: now })) };
  const context = buildWellnessContext(inputs);
  assert.deepEqual(context, buildWellnessContext(inputs));
  assert.deepEqual(context.selectedItems, buildWellnessContext({ ...inputs, journalEntries: [...inputs.journalEntries].reverse() }).selectedItems);
  assert.ok(context.selectedItems.every(item => item.selectionReason && Number.isFinite(item.totalScore)));
  assert.ok(context.selectedItems.length <= 4);
  assert.equal(context.estimatedTokens, estimateTokens(context.structuredPrompt));
  assert.ok(context.estimatedTokens <= 600);
  assert.ok(context.selectedItems.some(item => item.sourceType === "initial_assessment"));
});

test("candidate construction accepts the current-message contract used by existing engine callers", () => {
  const args = { profile, userMessage: "Help with sleep", now };
  assert.ok(buildCandidates(args).some(item => item.sourceType === "initial_assessment_detail"));
  assert.deepEqual(buildCandidates(args), buildCandidates({ profile, relevanceMessage: args.userMessage, now }));
});

test("source diversity never forces a weak estimate ahead of strongly relevant journal evidence", () => {
  const context = buildWellnessContext({ userMessage: "I struggle with sleep", now, maxItems: 2,
    journalEntries: [
      { _id: "j1", content: "Sleep was interrupted by noise.", createdAt: now },
      { _id: "j2", content: "I keep waking at night before classes.", createdAt: now }
    ],
    latestPrediction: { _id: "p", riskCategory: "distress", confidence: .9, createdAt: now }
  });
  assert.deepEqual(context.selectedItems.map(item => item.sourceId), ["j1", "j2"]);
});

test("duration follow-ups retain the nearest sleep concern across multiple turns, not older unrelated topics", () => {
  const history = [
    { role: "user", content: "My exams are stressful" }, { role: "assistant", content: "Earlier exam advice" },
    { role: "user", content: "I am having trouble sleeping." }, { role: "assistant", content: "What has that been like?" }
  ];
  for (const message of ["It has been happening for the last few days.", "What should I do about this?"]) {
    const context = buildWellnessContext({ profile, userMessage: message, recentConversation: history, now });
    assert.match(context.structuredPrompt, /Sleep quality:/);
    assert.doesNotMatch(context.structuredPrompt, /Academic pressure:/);
    assert.ok(!context.structuredPrompt.includes(message));
    history.push({ role: "user", content: message }, { role: "assistant", content: "About sleep" });
  }
  history.push({ role: "user", content: "Can you suggest a study technique for mathematics?" }, { role: "assistant", content: "Try recalling the steps" });
  for (const message of ["It has been happening for the last few days.", "What should I do about this?"]) {
    const context = buildWellnessContext({ profile, userMessage: message, recentConversation: history, now });
    assert.equal(context.selectedItems.length, 0);
  }
  assert.equal(buildWellnessContext({ profile, userMessage: "It has been raining for the last few days.", recentConversation: history.slice(0, 4), now }).selectedItems.length, 0);
  assert.equal(buildWellnessContext({ profile, userMessage: "It has been happening for the last few days.", now }).selectedItems.length, 0);
});

test("general study-technique requests do not select private records despite matching academic keywords", () => {
  for (const userMessage of ["What is a good study technique for mathematics?", "Can you suggest a study technique for mathematics?", "Could you recommend study techniques?"]) {
    const context = buildWellnessContext({ profile, userMessage, now,
      moodLogs: [{ moodScore: 2, stressLevel: 4, loggedFor: now }],
      journalEntries: [{ content: "PRIVATE: My study worries", createdAt: now }],
      latestPrediction: { riskCategory: "distress", confidence: .9, createdAt: now } });
    assert.equal(context.selectedItems.length, 0);
    assert.doesNotMatch(context.structuredPrompt, /PRIVATE|Mood score|Stress type:|Academic pressure/);
  }
  assert.ok(buildWellnessContext({ profile, userMessage: "Can you suggest ways to manage my exam stress?", now }).selectedItems.length > 0);
});
