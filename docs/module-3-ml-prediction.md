# Module 3 — Research stress-type classification

The approved task is Eustress/Distress classification from a separate complete 22-question survey. No Stress is excluded from this binary study. Longitudinal WHO-5, mood and journal data are not training features. See [ML documentation](../ml/README.md) and [actual results](../research/results/research-results.md).

Student-only endpoints: GET/POST /api/predictions/survey; GET/POST /api/predictions/me; GET /api/predictions/me/features (longitudinal context only). Missing/incomplete/stale survey returns a validation error. A broken model returns 503 without invented predictions.

Active files: StressSurvey.js, shared/stressSurvey.json, stressPredictionService.js, train_stress_model.py, infer_stress_model.py. Historical riskCategory naming is retained for compatibility; current values are eustress/distress. Report probability as uncalibrated.
