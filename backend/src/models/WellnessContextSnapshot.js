import mongoose from "mongoose";

const contextItemSchema = new mongoose.Schema(
  {
    sourceType: String,
    sourceId: String,
    sourceIds: { type: [String], default: undefined },
    selectionReason: String,
    title: String,
    content: String,
    timestamp: Date,
    priority: Number,
    recencyScore: Number,
    relevanceScore: Number,
    totalScore: Number,
    estimatedTokens: Number
  },
  { _id: false }
);

const wellnessContextSnapshotSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    userMessage: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1200
    },
    tokenBudget: {
      type: Number,
      required: true,
      min: 400,
      max: 3000
    },
    selectedItems: {
      type: [contextItemSchema],
      default: []
    },
    candidateCount: {
      type: Number,
      default: 0
    },
    estimatedTokens: {
      type: Number,
      default: 0
    },
    structuredPrompt: {
      type: String,
      required: true,
      maxlength: 12000
    }
  },
  { timestamps: true }
);

wellnessContextSnapshotSchema.index({ student: 1, createdAt: -1 });

export default mongoose.model("WellnessContextSnapshot", wellnessContextSnapshotSchema);
