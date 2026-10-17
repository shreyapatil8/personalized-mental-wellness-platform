import { readFileSync } from "node:fs";
import { z } from "zod";

export const stressSurveyContract = JSON.parse(readFileSync(new URL("../../../shared/stressSurvey.json", import.meta.url), "utf8"));
export const stressAnswersSchema = z.object(Object.fromEntries(
  stressSurveyContract.questions.map((question) => [question.id, z.number().int().min(1).max(5)])
)).strict();
