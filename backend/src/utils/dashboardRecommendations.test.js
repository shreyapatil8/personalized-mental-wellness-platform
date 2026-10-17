import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboardRecommendations, calculateWellnessScore } from "./dashboardRecommendations.js";

test("buildDashboardRecommendations prioritizes high risk and counselling", () => {
  const recommendations = buildDashboardRecommendations({
    latestAssessment: { riskLevel: "high" },
    moodSummary: { averageStress: 4.2, averageMood: 3, entries: 5 },
    assistantMessageCount: 3
  });

  assert.equal(recommendations[0].priority, "high");
  assert.match(recommendations[0].title, /human support/i);
  assert.ok(recommendations.length <= 4);
});

test("buildDashboardRecommendations prompts baseline tracking when no mood data exists", () => {
  const recommendations = buildDashboardRecommendations({
    moodSummary: { entries: 0 },
    assistantMessageCount: 1
  });

  assert.ok(recommendations.some((item) => /baseline/i.test(item.title)));
});

test("calculateWellnessScore prefers latest assessment score", () => {
  assert.equal(
    calculateWellnessScore({
      latestAssessment: { percentageScore: 68 },
      moodSummary: { averageMood: 2 }
    }),
    68
  );
});

test("calculateWellnessScore can use average mood when no assessment exists", () => {
  assert.equal(
    calculateWellnessScore({
      moodSummary: { averageMood: 3.5 }
    }),
    70
  );
});
