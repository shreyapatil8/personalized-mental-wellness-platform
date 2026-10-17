export const moodScoreByLabel = {
  very_low: 1,
  low: 2,
  neutral: 3,
  good: 4,
  great: 5
};

export const who5Questions = [
  "I have felt cheerful and in good spirits.",
  "I have felt calm and relaxed.",
  "I have felt active and vigorous.",
  "I woke up feeling fresh and rested.",
  "My daily life has been filled with things that interest me."
];

export function calculateWho5Score(responses) {
  if (!Array.isArray(responses) || responses.length !== 5) {
    throw new Error("WHO-5 requires exactly five responses.");
  }

  const rawScore = responses.reduce((sum, value) => {
    const score = Number(value);
    if (!Number.isInteger(score) || score < 0 || score > 5) {
      throw new Error("WHO-5 responses must be integers from 0 to 5.");
    }

    return sum + score;
  }, 0);

  const percentageScore = rawScore * 4;
  let riskLevel = "low";

  if (percentageScore < 32) {
    riskLevel = "high";
  } else if (percentageScore < 52) {
    riskLevel = "moderate";
  }

  return { rawScore, percentageScore, riskLevel };
}

export function summarizeMoodTrend(logs) {
  if (!logs.length) {
    return {
      averageMood: null,
      averageStress: null,
      entries: 0,
      trend: []
    };
  }

  const averageMood = roundOne(logs.reduce((sum, log) => sum + log.moodScore, 0) / logs.length);
  const averageStress = roundOne(logs.reduce((sum, log) => sum + log.stressLevel, 0) / logs.length);

  return {
    averageMood,
    averageStress,
    entries: logs.length,
    trend: logs
      .slice()
      .reverse()
      .map((log) => ({
        id: log._id?.toString(),
        date: log.loggedFor,
        moodScore: log.moodScore,
        stressLevel: log.stressLevel
      }))
  };
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}
