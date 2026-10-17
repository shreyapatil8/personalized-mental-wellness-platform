import assert from "node:assert/strict";
import test from "node:test";
import { buildInitialAssessmentOverview } from "./counsellingSummary.js";
import { initialWellnessContract } from "./initialWellnessAssessment.js";

const assessment = {
  schemaVersion: initialWellnessContract.version,
  completedAt: new Date("2026-09-01T10:00:00Z"),
  updatedAt: new Date("2026-10-01T10:00:00Z"),
  responses: { ...Object.fromEntries(initialWellnessContract.questions.filter((q) => !q.optional).map((q) => [q.id, q.options[2]])),
    additionalNotes: "Unselected free text", unexpected: "Private extra field" }
};

test("factual assessment uses all valid structured baseline answers and latest date", () => {
  const result = buildInitialAssessmentOverview(assessment, "sleep");
  assert.equal(result.recordedAt, assessment.updatedAt);
  assert.deepEqual(result.responses.map((item) => item.id), initialWellnessContract.questions.filter(q => !q.optional).map(q => q.id));
  for (const item of result.responses) assert.equal(item.response, assessment.responses[item.id]);
  assert.doesNotMatch(JSON.stringify(result), /Unselected free text|Private extra field|riskLevel/);
  const academic = buildInitialAssessmentOverview(assessment, "academic_stress");
  assert.ok(academic.responses.some((item) => item.id === "academicPressure"));
  assert.ok(academic.responses.some((item) => item.id === "sleepHours"));
});

test("missing, legacy and invalid data is not invented; general concern only gets the baseline", () => {
  assert.equal(buildInitialAssessmentOverview(undefined, "sleep"), null);
  assert.equal(buildInitialAssessmentOverview({ ...assessment, schemaVersion: "unknown" }, "sleep"), null);
  assert.equal(buildInitialAssessmentOverview({ ...assessment, updatedAt: "invalid" }, "sleep"), null);
  const partial = buildInitialAssessmentOverview({ ...assessment, updatedAt: undefined,
    responses: { overallWellbeing: "Good", stressFrequency: "invented value" } }, "general");
  assert.equal(partial.recordedAt, assessment.completedAt);
  assert.deepEqual(partial.responses.map((item) => item.response), ["Good"]);
  assert.equal(buildInitialAssessmentOverview(assessment, "general").responses.length, 14);
});

test("AI briefing context follows the appointment concern, excludes unshared notes and stays bounded", async () => {
  const { prepareCounsellingSummary, summaryInstructions } = await import("./counsellingSummary.js");
  const now = new Date();
  const records = { profile: { updatedAt: now, wellnessGoals: ["Improve sleep", "Interview preparation"],
    initialWellnessAssessment: { ...assessment, updatedAt: now, responses: { ...assessment.responses, additionalNotes: "UNRELATED_ONBOARDING_NOTE" } } },
    moodLogs: [{ moodScore: 2, stressLevel: 4, sleepHours: 5, loggedFor: now }],
    journalEntries: [{ content: "Sleep has been interrupted by noise.", createdAt: now }, { content: "Interview practice went well.", createdAt: now }],
    latestPrediction: { riskCategory: "distress", confidence: .8, createdAt: now } };
  const sleep = prepareCounsellingSummary(records, { concernType: "sleep", scheduledFor: now });
  assert.match(sleep.prompt, /Appointment concern: sleep and rest/);
  assert.match(sleep.prompt, /Sleep quality:|sleep 5 hours|Sleep has been interrupted/);
  assert.match(sleep.prompt, /not a diagnosis or clinical severity/);
  assert.doesNotMatch(sleep.prompt, /UNRELATED_ONBOARDING_NOTE|Interview practice|Interview preparation|Sleep has been interrupted/);
  assert.match(sleep.prompt, /Student journal themes: sleep/);
  assert.deepEqual(sleep.selectedItems.find(item => item.sourceType === "profile").sharedProfile.wellnessGoals, ["Improve sleep"]);
  for (const label of ["Overall well-being", "Stress frequency", "Academic pressure", "Academic satisfaction", "Concentration", "Sleep quality", "Nightly sleep hours", "Anxiety frequency", "Low mood frequency", "Peer connection", "Support satisfaction", "Time management difficulty", "Primary concern", "Preferred support"]) assert.ok(sleep.prompt.includes(label + ":"), label);
  assert.ok(sleep.prompt.length < 2200 * 4);
  const career = prepareCounsellingSummary(records, { concernType: "career", scheduledFor: now });
  assert.match(career.prompt, /Interview preparation/);
  assert.doesNotMatch(career.prompt, /Stress type:|Student journal themes: sleep|Sleep has been interrupted/);
  assert.notEqual(sleep.digest, career.digest);
  assert.match(summaryInstructions, /Do not invent symptoms, diagnoses, events, treatment history, medication/);
  assert.match(summaryInstructions, /without quoting journal text verbatim/);
  assert.match(summaryInstructions, /If the initial assessment or appointment concern is missing/);
  assert.equal(prepareCounsellingSummary({}, { concernType: "sleep" }).sourceCount, 0);
  assert.ok(sleep.coverage.sources.includes("Initial wellness assessment"));
  assert.ok(sleep.coverage.sources.includes("Mood check-ins"));
  assert.ok(sleep.coverage.sources.includes("Journal themes"));
  assert.ok(sleep.coverage.from instanceof Date);
  assert.ok(sleep.coverage.through instanceof Date);
});

