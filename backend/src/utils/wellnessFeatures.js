export function buildWellnessFeatures({ assessments = [], moodLogs = [], journalEntries = [] }) {
  const latestAssessment = assessments[0] || null;
  const moodEntryCount = moodLogs.length;
  const assessmentCount = assessments.length;
  const journalEntryCount = journalEntries.length;

  const averageMoodScore = average(moodLogs.map((log) => log.moodScore));
  const averageStressLevel = average(moodLogs.map((log) => log.stressLevel));
  const averageSleepHours = average(moodLogs.map((log) => log.sleepHours).filter((value) => value != null));
  const moodVolatility = standardDeviation(moodLogs.map((log) => log.moodScore));
  const journalNegativeRatio = ratio(
    journalEntries.filter((entry) => entry.sentiment === "negative").length,
    journalEntryCount
  );

  return {
    latestWho5Score: latestAssessment?.percentageScore ?? null,
    assessmentRiskScore: assessmentRiskToScore(latestAssessment?.riskLevel),
    averageMoodScore,
    averageStressLevel,
    averageSleepHours,
    moodVolatility,
    journalNegativeRatio,
    journalEntryCount,
    moodEntryCount,
    assessmentCount
  };
}

export function normalizeFeatureValue(value, fallback) {
  return value == null || Number.isNaN(Number(value)) ? fallback : Number(value);
}

function assessmentRiskToScore(riskLevel) {
  if (riskLevel === "high") {
    return 3;
  }

  if (riskLevel === "moderate") {
    return 2;
  }

  if (riskLevel === "low") {
    return 1;
  }

  return null;
}

function average(values) {
  const cleanValues = values.map(Number).filter((value) => Number.isFinite(value));
  if (!cleanValues.length) {
    return null;
  }

  return roundTwo(cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length);
}

function standardDeviation(values) {
  const cleanValues = values.map(Number).filter((value) => Number.isFinite(value));
  if (cleanValues.length < 2) {
    return 0;
  }

  const mean = cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length;
  const variance = cleanValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / cleanValues.length;
  return roundTwo(Math.sqrt(variance));
}

function ratio(numerator, denominator) {
  if (!denominator) {
    return 0;
  }

  return roundTwo(numerator / denominator);
}

function roundTwo(value) {
  return Math.round(value * 100) / 100;
}
