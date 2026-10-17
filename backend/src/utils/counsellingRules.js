const transitions = {
  student: {
    pending: ["cancelled"],
    approved: ["cancelled"],
    completed: [],
    cancelled: []
  },
  counsellor: {
    pending: ["approved", "cancelled"],
    approved: ["completed", "cancelled"],
    completed: [],
    cancelled: []
  }
};

export function canChangeAppointmentStatus({ role, currentStatus, nextStatus, ownsAppointment }) {
  if (!ownsAppointment) {
    return false;
  }

  return transitions[role]?.[currentStatus]?.includes(nextStatus) ?? false;
}

export function isFutureAppointment(value, now = new Date()) {
  const scheduledFor = new Date(value);
  return Number.isFinite(scheduledFor.getTime()) && scheduledFor.getTime() > now.getTime();
}

export function titleConcernType(value) {
  return String(value || "general")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
