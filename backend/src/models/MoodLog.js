import mongoose from "mongoose";

const moodLogSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    mood: {
      type: String,
      enum: ["very_low", "low", "neutral", "good", "great"],
      required: true
    },
    moodScore: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    stressLevel: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    sleepHours: {
      type: Number,
      min: 0,
      max: 16
    },
    note: {
      type: String,
      trim: true,
      maxlength: 500
    },
    loggedFor: {
      type: Date,
      required: true,
      default: Date.now,
      index: true
    }
  },
  { timestamps: true }
);

moodLogSchema.index({ student: 1, loggedFor: -1 });

export default mongoose.model("MoodLog", moodLogSchema);
