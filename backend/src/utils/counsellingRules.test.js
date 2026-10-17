import assert from "node:assert/strict";
import test from "node:test";

import { canChangeAppointmentStatus, isFutureAppointment, titleConcernType } from "./counsellingRules.js";

test("students can cancel pending or approved appointments they own", () => {
  assert.equal(
    canChangeAppointmentStatus({
      role: "student",
      currentStatus: "pending",
      nextStatus: "cancelled",
      ownsAppointment: true
    }),
    true
  );
  assert.equal(
    canChangeAppointmentStatus({
      role: "student",
      currentStatus: "approved",
      nextStatus: "cancelled",
      ownsAppointment: true
    }),
    true
  );
});

test("counsellors can approve pending appointments they own", () => {
  assert.equal(
    canChangeAppointmentStatus({
      role: "counsellor",
      currentStatus: "pending",
      nextStatus: "approved",
      ownsAppointment: true
    }),
    true
  );
});

test("status changes are rejected for non-owners and closed appointments", () => {
  assert.equal(
    canChangeAppointmentStatus({
      role: "counsellor",
      currentStatus: "completed",
      nextStatus: "cancelled",
      ownsAppointment: true
    }),
    false
  );
  assert.equal(
    canChangeAppointmentStatus({
      role: "student",
      currentStatus: "pending",
      nextStatus: "cancelled",
      ownsAppointment: false
    }),
    false
  );
});

test("isFutureAppointment accepts only valid future dates", () => {
  const now = new Date("2026-09-08T10:00:00.000Z");
  assert.equal(isFutureAppointment("2026-09-08T10:30:00.000Z", now), true);
  assert.equal(isFutureAppointment("2026-09-08T09:30:00.000Z", now), false);
  assert.equal(isFutureAppointment("not-a-date", now), false);
});

test("titleConcernType formats concern ids", () => {
  assert.equal(titleConcernType("academic_stress"), "Academic Stress");
});
