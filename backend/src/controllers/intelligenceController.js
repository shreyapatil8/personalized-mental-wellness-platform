import { z } from "zod";

import WellnessContextSnapshot from "../models/WellnessContextSnapshot.js";
import { generateWellnessContext } from "../services/wellnessIntelligenceService.js";
import { getCurrentStressPrediction } from "../services/stressPredictionService.js";

const contextRequestSchema = z.object({
  userMessage: z.string().min(3).max(1200),
  tokenBudget: z.coerce.number().int().min(400).max(3000).default(1400),
  maxItems: z.coerce.number().int().min(3).max(20).default(10)
});

export async function createMyWellnessContext(req, res, next) {
  try {
    const data = contextRequestSchema.parse(req.body);
    const context = await generateWellnessContext({
      user: req.user,
      userMessage: data.userMessage,
      tokenBudget: data.tokenBudget,
      maxItems: data.maxItems
    });

    return res.status(201).json({ context });
  } catch (error) {
    return next(error);
  }
}

export async function getMyLatestWellnessContext(req, res, next) {
  try {
    let context = await WellnessContextSnapshot.findOne({ student: req.user._id }).sort({ createdAt: -1, _id: -1 });
    const selectedPrediction = context?.selectedItems.find(item => item.sourceType === "prediction");
    if (selectedPrediction) {
      const current = await getCurrentStressPrediction(req.user._id);
      if (!current || selectedPrediction.sourceId !== current.id) context = null;
    }
    return res.json({ context });
  } catch (error) {
    return next(error);
  }
}
