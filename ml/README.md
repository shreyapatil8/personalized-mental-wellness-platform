# Stress-type classification

Source: [Stress and Well-being Data of College Students](https://www.kaggle.com/datasets/ashutoshsingh22102/stress-and-well-being-data-of-college-students).

The approved task is Eustress versus Distress. The actual CSV also contains No Stress; its 43 rows are explicitly excluded, never relabelled. The binary model cannot identify people with no stress and is not a general clinical screening classifier.

## Data and contract

843 source rows, 26 columns: 768 Eustress, 32 Distress, 43 No Stress. After binary scoping and removing 47 identical predictor rows: 753 observations, comprising 725 Eustress and 28 Distress. No retained feature values are missing. Age ranges from 14 to 100 despite the narrower data-card description.

shared/stressSurvey.json defines 22 survey questions shared by the application and Python. Age, gender, the target and a duplicate anxiety column are excluded. Source responses range 1–5; only endpoint meaning is documented. Intermediate interface anchors are application conventions. Ambiguous item wording and uncertain instrument validity limit interpretation.

WHO-5, mood history and journal sentiment are separate context data and are never fabricated as training features. Inference requires complete integer responses in [1,5]. The API requires a survey saved within 30 days.

## Saved artifacts

- models/stress-type-model.joblib: selected pipeline, feature order, labels, schema version and source checksum.
- models/stress-type-model.metrics.json: all comparisons, confusion matrices, training correlations, selection importance and package versions.
- ../research/results/research-results.md: readable results.

Load only trusted joblib bundles; serialization can execute code. This bundle was trained locally by the project script.

## Reproduction

Install requirements-lock.txt in ml/.venv, obtain the source CSV, then run from the project root only when a new experiment is needed:

```powershell
& ml/.venv/Scripts/python.exe ml/train_stress_model.py --data 'ml/data/kaggle/Stress Dataset.csv'
```

Expected CSV SHA-256: ad7e9e0508e7a6713b230378368c10642c871cbacca661cab5f35e951a2a336d. Data is excluded from source control.

Seed 42 and a stratified 80:20 split produce 602 training and 151 holdout observations. Five-fold training-only CV fits median imputation, tree-based feature selection, scaling and each classifier inside each fold. Compare a majority baseline, balanced Logistic Regression, balanced Random Forest and XGBoost. Select by mean CV macro F1 before evaluating the holdout. The saved model remains fitted on the 602 training observations.

Logistic Regression was selected: holdout macro F1 0.8502, accuracy 0.9735, with only SIX Distress test examples. Random Forest scores higher on holdout macro F1 in this run; changing selection after seeing this would tune to the test set. External validation, calibration and prospective testing are unperformed.

infer_stress_model.py validates inputs and returns class, uncalibrated probability and provenance. The legacy API field riskCategory contains eustress/distress for new estimates. Old predictions are excluded by current schema-version filters. Prototype training, inference and rule-based fallback code has been retired.
