import mongoose from "mongoose";

const schema = new mongoose.Schema({
  route: String, method: String, status: Number, durationMs: Number,
  recordedAt: { type: Date, default: Date.now, expires: 30 * 86400 }
});
schema.index({ recordedAt: -1 });
export default mongoose.model("RequestMetric", schema);
