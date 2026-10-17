import { Server } from "socket.io";
import jwt from "jsonwebtoken";

import User from "./models/User.js";
import ChatConversation from "./models/ChatConversation.js";
import ConversationMessage from "./models/ConversationMessage.js";
import { sendAssistantMessage } from "./services/assistantService.js";
import { configureCounsellingSockets } from "./services/counsellingSocketService.js";

export function configureSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error("Authentication token is required."));
      }

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(payload.sub);

      if (!user || !user.isActive || !["student", "counsellor"].includes(user.role)) {
        return next(new Error("Only active student and counsellor accounts can connect."));
      }

      socket.user = user;
      return next();
    } catch (error) {
      return next(new Error("Invalid chat session."));
    }
  });

  io.on("connection", (socket) => {
    configureCounsellingSockets(io, socket);
    socket.on("chat:send", async (payload, callback) => {
      try {
        jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET);
        const currentUser = await User.findById(socket.user._id);
        if (!currentUser?.isActive || currentUser.role !== "student") throw new Error("This chat session is no longer available.");
        const message = String(payload?.message || "").trim();
        if (!message || message.length > 1200) {
          throw new Error("Message must be between 1 and 1200 characters.");
        }
        const clientMessageId = typeof payload?.clientMessageId === "string" && /^[0-9a-f-]{36}$/i.test(payload.clientMessageId) ? payload.clientMessageId : undefined;
        let conversationId = payload?.conversationId;
        if (conversationId) {
          const owned = await ChatConversation.findOne({ _id: conversationId, student: currentUser._id }).select("_id");
          if (!owned) throw new Error("Conversation not found.");
        } else {
          const latest = await ChatConversation.findOne({ student: currentUser._id }).sort({ updatedAt: -1, _id: -1 }).select("_id");
          conversationId = String(latest?._id || (await ChatConversation.create({ student: currentUser._id, title: "New chat" }))._id);
        }
        const conversation = await ChatConversation.findOne({ _id: conversationId, student: currentUser._id });
        const priorMessages = await ConversationMessage.countDocuments({ student: currentUser._id, conversation: conversationId, role: "student" });
        if (conversation) {
          conversation.updatedAt = new Date();
          if (!priorMessages && conversation.title === "New chat") conversation.title = message.replace(/\s+/g, " ").slice(0, 48) || "New chat";
          await conversation.save();
        }

        const result = await sendAssistantMessage({
          user: currentUser,
          message,
          conversation: conversationId,
          clientMessageId
        });
        await conversation?.updateOne({ $set: { updatedAt: new Date() } });
        if (conversation) conversation.updatedAt = new Date();

        socket.emit("chat:reply", {
          studentMessage: result.studentMessage,
          assistantMessage: result.assistantMessage,
          context: { usedSources: [...new Set((result.context?.selectedItems || []).map((item) => item.sourceType))] }
        });

        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error.message });
        socket.emit("chat:error", { message: error.message });
      }
    });
  });

  return io;
}
