import assert from "node:assert/strict";
import test from "node:test";

import { calculateSystemReadiness, summarizeRoleCounts, summarizeStatusCounts } from "./adminMetrics.js";

test("summarizeRoleCounts counts roles and active users", () => {
  const result = summarizeRoleCounts([
    { role: "student", isActive: true },
    { role: "student", isActive: false },
    { role: "counsellor", isActive: true },
    { role: "admin", isActive: true }
  ]);

  assert.deepEqual(result, {
    total: 4,
    active: 3,
    inactive: 1,
    student: 2,
    counsellor: 1,
    admin: 1
  });
});

test("summarizeStatusCounts counts known and unexpected statuses", () => {
  const result = summarizeStatusCounts(
    [{ status: "pending" }, { status: "approved" }, { status: "pending" }, { status: "paused" }],
    "status",
    ["pending", "approved", "completed"]
  );

  assert.equal(result.total, 4);
  assert.equal(result.pending, 2);
  assert.equal(result.approved, 1);
  assert.equal(result.completed, 0);
  assert.equal(result.paused, 1);
});

test("calculateSystemReadiness converts completed checks into a percentage", () => {
  const result = calculateSystemReadiness({
    userCounts: { student: 4, counsellor: 1 },
    trackingCount: 12,
    predictionCount: 2,
    appointmentCount: 0
  });

  assert.deepEqual(result, { completed: 4, total: 5, percentage: 80 });
});
