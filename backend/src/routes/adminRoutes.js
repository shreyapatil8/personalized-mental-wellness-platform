import { Router } from "express";

import { getAdminOverview, listUsers, updateUserStatus, reviewCounsellor } from "../controllers/adminController.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth, allowRoles("admin"));

router.get("/overview", getAdminOverview);
router.get("/users", listUsers);
router.patch("/users/:id/status", updateUserStatus);
router.get("/counsellor-requests", listUsers);
router.patch("/counsellor-requests/:id", reviewCounsellor);

export default router;
