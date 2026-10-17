import mongoose from "mongoose";

const journalEntrySchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    title: {
      type: String,
      trim: true,
      maxlength: 120
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000
    },
    tags: {
      type: [String],
      default: []
    },
    sentiment: {
      type: String,
      enum: ["negative", "mixed", "positive", "unrated"],
      default: "unrated"
    }
  },
  { timestamps: true }
);

journalEntrySchema.index({ student: 1, createdAt: -1 });

export default mongoose.model("JournalEntry", journalEntrySchema);
