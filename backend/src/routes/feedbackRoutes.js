import { Router } from "express";
import { z } from "zod";
import Feedback from "../models/Feedback.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";

const router = Router();
const schema = z.object({ category: z.enum(["overall", "assistant", "tracking", "counselling"]),
  rating: z.number().int().min(1).max(5), helpfulness: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).default("") });
router.use(requireAuth, allowRoles("student", "counsellor"));
router.post("/", async (req, res, next) => {
  try {
    const data = schema.parse(req.body);
    const feedback = await Feedback.create({ ...data, user: req.user._id, role: req.user.role });
    return res.status(201).json({ id: feedback._id, message: "Thank you. Your feedback has been recorded." });
  } catch (error) { return next(error); }
});
router.get("/me", async (req, res, next) => {
  try { return res.json({ feedback: await Feedback.find({ user: req.user._id }).select("+comment").sort({ createdAt: -1 }).limit(20) }); }
  catch (error) { return next(error); }
});
export default router;
