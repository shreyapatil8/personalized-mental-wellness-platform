import { Router } from "express";

import { getMyDashboard } from "../controllers/dashboardController.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth, allowRoles("student"));

router.get("/me", getMyDashboard);

export default router;
