import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import { isFutureAppointmentSlot, minimumAppointmentTime, toLocalDateTimeInput } from "../src/utils/appointmentTime.js";

test("off-minute minimum accepts future hour and half-hour values without an HTML step mismatch", () => {
  const now = new Date("2026-10-02T10:17:23+05:30");
  const minimum = new Date(minimumAppointmentTime(now));
  assert.equal(minimum.toISOString(), "2026-10-02T05:00:00.000Z");
  for (const iso of ["2026-10-02T10:30:00+05:30", "2026-10-02T11:00:00+05:30", "2026-10-03T10:00:00+05:30"]) {
    const input = toLocalDateTimeInput(iso);
    assert.equal(isFutureAppointmentSlot(input, now), true);
    assert.equal((new Date(input) - minimum) % 1800000, 0);
  }
});

test("minimum is strictly future at exact boundaries and rolls into the next day", () => {
  for (const [now, expected] of [
    ["2026-10-02T10:00:00Z", "2026-10-02T10:30:00Z"],
    ["2026-10-02T10:30:00Z", "2026-10-02T11:00:00Z"],
    ["2026-10-02T23:59:59Z", "2026-10-03T00:00:00Z"]
  ]) assert.equal(new Date(minimumAppointmentTime(new Date(now))).getTime(), new Date(expected).getTime());
});

test("submission refuses past, elapsed, empty, invalid and off-slot times", () => {
  const now = new Date("2026-10-02T10:30:00Z");
  for (const invalid of ["", "invalid", "2026-10-02T10:00:00Z", now.toISOString(),
    "2026-10-02T11:17:00Z", "2026-10-02T11:00:01Z", "2026-10-02T11:00:00.001Z"]) {
    assert.equal(isFutureAppointmentSlot(invalid, now), false, invalid);
  }
  const previouslyValid = minimumAppointmentTime(new Date("2026-10-02T10:17:00Z"));
  assert.equal(isFutureAppointmentSlot(previouslyValid, now), false);
});

test("local input round-trips to the backend instant across timezones", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["Asia/Kolkata", "UTC", "America/New_York", "Asia/Kathmandu"]) {
      process.env.TZ = zone;
      const now = new Date("2026-10-02T04:47:12Z");
      const input = minimumAppointmentTime(now);
      assert.equal(new Date(input).toISOString(), "2026-10-02T05:00:00.000Z", zone);
      assert.equal(isFutureAppointmentSlot(input, now), true, zone);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
