import Assessment from "../models/Assessment.js";
import JournalEntry from "../models/JournalEntry.js";
import MoodLog from "../models/MoodLog.js";
import StudentProfile from "../models/StudentProfile.js";
import User from "../models/User.js";
import { getCurrentStressPrediction } from "./stressPredictionService.js";
import Appointment from "../models/Appointment.js";
import { getCounsellingBriefingProvider } from "./counsellingBriefingProvider.js";
import { buildInitialAssessmentOverview, prepareCounsellingSummary, summaryInstructions } from "../utils/counsellingSummary.js";
import { calculateWho5Score, summarizeMoodTrend, who5Questions } from "../utils/wellnessScoring.js";

function isValidWho5(record) {
  if (!record || record.type !== "WHO5" || !Array.isArray(record.responses) || record.responses.length !== 5) return false;
  const takenAt = new Date(record.takenAt).getTime();
  if (!Number.isFinite(takenAt) || takenAt > Date.now()) return false;
  try {
    const score = calculateWho5Score(record.responses);
    return record.rawScore === score.rawScore && record.percentageScore === score.percentageScore && record.riskLevel === score.riskLevel;
  } catch { return false; }
}

function validMoodRows(rows, selectedIds) {
  const seen = new Set();
  return rows.filter(row => {
    if (!selectedIds.has(String(row._id))) return false;
    const time = new Date(row.loggedFor).getTime();
    if (!Number.isFinite(time) || time > Date.now() || !Number.isInteger(row.moodScore) || row.moodScore < 1 || row.moodScore > 5 ||
      !Number.isInteger(row.stressLevel) || row.stressLevel < 1 || row.stressLevel > 5) return false;
    const key = String(row._id || `${time}:${row.moodScore}:${row.stressLevel}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const withheld = (message = "Summary access requires an active appointment and both student sharing permissions. Sharing or appointment access may have changed.") => ({ consentGranted: false, message });
function summaryError(message, statusCode) { return Object.assign(new Error(message), { statusCode }); }

async function readAuthorizedState(appointment) {
  const student = appointment.student._id || appointment.student;
  const counsellor = appointment.counsellor._id || appointment.counsellor;
  const [current, profile, activeCounsellor] = await Promise.all([
    Appointment.findOne({ _id: appointment._id, student, counsellor,
      status: { $in: ["pending", "approved"] } }).select("+generatedSummary"),
    StudentProfile.findOne({ user: student }).select("user consentForCounsellorSummary"),
    User.exists({ _id: counsellor, role: "counsellor", isActive: true })
  ]);
  if (!current || !activeCounsellor) return null;
  if (!current.shareSummary && !profile?.consentForCounsellorSummary) {
    return withheld("The student has not enabled either sharing permission. Ask them to enable both “Counsellor summary consent” in Profile and “Allow summary sharing” for this appointment, then refresh.");
  }
  if (!current.shareSummary) {
    return withheld("“Allow summary sharing” is off for this appointment. Ask the student to enable it, then refresh.");
  }
  if (!profile?.consentForCounsellorSummary) {
    return withheld("“Counsellor summary consent” is off in the student’s Profile. Ask them to enable it, then refresh.");
  }
  const [assessmentRows, moodLogs, journalEntries, latestPrediction] = await Promise.all([
    Assessment.find({ student }).sort({ takenAt: -1, _id: -1 }).limit(5),
    MoodLog.find({ student }).sort({ loggedFor: -1, _id: -1 }).limit(14),
    JournalEntry.find({ student }).sort({ createdAt: -1, _id: -1 }).limit(5),
    getCurrentStressPrediction(student)
  ]);
  const assessments = assessmentRows.filter(isValidWho5);
  const records = { profile, assessments, moodLogs, journalEntries, latestPrediction };
  return { ...records, appointment: current, prepared: prepareCounsellingSummary(records, current) };
}

export async function buildCounsellingSummary({ appointment, generate = false }) {
  let state = await readAuthorizedState(appointment);
  if (!state?.prepared) return state || withheld();
  const provider = getCounsellingBriefingProvider();
  const providerStatus = state.prepared.sourceCount ? await provider.availability() : {
    available: false, message: "Refresh the shared overview before generating a briefing."
  };
  // A local availability probe can take time; recheck sharing before using records.
  state = await readAuthorizedState(appointment);
  if (!state?.prepared) return state || withheld();
  if (generate) {
    if (!state.prepared.sourceCount) throw summaryError("There are no relevant shared wellness records yet. The factual overview remains available.", 422);
    if (!providerStatus.available) throw summaryError(providerStatus.message, 503);
    let text;
    try {
      text = await provider.generate({ prompt: state.prepared.prompt, instructions: summaryInstructions });
      if (!text) throw new Error("Empty AI response");
    } catch {
      throw summaryError("The AI briefing could not be generated. Please try again. The factual overview remains available.", 503);
    }
    // Re-read the same student's current authorized evidence after the provider call.
    const current = await readAuthorizedState(appointment);
    if (!current?.prepared) return current || withheld();
    if (current.prepared.digest !== state.prepared.digest) {
      throw summaryError("Shared wellness information changed while the briefing was being generated. Refresh and generate it again.", 409);
    }
    const narrative = { text, source: provider.name, generatedAt: new Date(), digest: current.prepared.digest };
    const saved = await Appointment.updateOne({ _id: current.appointment._id, student: current.profile.user,
      counsellor: current.appointment.counsellor, shareSummary: true, updatedAt: current.appointment.updatedAt,
      status: { $in: ["pending", "approved"] } }, { $set: { generatedSummary: narrative } });
    if (!saved.matchedCount) return withheld();
    state = await readAuthorizedState(appointment);
    if (!state?.prepared || state.prepared.digest !== narrative.digest) {
      await Appointment.updateOne({ _id: appointment._id, "generatedSummary.digest": narrative.digest }, { $unset: { generatedSummary: 1 } });
      if (!state?.prepared) return state || withheld();
      throw summaryError("Shared wellness information changed. Refresh and generate the briefing again.", 409);
    }
  }

  const { profile, assessments, moodLogs, latestPrediction, prepared } = state;
  const selectedIds = type => new Set(prepared.selectedItems.filter(item => item.sourceType === type).map(item => String(item.sourceId)));
  const selectedAssessment = assessments.find(item => selectedIds("assessment").has(String(item._id)));
  const selectedMoodIds = new Set(prepared.selectedItems.filter(item => ["mood", "mood_pattern"].includes(item.sourceType))
    .flatMap(item => item.sourceIds || [item.sourceId]).map(String));
  const validMood = validMoodRows(moodLogs, selectedMoodIds);
  const moodPattern = prepared.selectedItems.find(item => item.sourceType === "mood_pattern")?.content || null;
  const cached = state.appointment.generatedSummary;
  const narrative = cached?.source === "ollama" && cached.source === provider.name && typeof cached.text === "string" && cached.text.trim() &&
    cached.digest === prepared.digest && cached.generatedAt && new Date(cached.generatedAt) <= new Date() ? cached : null;
  const availability = !prepared.sourceCount ? "insufficient_data" : !providerStatus.available ? "provider_unavailable" : "ready";
  const who5 = selectedAssessment ? {
    type: selectedAssessment.type || "WHO5", responses: selectedAssessment.responses,
    rawScore: selectedAssessment.rawScore, percentageScore: selectedAssessment.percentageScore,
    resultBand: selectedAssessment.riskLevel, takenAt: selectedAssessment.takenAt,
    answers: selectedAssessment.responses.map((response, index) => ({ question: who5Questions[index], response }))
  } : null;
  return {
    consentGranted: true,
    aiSummary: { availability, canGenerate: availability === "ready", stale: Boolean(cached && !narrative),
      message: availability === "insufficient_data" ? "No relevant shared records are available for an AI briefing yet."
        : availability === "provider_unavailable" ? providerStatus.message : "AI generation uses selected shared records. Review the draft against the factual overview." },
    initialAssessment: buildInitialAssessmentOverview(profile.initialWellnessAssessment),
    assessmentNote: prepared.selectedItems.find(item => item.title === "Initial assessment notes (student-provided excerpt)")?.content || null,
    appointmentConcern: { type: state.appointment.concernType || null, note: state.appointment.notes || "" },
    profile: prepared.selectedItems.find(item => item.sourceType === "profile")?.sharedProfile || { department: "", year: "", wellnessGoals: [] },
    student: { name: state.appointment.student?.name || "Student" },
    generatedAt: narrative?.generatedAt || null,
    coverage: prepared.coverage,
    dataSources: prepared.coverage.sources,
    mood: { ...summarizeMoodTrend(validMood), pattern: moodPattern },
    latestAssessment: who5,
    journalSignals: prepared.selectedItems.filter(item => item.sourceType === "journal")
      .map(item => ({ themes: item.themes, createdAt: item.timestamp })),
    latestPrediction: latestPrediction && selectedIds("prediction").has(String(latestPrediction._id)) &&
      ["Eustress", "Distress", "eustress", "distress"].includes(latestPrediction.riskCategory) ? {
        label: latestPrediction.riskCategory, createdAt: latestPrediction.createdAt
      } : null,
    narrative: narrative ? { text: narrative.text, source: narrative.source, generatedAt: narrative.generatedAt,
      validation: "unverified" } : null,
    sourceCount: prepared.sourceCount
  };
}
