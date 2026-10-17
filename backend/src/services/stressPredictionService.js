import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import StressSurvey from "../models/StressSurvey.js";
import WellnessPrediction from "../models/WellnessPrediction.js";
import { stressAnswersSchema, stressSurveyContract } from "../utils/stressSurvey.js";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const resultSchema = z.object({
  riskCategory: z.enum(stressSurveyContract.labels),
  confidence: z.number().finite().min(0).max(1),
  schemaVersion: z.literal(stressSurveyContract.version),
  modelName: z.string().min(1).max(120),
  datasetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  modelSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reasons: z.array(z.string().min(1).max(500)).min(1).max(8)
}).strict();

function unavailable() {
  const error = new Error("The trained stress-type model is unavailable or incompatible. Check the saved model and Python configuration; no substitute prediction was generated.");
  error.statusCode = 503;
  return error;
}

export function parseStressModelResult(value, modelSha256) {
  const result = resultSchema.parse(value);
  if (result.modelSha256 !== modelSha256) throw new Error("Model artifact changed during prediction.");
  return { ...result, modelSource: "trained_model" };
}

export async function getStressModelIdentity() {
  const modelPath = path.resolve(root, process.env.ML_MODEL_PATH || "ml/models/stress-type-model.joblib");
  try {
    const bytes = await readFile(modelPath);
    return { modelPath, modelSha256: createHash("sha256").update(bytes).digest("hex") };
  } catch { throw unavailable(); }
}

// Canonical order is the exact training contract, never profile-derived defaults.
export function canonicalStressAnswers(answers) {
  return stressAnswersSchema.parse(answers instanceof Map ? Object.fromEntries(answers) : answers);
}

export function predictionKey(studentId, surveyId, answers, modelSha256) {
  return createHash("sha256").update(JSON.stringify([
    String(studentId), String(surveyId), canonicalStressAnswers(answers), modelSha256
  ])).digest("hex");
}

export async function getCurrentStressSurvey(studentId, now = new Date()) {
  const survey = await StressSurvey.findOne({ student: studentId }).sort({ createdAt: -1, _id: -1 });
  if (!survey || survey.schemaVersion !== stressSurveyContract.version ||
      survey.createdAt > now || now - survey.createdAt > 30 * 86400000) return null;
  try { canonicalStressAnswers(survey.answers); } catch { return null; }
  return survey;
}

// One shared validity rule for every consumer; historical records are never deleted.
export async function getCurrentStressPrediction(studentId, now = new Date()) {
  const survey = await getCurrentStressSurvey(studentId, now);
  if (!survey) return null;
  let identity;
  try { identity = await getStressModelIdentity(); } catch { return null; }
  const key = predictionKey(studentId, survey._id, survey.answers, identity.modelSha256);
  const prediction = await WellnessPrediction.findOne({
    student: studentId, survey: survey._id, predictionKey: key,
    schemaVersion: stressSurveyContract.version, modelSource: "trained_model", modelSha256: identity.modelSha256
  }).sort({ createdAt: -1, _id: -1 });
  if (!prediction || prediction.createdAt < survey.createdAt || prediction.createdAt > now) return null;
  try {
    parseStressModelResult(Object.fromEntries(
      Object.keys(resultSchema.shape).map(field => [field, prediction[field]])
    ), identity.modelSha256);
    if (JSON.stringify(canonicalStressAnswers(prediction.surveyAnswers)) !== JSON.stringify(canonicalStressAnswers(survey.answers))) return null;
  } catch { return null; }
  return prediction;
}

export async function predictStressType(answers) {
  const features = canonicalStressAnswers(answers);
  const executable = process.env.PYTHON_EXECUTABLE || path.join(root, "ml", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const identity = await getStressModelIdentity();
  try {
    const { stdout } = await execFileAsync(executable, ["-B", "ml/infer_stress_model.py", "--model", identity.modelPath, "--features-json", JSON.stringify(features)],
      { cwd: root, timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 });
    return parseStressModelResult(JSON.parse(stdout), identity.modelSha256);
  } catch { throw unavailable(); }
}
