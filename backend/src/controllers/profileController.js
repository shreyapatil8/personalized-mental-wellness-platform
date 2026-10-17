import { z } from "zod";

import CounsellorProfile from "../models/CounsellorProfile.js";
import StudentProfile from "../models/StudentProfile.js";
import { DEPARTMENTS, STUDENT_YEARS } from "../constants/studentOptions.js";
import { invalidateDerivedContext } from "../services/contextInvalidationService.js";
import { initialWellnessContract, initialWellnessSchema } from "../utils/initialWellnessAssessment.js";

export async function getInitialWellnessAssessment(req, res, next) {
  try {
    const profile = await StudentProfile.findOne({ user: req.user._id }).select("initialWellnessAssessment");
    return res.json({ contract: initialWellnessContract, assessment: profile?.initialWellnessAssessment || null });
  } catch (error) {
    return next(error);
  }
}

export async function saveInitialWellnessAssessment(req, res, next) {
  try {
    const data = initialWellnessSchema.parse(req.body);
    const now = new Date();
    // One atomic profile update keeps responses and completion metadata together.
    // The first completion date survives later edits, including concurrent saves.
    const profile = await StudentProfile.findOneAndUpdate(
      { user: req.user._id },
      [{ $set: {
        user: req.user._id,
        initialWellnessAssessment: {
          schemaVersion: { $literal: data.schemaVersion },
          responses: { $literal: data.responses },
          completedAt: { $ifNull: ["$initialWellnessAssessment.completedAt", now] },
          updatedAt: now
        }
      } }],
      { new: true, upsert: true }
    );
    await invalidateDerivedContext(req.user._id);
    return res.json({ assessment: profile.initialWellnessAssessment, message: "Your wellness assessment has been saved." });
  } catch (error) {
    return next(error);
  }
}

const studentProfileSchema = z.object({
  rollNumber: z.string().regex(/^\d{4}$/, "Roll number must be exactly 4 digits."),
  urn: z.string().regex(/^(\d{8}|\d{10})$/, "URN must be exactly 8 or 10 digits."),
  department: z.enum(DEPARTMENTS),
  year: z.enum(STUDENT_YEARS),
  age: z.coerce.number().min(16).max(30).optional(),
  gender: z.string().max(40).optional().or(z.literal("")),
  emergencyContact: z
    .object({
      name: z.string().max(80).optional().or(z.literal("")),
      phone: z.string().max(30).optional().or(z.literal("")),
      relation: z.string().max(50).optional().or(z.literal(""))
    })
    .optional(),
  wellnessGoals: z.array(z.string().max(120)).max(10).optional(),
  consentForCounsellorSummary: z.boolean().optional(),
  consentForAssistantJournalContext: z.boolean().optional()
}).partial();

const counsellorProfileSchema = z.object({
  qualification: z.string().max(120).optional().or(z.literal("")),
  specialization: z.array(z.string().max(80)).max(10).optional(),
  availabilityNote: z.string().max(500).optional().or(z.literal(""))
});

export async function getProfile(req, res, next) {
  try {
    let profile = null;

    if (req.user.role === "student") {
      profile = await StudentProfile.findOne({ user: req.user._id });
    }

    if (req.user.role === "counsellor") {
      profile = await CounsellorProfile.findOne({ user: req.user._id });
    }

    return res.json({ user: req.user.toSafeObject(), profile });
  } catch (error) {
    return next(error);
  }
}

export async function updateProfile(req, res, next) {
  try {
    if (req.user.role === "admin") {
      return res.status(400).json({ message: "Admin accounts do not have a wellness profile." });
    }

    if (req.user.role === "student") {
      const data = studentProfileSchema.parse(req.body);
      const profile = await StudentProfile.findOneAndUpdate(
        { user: req.user._id },
        { $set: data },
        { new: true, upsert: true, runValidators: true }
      );

      await invalidateDerivedContext(req.user._id);
      return res.json({ profile });
    }

    const data = counsellorProfileSchema.parse(req.body);
    const profile = await CounsellorProfile.findOneAndUpdate(
      { user: req.user._id },
      { $set: data },
      { new: true, upsert: true, runValidators: true }
    );

    return res.json({ profile });
  } catch (error) {
    return next(error);
  }
}
