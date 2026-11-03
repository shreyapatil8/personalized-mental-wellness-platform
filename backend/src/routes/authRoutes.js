import { Router } from "express";

import { forgotPassword, login, me, register, resetPassword, validatePasswordReset } from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";
import { createRateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", createRateLimit({ limit: 5, windowMs: 15 * 60 * 1000, keyPrefix: "forgot-password" }), forgotPassword);
router.get("/reset-password/validate", createRateLimit({ limit: 20, windowMs: 15 * 60 * 1000, keyPrefix: "validate-reset" }), validatePasswordReset);
router.post("/reset-password", createRateLimit({ limit: 10, windowMs: 15 * 60 * 1000, keyPrefix: "reset-password" }), resetPassword);
router.get("/me", requireAuth, me);

export default router;
