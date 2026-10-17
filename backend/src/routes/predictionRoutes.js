import { Router } from "express";

import {
  createMyPrediction,
  getMyLatestPrediction,
  getMyPredictionFeatures,
  getStressSurvey,
  saveStressSurvey
} from "../controllers/predictionController.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth, allowRoles("student"));

router.get("/me", getMyLatestPrediction);
router.post("/me", createMyPrediction);
router.get("/me/features", getMyPredictionFeatures);
router.get("/survey", getStressSurvey);
router.post("/survey", saveStressSurvey);

export default router;
