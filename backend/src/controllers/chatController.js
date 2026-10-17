import { z } from "zod";

import ConversationMessage from "../models/ConversationMessage.js";
import ChatConversation from "../models/ChatConversation.js";
import { sendAssistantMessage } from "../services/assistantService.js";

const chatMessageSchema = z.object({
  message: z.string().trim().min(1).max(1200),
  conversationId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  clientMessageId: z.string().uuid().optional()
});

const titleSchema = z.object({ title: z.string().trim().min(1).max(100) });

export async function listConversations(req, res, next) {
  try {
    const conversations = await ChatConversation.find({ student: req.user._id }).sort({ updatedAt: -1, _id: -1 }).limit(50).lean();
    return res.json({ conversations });
  } catch (error) { return next(error); }
}

export async function createConversation(req, res, next) {
  try {
    const conversation = await ChatConversation.create({ student: req.user._id, title: "New chat" });
    return res.status(201).json({ conversation });
  } catch (error) { return next(error); }
}

export async function getConversation(req, res, next) {
  try {
    const conversation = await ChatConversation.findOne({ _id: req.params.id, student: req.user._id });
    if (!conversation) return res.status(404).json({ message: "Conversation not found." });
    const limit = Math.min(Number(req.query.limit) || 100, 100);
    const messages = await ConversationMessage.find({ student: req.user._id, conversation: conversation._id })
      .sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
    return res.json({ conversation, messages: messages.reverse() });
  } catch (error) { return next(error); }
}

export async function renameConversation(req, res, next) {
  try {
    const { title } = titleSchema.parse(req.body);
    const conversation = await ChatConversation.findOneAndUpdate({ _id: req.params.id, student: req.user._id }, { title }, { new: true, runValidators: true });
    if (!conversation) return res.status(404).json({ message: "Conversation not found." });
    return res.json({ conversation });
  } catch (error) { return next(error); }
}

export async function deleteConversation(req, res, next) {
  try {
    const conversation = await ChatConversation.findOneAndDelete({ _id: req.params.id, student: req.user._id });
    if (!conversation) return res.status(404).json({ message: "Conversation not found." });
    await ConversationMessage.deleteMany({ student: req.user._id, conversation: conversation._id });
    return res.status(204).end();
  } catch (error) { return next(error); }
}

export async function listMyMessages(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const messages = await ConversationMessage.find({ student: req.user._id }).sort({ createdAt: -1, _id: -1 }).limit(limit);

    return res.json({ messages: messages.reverse() });
  } catch (error) {
    return next(error);
  }
}

export async function createAssistantReply(req, res, next) {
  try {
    const data = chatMessageSchema.parse(req.body);
    let conversationId = data.conversationId;
    if (conversationId) {
      const owned = await ChatConversation.findOne({ _id: conversationId, student: req.user._id }).select("_id title");
      if (!owned) return res.status(404).json({ message: "Conversation not found." });
    } else {
      const latest = await ChatConversation.findOne({ student: req.user._id }).sort({ updatedAt: -1, _id: -1 }).select("_id");
      conversationId = String(latest?._id || (await ChatConversation.create({ student: req.user._id, title: "New chat" }))._id);
    }
    const conversation = await ChatConversation.findOne({ _id: conversationId, student: req.user._id });
    const priorStudentMessages = await ConversationMessage.countDocuments({ student: req.user._id, conversation: conversationId, role: "student" });
    if (conversation) {
      conversation.updatedAt = new Date();
      if (priorStudentMessages === 0 && conversation.title === "New chat") conversation.title = data.message.replace(/\s+/g, " ").slice(0, 48).trim() || "New chat";
      await conversation.save();
    }
    const result = await sendAssistantMessage({
      user: req.user,
      message: data.message,
      conversation: conversationId,
      clientMessageId: data.clientMessageId
    });
    await conversation?.updateOne({ $set: { updatedAt: new Date() } });
    if (conversation) conversation.updatedAt = new Date();

    return res.status(201).json({
      studentMessage: result.studentMessage,
      assistantMessage: result.assistantMessage,
      conversation,
      context: { usedSources: [...new Set((result.context?.selectedItems || []).map((item) => item.sourceType))] }
    });
  } catch (error) {
    return next(error);
  }
}
