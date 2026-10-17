import mongoose from "mongoose";

const schema = new mongoose.Schema({
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true, maxlength: 120 },
  publicId: { type: String, required: true, select: false },
  bytes: { type: Number, required: true }
}, { timestamps: true });
export default mongoose.model("SharedDocument", schema);
