const SLOT_MS = 30 * 60 * 1000;

export function toLocalDateTimeInput(value) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function minimumAppointmentTime(now = new Date()) {
  // Anchor HTML steps to the same UTC half-hour slots enforced by the backend.
  // Always advance, including when now is exactly on a slot boundary.
  return toLocalDateTimeInput(new Date((Math.floor(now.getTime() / SLOT_MS) + 1) * SLOT_MS));
}

export function isFutureAppointmentSlot(value, now = new Date()) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date > now &&
    date.getUTCMinutes() % 30 === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
}
