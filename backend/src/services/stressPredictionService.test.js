import assert from "node:assert/strict";
import test from "node:test";
import { canonicalStressAnswers, parseStressModelResult, predictionKey, getStressModelIdentity, predictStressType } from "./stressPredictionService.js";
import { stressSurveyContract } from "../utils/stressSurvey.js";

const answers = Object.fromEntries(stressSurveyContract.questions.map((q, i) => [q.id, i % 5 + 1]));
test("feature mapping preserves all 22 entered numeric answers in training order without assessment defaults", () => {
  assert.deepEqual(canonicalStressAnswers(Object.fromEntries(Object.entries(answers).reverse())), answers);
  assert.deepEqual(Object.keys(canonicalStressAnswers(answers)), stressSurveyContract.questions.map(q => q.id));
  for (const invalid of [{}, { ...answers, sleepHours: 7 }, { ...answers, survey_01: "3" }, { ...answers, survey_02: true },
    { ...answers, survey_03: 0 }, { ...answers, survey_04: 6 }, { ...answers, survey_05: 1.5 },
    { ...answers, survey_06: NaN }, { sleepQuality: "Poor", academicPressure: "High" }]) {
    assert.throws(() => canonicalStressAnswers(invalid));
  }
});
test("malformed inference output cannot inject ownership or silently become a prediction", () => {
  const valid = { riskCategory: "distress", confidence: .6, schemaVersion: stressSurveyContract.version,
    modelName: "logistic_regression", datasetSha256: "a".repeat(64), modelSha256: "b".repeat(64), reasons: ["Research estimate, not diagnosis."] };
  assert.equal(parseStressModelResult(valid, valid.modelSha256).modelSource, "trained_model");
  for (const invalid of [null, {}, { ...valid, confidence: NaN }, { ...valid, confidence: 1.1 },
    { ...valid, riskCategory: "high" }, { ...valid, riskCategory: "no_stress" },
    { ...valid, schemaVersion: "wrong" }, { ...valid, reasons: [] }, { ...valid, student: "other-student" },
    { ...valid, modelName: "" }, { ...valid, datasetSha256: "invalid" }, { ...valid, modelSha256: "c".repeat(64) }]) {
    assert.throws(() => parseStressModelResult(invalid, valid.modelSha256));
  }
});
test("reuse keys depend on student, survey, exact feature values and model artifact, never object key order", () => {
  const key = predictionKey("student", "survey", answers, "model");
  assert.equal(key, predictionKey("student", "survey", Object.fromEntries(Object.entries(answers).reverse()), "model"));
  for (const other of [predictionKey("other", "survey", answers, "model"), predictionKey("student", "new", answers, "model"),
    predictionKey("student", "survey", { ...answers, survey_01: 5 }, "model"), predictionKey("student", "survey", answers, "changed-model")]) {
    assert.notEqual(key, other);
  }
});
test("the unchanged real trained artifact gives reproducible output for identical structured input", async () => {
  const before = await getStressModelIdentity();
  const first = await predictStressType(answers);
  const second = await predictStressType(Object.fromEntries(Object.entries(answers).reverse()));
  assert.deepEqual(first, second);
  assert.ok(stressSurveyContract.labels.includes(first.riskCategory));
  assert.equal(first.modelName, "logistic_regression");
  assert.equal(first.modelSha256, before.modelSha256);
  assert.deepEqual(await getStressModelIdentity(), before);
}, { timeout: 60000 });
