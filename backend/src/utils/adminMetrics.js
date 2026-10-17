export function summarizeRoleCounts(users = []) {
  return users.reduce(
    (counts, user) => {
      counts.total += 1;
      counts[user.role] = (counts[user.role] || 0) + 1;
      if (user.isActive) {
        counts.active += 1;
      } else {
        counts.inactive += 1;
      }
      return counts;
    },
    { total: 0, active: 0, inactive: 0, student: 0, counsellor: 0, admin: 0 }
  );
}

export function summarizeStatusCounts(items = [], field = "status", statuses = []) {
  const seed = statuses.reduce((counts, status) => ({ ...counts, [status]: 0 }), { total: items.length });

  return items.reduce((counts, item) => {
    const value = item[field];
    return {
      ...counts,
      [value]: (counts[value] || 0) + 1
    };
  }, seed);
}

export function calculateSystemReadiness({ userCounts, trackingCount, predictionCount, appointmentCount }) {
  const checks = [
    userCounts.student > 0,
    userCounts.counsellor > 0,
    trackingCount > 0,
    predictionCount > 0,
    appointmentCount > 0
  ];
  const completed = checks.filter(Boolean).length;

  return {
    completed,
    total: checks.length,
    percentage: Math.round((completed / checks.length) * 100)
  };
}
