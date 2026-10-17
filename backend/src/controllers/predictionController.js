import Assessment from "../models/Assessment.js";
import JournalEntry from "../models/JournalEntry.js";
import MoodLog from "../models/MoodLog.js";
import WellnessPrediction from "../models/WellnessPrediction.js";
import StressSurvey from "../models/StressSurvey.js";
import { canonicalStressAnswers, getCurrentStressPrediction, getCurrentStressSurvey, getStressModelIdentity,
  predictionKey, predictStressType } from "../services/stressPredictionService.js";
import { invalidateDerivedContext } from "../services/contextInvalidationService.js";
import { stressAnswersSchema, stressSurveyContract } from "../utils/stressSurvey.js";
import { buildWellnessFeatures } from "../utils/wellnessFeatures.js";

export async function createMyPrediction(req, res, next) {
  try {
    const survey = await getCurrentStressSurvey(req.user._id);
    if (!survey) return res.status(422).json({ message: "Complete the research stress survey within the last 30 days before generating a prediction." });
    // Check availability even when reusing a result; never silently substitute a predictor.
    const identity = await getStressModelIdentity();
    const existing = await getCurrentStressPrediction(req.user._id);
    if (existing) return res.status(201).json({ prediction: existing, reused: true });
    const answers = canonicalStressAnswers(survey.answers);
    const predictionResult = await predictStressType(answers);
    const current = await getCurrentStressSurvey(req.user._id);
    if (!current || current.id !== survey.id || predictionResult.modelSha256 !== identity.modelSha256 ||
        JSON.stringify(canonicalStressAnswers(current.answers)) !== JSON.stringify(answers)) {
      return res.status(409).json({ message: "Prediction inputs changed. Generate an estimate from your latest saved responses." });
    }
    const key = predictionKey(req.user._id, survey._id, answers, identity.modelSha256);
    const filter = { student: req.user._id, predictionKey: key };
    // Atomic insert/reuse protects concurrent requests without rewriting historical results.
    try {
      await WellnessPrediction.updateOne(filter, { $setOnInsert: {
        ...predictionResult, ...filter, survey: survey._id, surveyAnswers: answers
      } }, { upsert: true, runValidators: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    await invalidateDerivedContext(req.user._id);
    const prediction = await getCurrentStressPrediction(req.user._id);
    if (!prediction || prediction.predictionKey !== key) {
      return res.status(409).json({ message: "Prediction inputs changed. Generate an estimate from your latest saved responses." });
    }
    return res.status(201).json({ prediction });
  } catch (error) {
    return next(error);
  }
}

export async function getMyLatestPrediction(req, res, next) {
  try {
    const prediction = await getCurrentStressPrediction(req.user._id);
    return res.json({ prediction });
  } catch (error) {
    return next(error);
  }
}

export async function getMyPredictionFeatures(req, res, next) {
  try {
    const context = await loadStudentPredictionContext(req.user._id);
    return res.json({ features: buildWellnessFeatures(context) });
  } catch (error) {
    return next(error);
  }
}

export async function getStressSurvey(req, res, next) {
  try {
    const survey = await StressSurvey.findOne({ student: req.user._id }).sort({ createdAt: -1, _id: -1 });
    return res.json({ contract: stressSurveyContract, survey });
  } catch (error) { return next(error); }
}

export async function saveStressSurvey(req, res, next) {
  try {
    const answers = stressAnswersSchema.parse(req.body.answers);
    const current = await getCurrentStressSurvey(req.user._id);
    if (current && JSON.stringify(canonicalStressAnswers(current.answers)) === JSON.stringify(answers)) {
      return res.status(201).json({ survey: current, reused: true });
    }
    const survey = await StressSurvey.create({ student: req.user._id, schemaVersion: stressSurveyContract.version, answers });
    await invalidateDerivedContext(req.user._id);
    return res.status(201).json({ survey });
  } catch (error) { return next(error); }
}

async function loadStudentPredictionContext(studentId) {
  const [assessments, moodLogs, journalEntries] = await Promise.all([
    Assessment.find({ student: studentId }).sort({ takenAt: -1 }).limit(6),
    MoodLog.find({ student: studentId }).sort({ loggedFor: -1 }).limit(30),
    JournalEntry.find({ student: studentId }).sort({ createdAt: -1 }).limit(20)
  ]);

  return { assessments, moodLogs, journalEntries };
}
