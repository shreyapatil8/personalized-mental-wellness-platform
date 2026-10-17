import mongoose from "mongoose";

export const APPOINTMENT_STATUSES = ["pending", "approved", "completed", "cancelled"];
export const CONCERN_TYPES = ["academic_stress", "anxiety", "sleep", "relationships", "career", "general"];

const appointmentSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    counsellor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    scheduledFor: {
      type: Date,
      required: true,
      index: true
    },
    concernType: {
      type: String,
      enum: CONCERN_TYPES,
      required: true
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000
    },
    status: {
      type: String,
      enum: APPOINTMENT_STATUSES,
      default: "pending",
      index: true
    },
    shareSummary: {
      type: Boolean,
      default: false
    },
    counsellorNotes: {
      type: String,
      trim: true,
      select: false,
      maxlength: 1500
    },
    progressUpdate: { type: String, maxlength: 1500, default: "" },
    notesUpdatedAt: Date,
    generatedSummary: { type: mongoose.Schema.Types.Mixed, select: false }
  },
  { timestamps: true }
);

appointmentSchema.index({ counsellor: 1, scheduledFor: 1 }, { unique: true, partialFilterExpression: { status: { $in: ["pending", "approved"] } } });
appointmentSchema.index({ student: 1, scheduledFor: 1 }, { unique: true, partialFilterExpression: { status: { $in: ["pending", "approved"] } } });
appointmentSchema.index({ student: 1, scheduledFor: -1 });

export default mongoose.model("Appointment", appointmentSchema);
