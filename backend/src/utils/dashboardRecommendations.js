export function buildDashboardRecommendations({
  assistantMessageCount = 0,
  latestAssessment = null,
  latestPrediction = null,
  moodSummary = null,
  upcomingAppointment = null
}) {
  const recommendations = [];

  if (latestAssessment?.riskLevel === "high") {
    recommendations.push({
      priority: "high",
      title: "Use human support soon",
      detail: upcomingAppointment
        ? "Keep your counselling session and share what has felt hardest recently."
        : "Book a counselling session so a trained person can review your current wellness signals."
    });
  }

  if (latestPrediction?.riskCategory === "distress" && !upcomingAppointment) {
    recommendations.push({
      priority: "medium",
      title: "Add a counselling checkpoint",
      detail: "If the stress you reported is affecting daily life, a counsellor can help you plan support. The model estimate is not a diagnosis."
    });
  }

  if (moodSummary?.averageStress >= 4) {
    recommendations.push({
      priority: "medium",
      title: "Lower today’s stress load",
      detail: "Choose one task, set a 25-minute timer, and take a five-minute reset before starting the next task."
    });
  }

  if (moodSummary?.averageMood != null && moodSummary.averageMood <= 2.5) {
    recommendations.push({
      priority: "medium",
      title: "Plan one connection",
      detail: "Send one simple message to a friend, mentor, family member, or classmate before the day ends."
    });
  }

  if (latestPrediction?.features?.averageSleepHours != null && latestPrediction.features.averageSleepHours < 6) {
    recommendations.push({
      priority: "medium",
      title: "Protect tonight’s sleep window",
      detail: "Pick a fixed screen stop time and write tomorrow’s first task before bed."
    });
  }

  if (!moodSummary?.entries) {
    recommendations.push({
      priority: "low",
      title: "Start a three-day baseline",
      detail: "Log mood, stress, and sleep for three days so predictions and summaries become more useful."
    });
  }

  if (!assistantMessageCount) {
    recommendations.push({
      priority: "low",
      title: "Use the assistant for reflection",
      detail: "Try one message about what is affecting you today, then save any useful next step."
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      priority: "low",
      title: "Keep the routine steady",
      detail: "Continue mood tracking and review your trend after the next assessment."
    });
  }

  return recommendations.slice(0, 4);
}

export function calculateWellnessScore({ latestAssessment = null, moodSummary = null, latestPrediction = null }) {
  if (latestAssessment?.percentageScore != null) {
    return latestAssessment.percentageScore;
  }

  if (moodSummary?.averageMood != null) {
    return Math.round(moodSummary.averageMood * 20);
  }

  return null;
}
