import mongoose from "mongoose";

const schema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  schemaVersion: { type: String, required: true },
  answers: { type: Map, of: Number, required: true }
}, { timestamps: true });
schema.index({ student: 1, createdAt: -1 });
export default mongoose.model("StressSurvey", schema);
