import assert from "node:assert/strict";
import test from "node:test";
import { dailyMovingAverage } from "./trends.js";
import { stressAnswersSchema, stressSurveyContract } from "./stressSurvey.js";
import { buildWellnessContext, estimateTokens, selectTopContext } from "./wellnessIntelligenceEngine.js";
import { calculateWellnessScore } from "./dashboardRecommendations.js";

test("survey refuses missing, invented and out-of-range features", () => {
  const valid = Object.fromEntries(stressSurveyContract.questions.map((question) => [question.id, 3]));
  assert.deepEqual(stressAnswersSchema.parse(valid), valid);
  assert.throws(() => stressAnswersSchema.parse({}));
  assert.throws(() => stressAnswersSchema.parse({ ...valid, averageMoodScore: 3 }));
  assert.throws(() => stressAnswersSchema.parse({ ...valid, survey_01: 6 }));
});

test("moving average aggregates same-day entries and respects calendar gaps", () => {
  const result = dailyMovingAverage([
    { date: "2026-01-01", score: 2 }, { date: "2026-01-01", score: 4 },
    { date: "2026-01-03", score: 5 }, { date: "2026-02-01", score: 1 }
  ], "score", "date");
  assert.equal(result[0].value, 3);
  assert.equal(result[1].movingAverage, 4);
  assert.equal(result[2].movingAverage, 1);
  assert.equal(result[2].observedDays, 1);
});

test("personal context rejects stale records and budgets its rendered prompt independently of chat", () => {
  const context = buildWellnessContext({ userMessage: "exam stress", tokenBudget: 400,
    now: new Date("2026-09-22"), journalEntries: [
      { _id: "stale", title: "exam", content: "exam stress", sentiment: "negative", createdAt: "2020-01-01" },
      { _id: "large", title: "exam", content: "exam stress ".repeat(500), createdAt: "2026-09-21" },
      { _id: "recent", title: "exam", content: "exam stress", createdAt: "2026-09-21" }
    ] });
  assert.ok(context.selectedItems.every((item) => item.sourceId !== "stale"));
  const excerpt = context.selectedItems.find((item) => item.sourceId === "large");
  if (excerpt) assert.match(excerpt.content, /excerpt truncated/);
  assert.equal(context.estimatedTokens, estimateTokens(context.structuredPrompt));
  assert.ok(context.estimatedTokens <= 400);
  assert.doesNotMatch(context.structuredPrompt, /Current student message:/);
  assert.equal(selectTopContext([{ estimatedTokens: 500 }], 100).length, 0);
});

test("stress type alone cannot manufacture a numeric wellness score", () => {
  assert.equal(calculateWellnessScore({ latestPrediction: { riskCategory: "eustress" } }), null);
});
