import User from "../models/User.js";
import MoodLog from "../models/MoodLog.js";
import JournalEntry from "../models/JournalEntry.js";
import Assessment from "../models/Assessment.js";
import ConversationMessage from "../models/ConversationMessage.js";
import CounsellingMessage from "../models/CounsellingMessage.js";
import Appointment from "../models/Appointment.js";
import Feedback from "../models/Feedback.js";

const DAY = 86400000;
const timezone = "Asia/Kolkata";
const day = date => ({ $dateToString: { format: "%Y-%m-%d", date, timezone } });
const dateKey = date => new Date(new Date(date).getTime() + 330 * 60000).toISOString().slice(0, 10);

// Legacy active/previously signed-in counsellors already passed the activation gate.
// Inactive accounts without that evidence need review; no historical decision is invented.
export const counsellorReviewExpression = { $ifNull: ["$counsellorReviewStatus", {
  $cond: [{ $or: [{ $eq: ["$isActive", true] }, { $ne: [{ $ifNull: ["$lastLoginAt", null] }, null] }] }, "approved", "pending"]
}] };

const sources = [
  [MoodLog, "moodCheckIns", "createdAt", "student"],
  [JournalEntry, "journalEntries", "createdAt", "student"],
  [Assessment, "assessments", "createdAt", "student"],
  [ConversationMessage, "assistantMessages", "createdAt", "student", { role: "student" }],
  [CounsellingMessage, "counsellingMessages", "createdAt", "sender"],
  [Appointment, "appointmentsBooked", "createdAt", "student"],
  [Appointment, "completedSessions", "scheduledFor", "student", { status: "completed" }]
];
const emptyCounts = () => Object.fromEntries(sources.map(([, kind]) => [kind, 0]));
const periodMatch = (start, end, field = "at") => ({ $match: { [field]: { $gte: start, $lt: end } } });
const ratingGroup = { _id: null, responses: { $sum: 1 }, averageRating: { $avg: "$rating" }, averageHelpfulness: { $avg: "$helpfulness" } };
const ratingResult = rows => {
  const row = rows[0];
  return { responses: row?.responses || 0, averageRating: row?.averageRating ?? null, averageHelpfulness: row?.averageHelpfulness ?? null };
};

function countRows(rows) {
  const counts = emptyCounts();
  for (const row of rows) counts[row._id] = row.count;
  // Completed sessions are a status count by scheduled date, not an extra user action.
  return { ...counts, totalActivities: Object.entries(counts).reduce((sum, [key, count]) => sum + (key === "completedSessions" ? 0 : count), 0) };
}

export async function buildAdminOverview({ period = "weekly", now = new Date() } = {}) {
  const days = period === "monthly" ? 30 : 7;
  const start = new Date(now - days * DAY), previousStart = new Date(start - days * DAY);
  const sourcePipeline = ([, kind, field, student, match = {}]) => [
    { $match: { ...match, [field]: { $gte: previousStart, $lt: now } } },
    { $project: { _id: 0, at: "$" + field, student: "$" + student, kind: { $literal: kind } } }
  ];
  const activeStudents = (from, to) => [periodMatch(from, to), { $group: { _id: "$student" } },
    { $lookup: { from: User.collection.name, localField: "_id", foreignField: "_id", as: "account", pipeline: [{ $project: { role: 1 } }] } },
    { $match: { "account.role": "student" } }, { $count: "count" }];
  const totals = (from, to) => [periodMatch(from, to), { $group: { _id: "$kind", count: { $sum: 1 } } }];
  const [roles, events, registrations, ratings, allRatings] = await Promise.all([
    User.aggregate([{ $group: { _id: { role: "$role", active: "$isActive", review: counsellorReviewExpression }, count: { $sum: 1 } } }]),
    MoodLog.aggregate([...sourcePipeline(sources[0]),
      ...sources.slice(1).map(source => ({ $unionWith: { coll: source[0].collection.name, pipeline: sourcePipeline(source) } })),
      { $facet: { current: totals(start, now), previous: totals(previousStart, start),
        active: activeStudents(start, now), previousActive: activeStudents(previousStart, start),
        daily: [periodMatch(start, now), { $group: { _id: { day: day("$at"), kind: "$kind" }, count: { $sum: 1 } } }] } }
    ]),
    User.aggregate([periodMatch(previousStart, now, "createdAt"), { $facet: {
      current: [periodMatch(start, now, "createdAt"), { $count: "count" }],
      previous: [periodMatch(previousStart, start, "createdAt"), { $count: "count" }],
      daily: [periodMatch(start, now, "createdAt"), { $group: { _id: day("$createdAt"), count: { $sum: 1 } } }]
    } }]),
    Feedback.aggregate([periodMatch(previousStart, now, "createdAt"), { $facet: {
      current: [periodMatch(start, now, "createdAt"), { $group: ratingGroup }],
      previous: [periodMatch(previousStart, start, "createdAt"), { $group: ratingGroup }],
      daily: [periodMatch(start, now, "createdAt"), { $group: { ...ratingGroup, _id: day("$createdAt") } }]
    } }]),
    Feedback.aggregate([{ $match: { createdAt: { $lt: now } } }, { $group: ratingGroup }])
  ]);
  const summary = { totalStudents: 0, activeCounsellors: 0, pendingCounsellorRequests: 0, totalUsers: 0, satisfaction: ratingResult(allRatings) };
  for (const row of roles) {
    if (row._id.role === "student") {
      summary.totalStudents += row.count;
      summary.totalUsers += row.count;
    }
    if (row._id.role === "counsellor") summary.totalUsers += row.count;
    if (row._id.role === "counsellor" && row._id.active) summary.activeCounsellors += row.count;
    if (row._id.role === "counsellor" && row._id.review === "pending") summary.pendingCounsellorRequests += row.count;
  }
  const activity = events[0], users = registrations[0], feedback = ratings[0];
  const daily = [];
  // Missing bins mean zero retained records, never fabricated historical activity.
  const first = new Date(dateKey(start) + "T00:00:00Z");
  const last = dateKey(new Date(now - 1));
  for (let date = first; date.toISOString().slice(0, 10) <= last; date = new Date(+date + DAY)) {
    const key = date.toISOString().slice(0, 10);
    const counts = countRows(activity.daily.filter(row => row._id.day === key).map(row => ({ _id: row._id.kind, count: row.count })));
    daily.push({ date: key, ...counts, newUsers: users.daily.find(row => row._id === key)?.count || 0,
      satisfaction: ratingResult(feedback.daily.filter(row => row._id === key)) });
  }
  return { summary, report: { period, days, timezone, start, end: now, previousStart,
    current: { ...countRows(activity.current), activeStudents: activity.active[0]?.count || 0, newUsers: users.current[0]?.count || 0, satisfaction: ratingResult(feedback.current) },
    previous: { ...countRows(activity.previous), activeStudents: activity.previousActive[0]?.count || 0, newUsers: users.previous[0]?.count || 0, satisfaction: ratingResult(feedback.previous) },
    daily } };
}
