import { Router } from "express";

import { getProfile, updateProfile, getInitialWellnessAssessment, saveInitialWellnessAssessment } from "../controllers/profileController.js";
import { requireAuth, allowRoles } from "../middleware/auth.js";

const router = Router();

router.get("/me", requireAuth, getProfile);
router.put("/me", requireAuth, updateProfile);
router.get("/me/initial-assessment", requireAuth, allowRoles("student"), getInitialWellnessAssessment);
router.put("/me/initial-assessment", requireAuth, allowRoles("student"), saveInitialWellnessAssessment);

export default router;
