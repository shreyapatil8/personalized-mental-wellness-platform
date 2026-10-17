import { z } from "zod";
import { invalidateDerivedContext } from "../services/contextInvalidationService.js";

import Assessment from "../models/Assessment.js";
import JournalEntry from "../models/JournalEntry.js";
import MoodLog from "../models/MoodLog.js";
import { calculateWho5Score, moodScoreByLabel, summarizeMoodTrend, who5Questions } from "../utils/wellnessScoring.js";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id.");
// Accept numeric form values without coercing blanks, nulls or booleans to scores.
const numericInput = z.union([z.number(), z.string().trim().min(1)]);
const listLimitSchema = z.string().regex(/^\d+$/).pipe(z.coerce.number().int().positive().safe());
const listLimit = (value, fallback, maximum) => value === undefined
  ? fallback : Math.min(listLimitSchema.parse(value), maximum);

const moodLogSchema = z.object({
  mood: z.enum(["very_low", "low", "neutral", "good", "great"]),
  stressLevel: numericInput.pipe(z.coerce.number().int().min(1).max(5)),
  sleepHours: numericInput.pipe(z.coerce.number().min(0).max(16)).optional(),
  note: z.string().max(500).optional().or(z.literal("")),
  loggedFor: z.coerce.date().optional()
});

const journalSchema = z.object({
  title: z.string().max(120).optional().or(z.literal("")),
  content: z.string().trim().min(1).max(4000),
  tags: z.array(z.string().max(40)).max(8).optional(),
  sentiment: z.enum(["negative", "mixed", "positive", "unrated"]).default("unrated")
});

const assessmentSchema = z.object({
  responses: z.array(numericInput.pipe(z.coerce.number().int().min(0).max(5))).length(5)
});

export function getAssessmentQuestions(req, res) {
  return res.json({
    type: "WHO5",
    scale: [
      "At no time",
      "Some of the time",
      "Less than half of the time",
      "More than half of the time",
      "Most of the time",
      "All of the time"
    ],
    questions: who5Questions
  });
}

export async function createMoodLog(req, res, next) {
  try {
    const data = moodLogSchema.parse(req.body);
    const moodLog = await MoodLog.create({
      ...data,
      student: req.user._id,
      moodScore: moodScoreByLabel[data.mood],
      loggedFor: data.loggedFor || new Date()
    });

    return res.status(201).json({ moodLog });
  } catch (error) {
    return next(error);
  }
}

export async function listMoodLogs(req, res, next) {
  try {
    const limit = listLimit(req.query.limit, 30, 90);
    const moodLogs = await MoodLog.find({ student: req.user._id }).sort({ loggedFor: -1 }).limit(limit);

    return res.json({ moodLogs });
  } catch (error) {
    return next(error);
  }
}

export async function updateMoodLog(req, res, next) {
  try {
    const id = objectIdSchema.parse(req.params.id);
    const data = moodLogSchema.partial().parse(req.body);
    const update = { ...data };

    if (data.mood) {
      update.moodScore = moodScoreByLabel[data.mood];
    }

    const moodLog = await MoodLog.findOneAndUpdate(
      { _id: id, student: req.user._id },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!moodLog) {
      return res.status(404).json({ message: "Mood log not found." });
    }

    await invalidateDerivedContext(req.user._id, id);
    return res.json({ moodLog });
  } catch (error) {
    return next(error);
  }
}

export async function deleteMoodLog(req, res, next) {
  try {
    const id = objectIdSchema.parse(req.params.id);
    const moodLog = await MoodLog.findOneAndDelete({ _id: id, student: req.user._id });

    if (!moodLog) {
      return res.status(404).json({ message: "Mood log not found." });
    }

    await invalidateDerivedContext(req.user._id, id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
}

export async function createJournalEntry(req, res, next) {
  try {
    const data = journalSchema.parse(req.body);
    const journalEntry = await JournalEntry.create({ ...data, student: req.user._id });

    return res.status(201).json({ journalEntry });
  } catch (error) {
    return next(error);
  }
}

export async function listJournalEntries(req, res, next) {
  try {
    const limit = listLimit(req.query.limit, 30, 90);
    const journalEntries = await JournalEntry.find({ student: req.user._id }).sort({ createdAt: -1 }).limit(limit);

    return res.json({ journalEntries });
  } catch (error) {
    return next(error);
  }
}

export async function updateJournalEntry(req, res, next) {
  try {
    const id = objectIdSchema.parse(req.params.id);
    const data = journalSchema.partial().parse(req.body);
    const journalEntry = await JournalEntry.findOneAndUpdate(
      { _id: id, student: req.user._id },
      { $set: data },
      { new: true, runValidators: true }
    );

    if (!journalEntry) {
      return res.status(404).json({ message: "Journal entry not found." });
    }

    await invalidateDerivedContext(req.user._id, id);
    return res.json({ journalEntry });
  } catch (error) {
    return next(error);
  }
}

export async function deleteJournalEntry(req, res, next) {
  try {
    const id = objectIdSchema.parse(req.params.id);
    const journalEntry = await JournalEntry.findOneAndDelete({ _id: id, student: req.user._id });

    if (!journalEntry) {
      return res.status(404).json({ message: "Journal entry not found." });
    }

    await invalidateDerivedContext(req.user._id, id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
}

export async function createAssessment(req, res, next) {
  try {
    const data = assessmentSchema.parse(req.body);
    const score = calculateWho5Score(data.responses);
    const assessment = await Assessment.create({
      student: req.user._id,
      responses: data.responses,
      ...score
    });

    return res.status(201).json({ assessment });
  } catch (error) {
    return next(error);
  }
}

export async function listAssessments(req, res, next) {
  try {
    const limit = listLimit(req.query.limit, 15, 60);
    const assessments = await Assessment.find({ student: req.user._id }).sort({ takenAt: -1 }).limit(limit);

    return res.json({ assessments });
  } catch (error) {
    return next(error);
  }
}

export async function getTrackingSummary(req, res, next) {
  try {
    const [moodLogs, latestAssessment, journalsCount] = await Promise.all([
      MoodLog.find({ student: req.user._id }).sort({ loggedFor: -1 }).limit(14),
      Assessment.findOne({ student: req.user._id }).sort({ takenAt: -1 }),
      JournalEntry.countDocuments({ student: req.user._id })
    ]);

    return res.json({
      mood: summarizeMoodTrend(moodLogs),
      latestAssessment,
      journalsCount
    });
  } catch (error) {
    return next(error);
  }
}
