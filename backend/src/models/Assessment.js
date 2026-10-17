import mongoose from "mongoose";

const assessmentSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ["WHO5"],
      default: "WHO5"
    },
    responses: {
      type: [Number],
      required: true,
      validate: {
        validator: (responses) =>
          Array.isArray(responses) && responses.length === 5 && responses.every((value) => value >= 0 && value <= 5),
        message: "WHO-5 assessments require five responses from 0 to 5."
      }
    },
    rawScore: {
      type: Number,
      required: true,
      min: 0,
      max: 25
    },
    percentageScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    riskLevel: {
      type: String,
      enum: ["low", "moderate", "high"],
      required: true
    },
    takenAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true
    }
  },
  { timestamps: true }
);

assessmentSchema.index({ student: 1, takenAt: -1 });

export default mongoose.model("Assessment", assessmentSchema);