test("booking note changes retrieval and freshness; optional assessment note is selected only when relevant", async () => {
  const { prepareCounsellingSummary } = await import("./counsellingSummary.js");
  const now = new Date();
  const records = { profile: { updatedAt: now, initialWellnessAssessment: { ...assessment, updatedAt: now,
    responses: { ...assessment.responses, additionalNotes: "I want help preparing for career interviews." } } },
    journalEntries: [
      { title: "PRIVATE_SLEEP_TITLE", content: "Sleep was interrupted. PRIVATE_UNRELATED_DETAIL", createdAt: now },
      { title: "PRIVATE_CAREER_TITLE", content: "Career interviews are coming up. PRIVATE_OTHER_DETAIL", createdAt: now },
      { content: "Sleep used to be better", createdAt: new Date(now - 100 * 86400000) }
    ] };
  const sleep = prepareCounsellingSummary(records, { concernType: "sleep" });
  assert.doesNotMatch(sleep.prompt, /I want help preparing|PRIVATE_|used to be better/);
  const combined = prepareCounsellingSummary(records, { concernType: "sleep", notes: "Career interviews keep me awake." });
  assert.match(combined.prompt, /I want help preparing for career interviews/);
  assert.match(combined.prompt, /Student journal themes: career/);
  assert.doesNotMatch(combined.prompt, /PRIVATE_/);
  assert.notEqual(combined.digest, sleep.digest);
  const empty = prepareCounsellingSummary({}, { concernType: "", notes: "  " });
  assert.equal(empty.sourceCount, 0);
  assert.match(empty.prompt, /Appointment concern: Not provided/);
  assert.match(empty.prompt, /No appointment note provided/);
});

test("assistant and counsellor context use the same deterministic mood-pattern facts", async () => {
  const { prepareCounsellingSummary } = await import("./counsellingSummary.js");
  const { buildWellnessContext } = await import("./wellnessIntelligenceEngine.js");
  const now = new Date();
  const moodLogs = [2, 4, 8, 10].map((day, index) => ({ _id: "shared-mood-" + index,
    moodScore: index < 2 ? 2 : 4, stressLevel: 3, sleepHours: 6,
    loggedFor: new Date(+now - day * 86400000) }));
  const appointmentMessage = "Help with sleep and rest for my counselling session.";
  const assistant = buildWellnessContext({ userMessage: appointmentMessage, moodLogs, now, tokenBudget: 2100, maxItems: 10 });
  const counsellor = prepareCounsellingSummary({ moodLogs }, { concernType: "sleep" });
  assert.equal(counsellor.selectedItems.find(item => item.sourceType === "mood_pattern")?.content,
    assistant.selectedItems.find(item => item.sourceType === "mood_pattern")?.content);
});
