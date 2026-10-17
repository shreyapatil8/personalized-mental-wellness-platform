import { Router } from "express";

import {
  createAssessment,
  createJournalEntry,
  createMoodLog,
  deleteJournalEntry,
  deleteMoodLog,
  getAssessmentQuestions,
  getTrackingSummary,
  listAssessments,
  listJournalEntries,
  listMoodLogs,
  updateJournalEntry,
  updateMoodLog
} from "../controllers/trackingController.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth, allowRoles("student"));

router.get("/summary", getTrackingSummary);
router.get("/assessment/questions", getAssessmentQuestions);
router.get("/assessments", listAssessments);
router.post("/assessments", createAssessment);
router.get("/moods", listMoodLogs);
router.post("/moods", createMoodLog);
router.put("/moods/:id", updateMoodLog);
router.delete("/moods/:id", deleteMoodLog);
router.get("/journals", listJournalEntries);
router.post("/journals", createJournalEntry);
router.put("/journals/:id", updateJournalEntry);
router.delete("/journals/:id", deleteJournalEntry);

export default router;
