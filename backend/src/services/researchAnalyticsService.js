import Appointment from "../models/Appointment.js";
import Feedback from "../models/Feedback.js";
import RequestMetric from "../models/RequestMetric.js";
import User from "../models/User.js";
import WellnessPrediction from "../models/WellnessPrediction.js";
import MoodLog from "../models/MoodLog.js";
import Assessment from "../models/Assessment.js";
import JournalEntry from "../models/JournalEntry.js";
import ConversationMessage from "../models/ConversationMessage.js";
import WellnessContextSnapshot from "../models/WellnessContextSnapshot.js";

export async function buildResearchOverview() {
  const since = new Date(Date.now() - 30 * 86400000);
  const [roles, statuses, activityCounts, stressTypes, feedback, performance, registrations] = await Promise.all([
    User.aggregate([{ $group: { _id: { role: "$role", active: "$isActive" }, count: { $sum: 1 } } }]),
    Appointment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Promise.all([MoodLog, Assessment, JournalEntry, WellnessPrediction, ConversationMessage, WellnessContextSnapshot].map((model) => model.countDocuments({}))),
    WellnessPrediction.aggregate([{ $match: { schemaVersion: "kaggle-stress-type-v1", createdAt: { $gte: since } } },
      { $sort: { createdAt: -1 } }, { $group: { _id: "$student", category: { $first: "$riskCategory" } } },
      { $group: { _id: "$category", count: { $sum: 1 } } }]),
    Feedback.aggregate([{ $match: { createdAt: { $gte: since } } },
      { $group: { _id: { role: "$role", category: "$category" }, count: { $sum: 1 }, rating: { $avg: "$rating" }, helpfulness: { $avg: "$helpfulness" } } }]),
    RequestMetric.aggregate([{ $match: { recordedAt: { $gte: since } } },
      { $group: { _id: { route: "$route", method: "$method" }, count: { $sum: 1 }, averageMs: { $avg: "$durationMs" }, maxMs: { $max: "$durationMs" },
        successes: { $sum: { $cond: [{ $lt: ["$status", 400] }, 1, 0] } }, serverErrors: { $sum: { $cond: [{ $gte: ["$status", 500] }, 1, 0] } } } }, { $sort: { count: -1 } }]),
    User.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } }, role: "$role" }, count: { $sum: 1 } } }, { $sort: { "_id.day": 1 } }])
  ]);
  const users = { total: 0, active: 0, inactive: 0, student: 0, counsellor: 0, admin: 0 };
  for (const row of roles) { users.total += row.count; users[row._id.role] += row.count; users[row._id.active ? "active" : "inactive"] += row.count; }
  const counts = { total: 0, pending: 0, approved: 0, completed: 0, cancelled: 0 };
  for (const row of statuses) { counts[row._id] = row.count; counts.total += row.count; }
  const [moodCount, assessmentCount, journalCount, predictionCount, assistantMessageCount, contextCount] = activityCounts;
  return { users, appointments: { counts }, activity: { moodCount, assessmentCount, journalCount, predictionCount, assistantMessageCount, contextCount, trackingCount: moodCount + assessmentCount + journalCount },
    stressTypes, feedback, performance: performance.map((row) => ({ ...row, successRate: row.count ? row.successes / row.count : null })), registrations,
    windowDays: 30, note: "Aggregate research analytics only. Stress types count each student's latest model estimate in the last 30 days. Feedback is descriptive and does not establish effectiveness. No clinical records or identities are returned." };
}
