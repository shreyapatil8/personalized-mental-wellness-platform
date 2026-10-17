import mongoose from "mongoose";

import { DEPARTMENTS, STUDENT_YEARS } from "../constants/studentOptions.js";
import { initialWellnessContract } from "../utils/initialWellnessAssessment.js";

const initialWellnessSchema = new mongoose.Schema({
  schemaVersion: { type: String, enum: [initialWellnessContract.version], required: true },
  responses: {
    type: new mongoose.Schema(Object.fromEntries(initialWellnessContract.questions.map((question) => [
      question.id,
      question.optional
        ? { type: String, maxlength: question.maxLength, default: "" }
        : { type: String, enum: question.options, required: true }
    ])), { _id: false }),
    required: true
  },
  completedAt: { type: Date, required: true },
  updatedAt: { type: Date, required: true }
}, { _id: false });

const studentProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true
    },
    rollNumber: {
      type: String,
      trim: true,
      match: [/^\d{4}$/, "Roll number must be exactly 4 digits."]
    },
    urn: {
      type: String,
      trim: true,
      match: [/^(\d{8}|\d{10})$/, "URN must be exactly 8 or 10 digits."]
    },
    department: {
      type: String,
      trim: true,
      enum: DEPARTMENTS
    },
    year: {
      type: String,
      trim: true,
      enum: STUDENT_YEARS
    },
    age: {
      type: Number,
      min: 16,
      max: 30
    },
    gender: {
      type: String,
      trim: true
    },
    emergencyContact: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      relation: { type: String, trim: true }
    },
    wellnessGoals: {
      type: [String],
      default: []
    },
    initialWellnessAssessment: { type: initialWellnessSchema, default: undefined },
    consentForCounsellorSummary: {
      type: Boolean,
      default: false
    },
    consentForAssistantJournalContext: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model("StudentProfile", studentProfileSchema);
