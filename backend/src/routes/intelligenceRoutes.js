import { Router } from "express";

import {
  createMyWellnessContext,
  getMyLatestWellnessContext
} from "../controllers/intelligenceController.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth, allowRoles("student"));

router.get("/context/me", getMyLatestWellnessContext);
router.post("/context/me", createMyWellnessContext);

export default router;
