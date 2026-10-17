import mongoose from "mongoose";

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, select: false },
  role: { type: String, enum: ["student", "counsellor"], required: true },
  category: { type: String, enum: ["overall", "assistant", "tracking", "counselling"], required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  helpfulness: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, maxlength: 1000, default: "", select: false }
}, { timestamps: true });
schema.index({ user: 1, createdAt: -1 });
export default mongoose.model("Feedback", schema);
