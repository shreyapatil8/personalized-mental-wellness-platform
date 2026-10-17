import mongoose from "mongoose";

const schema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, trim: true, maxlength: 100, default: "New chat" }
}, { timestamps: true });

schema.index({ student: 1, updatedAt: -1 });
export default mongoose.model("ChatConversation", schema);
