import { Router } from "express";

import {
  createAppointment,
  getAppointmentSummary,
  listCounsellors,
  listMyAppointments,
  updateAppointmentStatus,
  updateSessionNotes,
  updateSummaryConsent
} from "../controllers/counsellingController.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import { getCounsellingChat, postCounsellingMessage } from "../controllers/counsellingChatController.js";

const router = Router();

router.use(requireAuth);
router.get("/appointments/:id/chat", allowRoles("student", "counsellor"), getCounsellingChat);
router.post("/appointments/:id/chat/messages", allowRoles("student", "counsellor"), postCounsellingMessage);

router.get("/counsellors", allowRoles("student"), listCounsellors);
router.get("/appointments", allowRoles("student", "counsellor"), listMyAppointments);
router.post("/appointments", allowRoles("student"), createAppointment);
router.patch("/appointments/:id/status", allowRoles("student", "counsellor"), updateAppointmentStatus);
router.get("/appointments/:id/summary", allowRoles("counsellor"), getAppointmentSummary);
router.post("/appointments/:id/summary", allowRoles("counsellor"), getAppointmentSummary);
router.patch("/appointments/:id/notes", allowRoles("counsellor"), updateSessionNotes);
router.patch("/appointments/:id/sharing", allowRoles("student"), updateSummaryConsent);

export default router;
