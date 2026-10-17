import Appointment from "../models/Appointment.js";
import Assessment from "../models/Assessment.js";
import ConversationMessage from "../models/ConversationMessage.js";
import JournalEntry from "../models/JournalEntry.js";
import MoodLog from "../models/MoodLog.js";
import StudentProfile from "../models/StudentProfile.js";
import WellnessContextSnapshot from "../models/WellnessContextSnapshot.js";
import { getCurrentStressPrediction } from "./stressPredictionService.js";
import { buildDashboardRecommendations, calculateWellnessScore } from "../utils/dashboardRecommendations.js";
import { summarizeMoodTrend } from "../utils/wellnessScoring.js";
import { dailyMovingAverage } from "../utils/trends.js";

export async function buildStudentDashboard({ user }) {
  const now = new Date();
  const [
    profile,
    assessments,
    moodLogs,
    journalEntries,
    latestPrediction,
    appointments,
    assistantMessages,
    assistantMessageCount,
    latestContext,
    journalTotal
  ] = await Promise.all([
    StudentProfile.findOne({ user: user._id }),
    Assessment.find({ student: user._id }).sort({ takenAt: -1 }).limit(90),
    MoodLog.find({ student: user._id }).sort({ loggedFor: -1 }).limit(90),
    JournalEntry.find({ student: user._id }).sort({ createdAt: -1 }).limit(8),
    getCurrentStressPrediction(user._id),
    Appointment.find({ student: user._id }).sort({ scheduledFor: -1 }).limit(20).populate({ path: "counsellor", select: "name email role" }),
    ConversationMessage.find({ student: user._id }).sort({ createdAt: -1 }).limit(6),
    ConversationMessage.countDocuments({ student: user._id }),
    WellnessContextSnapshot.findOne({ student: user._id }).sort({ createdAt: -1 }),
    JournalEntry.countDocuments({ student: user._id })
  ]);

  const moodSummary = summarizeMoodTrend(moodLogs.slice(0, 14));
  const latestAssessment = assessments[0] || null;
  const upcomingAppointments = appointments
    .filter((appointment) => appointment.scheduledFor >= now && ["pending", "approved"].includes(appointment.status))
    .sort((first, second) => first.scheduledFor - second.scheduledFor);
  const upcomingAppointment = upcomingAppointments[0] || null;
  const wellnessScore = calculateWellnessScore({ latestAssessment, latestPrediction, moodSummary });

  return {
    profile,
    overview: {
      wellnessScore,
      latestAssessment,
      latestPrediction,
      moodSummary,
      journalEntryCount: journalTotal,
      assistantMessageCount,
      latestContextCreatedAt: latestContext?.createdAt || null
    },
    trend: {
      mood: moodSummary.trend,
      assessments: assessments
      , moodDaily: dailyMovingAverage(moodLogs, "moodScore", "loggedFor"),
      stressDaily: dailyMovingAverage(moodLogs, "stressLevel", "loggedFor"),
      wellnessDaily: dailyMovingAverage(assessments, "percentageScore", "takenAt"),
      smoothing: "7-calendar-day trailing average of observed daily means, UTC; missing days are not imputed. Latest 90 records per source."
    },
    counselling: {
      upcomingAppointment,
      upcomingCount: upcomingAppointments.length,
      counts: countByStatus(appointments),
      recentAppointments: appointments.slice(0, 5)
    },
    assistant: {
      recentMessages: assistantMessages.reverse()
    },
    recommendations: buildDashboardRecommendations({
      assistantMessageCount,
      latestAssessment,
      latestPrediction,
      moodSummary,
      upcomingAppointment
    })
  };
}

function countByStatus(appointments) {
  return appointments.reduce(
    (counts, appointment) => ({
      ...counts,
      [appointment.status]: (counts[appointment.status] || 0) + 1
    }),
    {
      pending: 0,
      approved: 0,
      completed: 0,
      cancelled: 0
    }
  );
}
