import mongoose from "mongoose";

const schema = new mongoose.Schema({
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  clientMessageId: { type: String, required: true },
  content: { type: String, required: true, trim: true, maxlength: 2000 }
}, { timestamps: true });

// The same attempted send can safely arrive through a retry or another transport.
schema.index({ appointment: 1, sender: 1, clientMessageId: 1 }, { unique: true });
schema.index({ appointment: 1, _id: -1 });

export default mongoose.model("CounsellingMessage", schema);
