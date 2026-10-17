import { Router } from "express";

import { createAssistantReply, listMyMessages, listConversations, createConversation, getConversation, renameConversation, deleteConversation } from "../controllers/chatController.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth, allowRoles("student"));

router.get("/messages", listMyMessages);
router.post("/messages", createAssistantReply);
router.get("/conversations", listConversations);
router.post("/conversations", createConversation);
router.get("/conversations/:id", getConversation);
router.patch("/conversations/:id", renameConversation);
router.delete("/conversations/:id", deleteConversation);

export default router;
