import { readFileSync } from "node:fs";
import { z } from "zod";

export const initialWellnessContract = JSON.parse(
  readFileSync(new URL("../../../shared/initialWellnessAssessment.json", import.meta.url), "utf8").replace(/^\uFEFF/, "")
);

export const initialWellnessSchema = z.object({
  schemaVersion: z.literal(initialWellnessContract.version),
  responses: z.object(Object.fromEntries(initialWellnessContract.questions.map((question) => [
    question.id,
    question.optional
      ? z.string().trim().max(question.maxLength).optional().default("")
      : z.enum(question.options)
  ]))).strict()
}).strict();
