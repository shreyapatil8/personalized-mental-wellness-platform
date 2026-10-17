import Assessment from "../models/Assessment.js";
import JournalEntry from "../models/JournalEntry.js";
import MoodLog from "../models/MoodLog.js";
import StudentProfile from "../models/StudentProfile.js";
import WellnessContextSnapshot from "../models/WellnessContextSnapshot.js";
import { getCurrentStressPrediction } from "./stressPredictionService.js";
import { buildWellnessContext } from "../utils/wellnessIntelligenceEngine.js";

export async function generateWellnessContext({ user, userMessage, recentConversation = [], tokenBudget = 1400, maxItems = 10 }) {
  if (!user?._id) {
    const error = new Error("An authenticated student is required for wellness context.");
    error.statusCode = 401;
    throw error;
  }
  const [profile, assessments, moodLogs, latestPrediction] = await Promise.all([
    StudentProfile.findOne({ user: user._id }),
    Assessment.find({ student: user._id }).sort({ takenAt: -1 }).limit(8),
    // The context engine uses plain-object projection for aggregate calculations.
    // Spreading hydrated Mongoose documents in summarizeMoodPattern omits schema
    // fields, leaving the aggregate without provenance or a timestamp.
    MoodLog.find({ student: user._id }).sort({ loggedFor: -1 }).limit(30).lean(),
    getCurrentStressPrediction(user._id)
  ]);

  const journalEntries = profile?.consentForAssistantJournalContext
    ? await JournalEntry.find({ student: user._id }).sort({ createdAt: -1 }).limit(20)
    : [];

  const context = buildWellnessContext({
    user,
    profile,
    assessments,
    moodLogs,
    journalEntries,
    latestPrediction,
    userMessage,
    // The engine resolves follow-ups from student turns, not assistant suggestions.
    // Paired history remains separate from personal-context slots and budget.
    recentConversation,
    tokenBudget,
    maxItems
  });

  const snapshot = await WellnessContextSnapshot.create({
    student: user._id,
    userMessage,
    tokenBudget,
    selectedItems: context.selectedItems,
    candidateCount: context.candidateCount,
    estimatedTokens: context.estimatedTokens,
    structuredPrompt: context.structuredPrompt
  });

  return snapshot;
}
