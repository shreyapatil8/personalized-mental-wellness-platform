"""Reproducible comparison with training-only selection and an untouched holdout."""
import argparse
import hashlib
import json
import platform
from pathlib import Path
from dataset_contract import SCHEMA_PATH, TARGET, normalize_label


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--output", default="ml/models/stress-type-model.joblib")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    import joblib
    import numpy as np
    import pandas as pd
    import sklearn
    import xgboost
    from sklearn.dummy import DummyClassifier
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.feature_selection import SelectFromModel
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix, f1_score, roc_auc_score
    from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    from xgboost import XGBClassifier

    contract = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    labels = contract["labels"]
    raw = pd.read_csv(args.data)
    original_target_counts = raw[TARGET].value_counts().to_dict()
    no_stress_mask = raw[TARGET].fillna("").str.lower().str.startswith("no stress")
    no_stress_excluded = int(no_stress_mask.sum())
    required = [q["column"] for q in contract["questions"]] + [TARGET]
    missing = set(required) - set(raw.columns)
    if missing:
        raise SystemExit(f"Missing columns: {sorted(missing)}")
    # The agreed binary study excludes the source's third class explicitly; never relabel it as Eustress.
    frame = raw.loc[~no_stress_mask, required].copy()
    missing_targets = int(frame[TARGET].isna().sum())
    frame = frame.dropna(subset=[TARGET])
    frame[TARGET] = frame[TARGET].map(normalize_label)
    for column in required[:-1]:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
        if not frame[column].dropna().between(1, 5).all():
            raise SystemExit(f"Out-of-range Likert values in {column}")
    conflicting = frame.groupby(required[:-1], dropna=False)[TARGET].nunique()
    if (conflicting > 1).any():
        raise SystemExit("Identical survey responses have conflicting labels; resolve before evaluation.")
    duplicates = int(frame.duplicated(subset=required[:-1]).sum())
    frame = frame.drop_duplicates(subset=required[:-1])
    names = [q["id"] for q in contract["questions"]]
    x = frame[required[:-1]].set_axis(names, axis=1)
    y = frame[TARGET].map({label: i for i, label in enumerate(labels)})
    if y.nunique() != 2 or y.value_counts().min() < 10:
        raise SystemExit("Both classes need at least 10 records.")
    train_x, test_x, train_y, test_y = train_test_split(x, y, test_size=0.2, random_state=args.seed, stratify=y)
    candidates = {
        "majority_baseline": DummyClassifier(strategy="most_frequent"),
        "logistic_regression": LogisticRegression(max_iter=2000, class_weight="balanced", random_state=args.seed),
        "random_forest": RandomForestClassifier(n_estimators=200, min_samples_leaf=2, class_weight="balanced", random_state=args.seed, n_jobs=1),
        "xgboost": XGBClassifier(n_estimators=150, max_depth=3, learning_rate=0.05, objective="binary:logistic", eval_metric="logloss", random_state=args.seed, n_jobs=1)
    }
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=args.seed)
    results, fitted = {}, {}
    for name, estimator in candidates.items():
        pipeline = Pipeline([
            ("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("selection", SelectFromModel(RandomForestClassifier(n_estimators=100, class_weight="balanced", random_state=args.seed, n_jobs=1), threshold="median")),
            ("scaler", StandardScaler()), ("model", estimator)
        ])
        cv = cross_validate(pipeline, train_x, train_y, cv=folds,
                            scoring={"macro_f1": "f1_macro", "accuracy": "accuracy"}, error_score="raise")
        pipeline.fit(train_x, train_y)
        results[name] = {"cv_macro_f1_mean": float(np.mean(cv["test_macro_f1"])),
                         "cv_macro_f1_std": float(np.std(cv["test_macro_f1"])),
                         "cv_accuracy_mean": float(np.mean(cv["test_accuracy"]))}
        fitted[name] = pipeline
    best_name = max((n for n in candidates if n != "majority_baseline"), key=lambda n: results[n]["cv_macro_f1_mean"])
    for name, model in fitted.items():
        predicted = model.predict(test_x)
        probabilities = model.predict_proba(test_x)[:, 1]
        results[name]["test"] = {
            "accuracy": float(accuracy_score(test_y, predicted)),
            "balanced_accuracy": float(balanced_accuracy_score(test_y, predicted)),
            "macro_f1": float(f1_score(test_y, predicted, average="macro")),
            "roc_auc": float(roc_auc_score(test_y, probabilities)),
            "confusion_matrix": confusion_matrix(test_y, predicted, labels=[0, 1]).tolist(),
            "classification_report": classification_report(test_y, predicted, labels=[0, 1], target_names=labels, output_dict=True, zero_division=0)
        }
    selected = fitted[best_name]
    mask = selected.named_steps["selection"].get_support()
    importance = selected.named_steps["selection"].estimator_.feature_importances_
    report = {
        "task": "Self-reported Eustress/Distress classification; not clinical severity",
        "source": "https://www.kaggle.com/datasets/ashutoshsingh22102/stress-and-well-being-data-of-college-students",
        "sha256": hashlib.sha256(Path(args.data).read_bytes()).hexdigest(),
        "schema_version": contract["version"], "random_seed": args.seed,
        "rows_original": len(raw), "columns_original": len(raw.columns), "missing_targets_removed": missing_targets,
        "original_target_counts": original_target_counts, "no_stress_excluded_from_binary_study": no_stress_excluded,
        "age_range_in_source": [float(raw["Age"].min()), float(raw["Age"].max())],
        "duplicate_rows_removed": duplicates, "missing_feature_values": int(x.isna().sum().sum()),
        "class_counts": frame[TARGET].value_counts().to_dict(), "train_rows": len(train_x), "test_rows": len(test_x),
        "selection_method": "5-fold stratified training-only CV macro F1; untouched 20% holdout for final reporting",
        "selected_model": best_name, "label_order": labels, "results": results,
        "selected_features": [name for name, keep in zip(names, mask) if keep],
        "train_feature_importance": dict(zip(names, map(float, importance))),
        "train_correlations": train_x.corr().fillna(0).to_dict(),
        "versions": {"python": platform.python_version(), "sklearn": sklearn.__version__, "xgboost": xgboost.__version__, "pandas": pd.__version__},
        "limitations": ["Self-reported labels are not diagnoses or Low/Medium/High risk.",
                         "Single survey dataset; external validity and prospective performance are untested.",
                         "WHO-5, mood-history and journal features are not fabricated from this dataset.",
                         "Feature importance is descriptive, not causal. Model probabilities are uncalibrated.",
                         "Some survey items are ambiguous; only response endpoints are documented by the data card."]
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": selected, "model_name": best_name, "feature_names": names,
                 "labels": labels, "schema_version": contract["version"], "dataset_sha256": report["sha256"]}, output)
    output.with_suffix(".metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"selected_model": best_name, "metrics": str(output.with_suffix('.metrics.json')), "test": results[best_name]["test"]}))


if __name__ == "__main__":
    main()
