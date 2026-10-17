import mongoose from "mongoose";

const counsellorProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true
    },
    qualification: {
      type: String,
      trim: true
    },
    specialization: {
      type: [String],
      default: []
    },
    availabilityNote: {
      type: String,
      trim: true,
      maxlength: 500
    }
  },
  { timestamps: true }
);

export default mongoose.model("CounsellorProfile", counsellorProfileSchema);
