import mongoose from "mongoose";

const wellnessPredictionSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    riskCategory: {
      type: String,
      enum: ["low", "medium", "high", "eustress", "distress"],
      required: true
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1
    },
    modelSource: {
      type: String,
      enum: ["trained_model", "fallback_rules"],
      required: true
    },
    survey: { type: mongoose.Schema.Types.ObjectId, ref: "StressSurvey" },
    surveyAnswers: { type: Map, of: Number },
    modelName: String,
    modelSha256: String,
    predictionKey: String,
    schemaVersion: String,
    datasetSha256: String,
    features: {
      latestWho5Score: Number,
      assessmentRiskScore: Number,
      averageMoodScore: Number,
      averageStressLevel: Number,
      averageSleepHours: Number,
      moodVolatility: Number,
      journalNegativeRatio: Number,
      journalEntryCount: Number,
      moodEntryCount: Number,
      assessmentCount: Number
    },
    reasons: {
      type: [String],
      default: []
    }
  },
  { timestamps: true }
);

wellnessPredictionSchema.index({ student: 1, createdAt: -1 });
wellnessPredictionSchema.index({ student: 1, predictionKey: 1 }, {
  unique: true, partialFilterExpression: { predictionKey: { $type: "string" } }
});

export default mongoose.model("WellnessPrediction", wellnessPredictionSchema);
