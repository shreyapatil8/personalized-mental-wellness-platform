import mongoose from "mongoose";

const conversationMessageSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "ChatConversation", index: true },
    clientMessageId: { type: String, maxlength: 64 },
    role: {
      type: String,
      enum: ["student", "assistant"],
      required: true
    },
    responseSource: { type: String, enum: ["ollama", "safety_message"] },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "ConversationMessage" },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000
    }
  },
  { timestamps: true }
);

conversationMessageSchema.index({ student: 1, createdAt: -1 });
conversationMessageSchema.index({ student: 1, conversation: 1, createdAt: -1, _id: -1 });
conversationMessageSchema.index({ student: 1, clientMessageId: 1 }, { unique: true, partialFilterExpression: { clientMessageId: { $type: "string" } } });

export default mongoose.model("ConversationMessage", conversationMessageSchema);
