import assert from "node:assert/strict";
import test from "node:test";

import { calculateWho5Score, summarizeMoodTrend } from "./wellnessScoring.js";

test("calculateWho5Score returns low risk for high WHO-5 scores", () => {
  assert.deepEqual(calculateWho5Score([5, 5, 4, 5, 4]), {
    rawScore: 23,
    percentageScore: 92,
    riskLevel: "low"
  });
});

test("calculateWho5Score returns moderate risk for mid WHO-5 scores", () => {
  assert.deepEqual(calculateWho5Score([2, 2, 2, 3, 3]), {
    rawScore: 12,
    percentageScore: 48,
    riskLevel: "moderate"
  });
});

test("calculateWho5Score returns high risk for low WHO-5 scores", () => {
  assert.deepEqual(calculateWho5Score([1, 1, 1, 1, 0]), {
    rawScore: 4,
    percentageScore: 16,
    riskLevel: "high"
  });
});

test("calculateWho5Score rejects invalid response counts", () => {
  assert.throws(() => calculateWho5Score([1, 2, 3]), /exactly five/);
});

test("calculateWho5Score rejects out-of-range values", () => {
  assert.throws(() => calculateWho5Score([1, 2, 3, 4, 6]), /integers from 0 to 5/);
});

test("summarizeMoodTrend handles empty mood logs", () => {
  assert.deepEqual(summarizeMoodTrend([]), {
    averageMood: null,
    averageStress: null,
    entries: 0,
    trend: []
  });
});

test("summarizeMoodTrend calculates averages and chronological trend", () => {
  const summary = summarizeMoodTrend([
    { _id: "2", loggedFor: "2026-09-02", moodScore: 4, stressLevel: 2 },
    { _id: "1", loggedFor: "2026-09-01", moodScore: 2, stressLevel: 4 }
  ]);

  assert.equal(summary.averageMood, 3);
  assert.equal(summary.averageStress, 3);
  assert.equal(summary.entries, 2);
  assert.deepEqual(summary.trend.map((item) => item.id), ["1", "2"]);
});
