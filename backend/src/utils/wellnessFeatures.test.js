import assert from "node:assert/strict";
import test from "node:test";

import { buildWellnessFeatures } from "./wellnessFeatures.js";

test("buildWellnessFeatures aggregates assessment, mood, and journal data", () => {
  const features = buildWellnessFeatures({
    assessments: [{ percentageScore: 44, riskLevel: "moderate" }],
    moodLogs: [
      { moodScore: 2, stressLevel: 5, sleepHours: 4 },
      { moodScore: 4, stressLevel: 3, sleepHours: 8 }
    ],
    journalEntries: [
      { sentiment: "negative" },
      { sentiment: "mixed" },
      { sentiment: "positive" }
    ]
  });

  assert.equal(features.latestWho5Score, 44);
  assert.equal(features.assessmentRiskScore, 2);
  assert.equal(features.averageMoodScore, 3);
  assert.equal(features.averageStressLevel, 4);
  assert.equal(features.averageSleepHours, 6);
  assert.equal(features.journalNegativeRatio, 0.33);
  assert.equal(features.journalEntryCount, 3);
  assert.equal(features.moodEntryCount, 2);
  assert.equal(features.assessmentCount, 1);
});
