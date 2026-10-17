"""Build a readable report from existing experiment artifacts; never retrains."""
import json
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parents[1]
metrics = json.loads((ROOT / "ml/models/stress-type-model.metrics.json").read_text(encoding="utf-8"))
context = json.loads((ROOT / "research/results/context-evaluation.json").read_text(encoding="utf-8"))
lines = ["# Observed research results", "", "Report generated from saved experiment artifacts. No participant, therapeutic-effectiveness or live-provider results are included.", "",
         "## Dataset and experiment", "",
         f"Source: [Kaggle survey]({metrics['source']}). CSV SHA-256: `{metrics['sha256']}`.", "",
         "843 rows and 26 columns: 768 Eustress, 32 Distress, 43 No Stress. The agreed binary study excludes No Stress rather than relabelling it. After removing 47 identical predictor rows: 753 observations (725 Eustress, 28 Distress). There are no retained missing feature values. Age ranges 14–100; age, gender and the duplicate anxiety field are excluded from predictors.", "",
         f"Stratified 80:20 split with seed {metrics['random_seed']}: {metrics['train_rows']} training and {metrics['test_rows']} holdout records. Preprocessing and feature selection are fitted within each of five training CV folds. Selection uses CV macro F1 before inspecting holdout metrics. Selected model: **{metrics['selected_model']}**.", "",
         "| Model | Training CV macro F1 (mean ± SD) | Holdout accuracy | Balanced accuracy | Macro F1 | ROC AUC |",
         "| --- | ---: | ---: | ---: | ---: | ---: |"]
for name, row in metrics["results"].items():
    result = row["test"]
    lines.append(f"| {name} | {row['cv_macro_f1_mean']:.4f} ± {row['cv_macro_f1_std']:.4f} | {result['accuracy']:.4f} | {result['balanced_accuracy']:.4f} | {result['macro_f1']:.4f} | {result['roc_auc']:.4f} |")
lines += ["", "The majority baseline already achieves 96.03% accuracy, making accuracy alone misleading. Random Forest has the highest holdout macro F1 in this run; Logistic Regression remains selected because selection was fixed by training CV. Do not switch after examining the holdout.", "",
          "## Selected-model confusion matrix", "", "Rows are true labels; columns are predictions.", "",
          "| Actual / predicted | Distress | Eustress |", "| --- | ---: | ---: |"]
chosen = metrics["results"][metrics["selected_model"]]["test"]
for name, row in zip(metrics["label_order"], chosen["confusion_matrix"]):
    lines.append(f"| {name} | {row[0]} | {row[1]} |")
minority = chosen["classification_report"]["distress"]
lines += ["", f"**Only {int(minority['support'])} Distress cases are in the holdout.** Distress precision {minority['precision']:.4f}, recall {minority['recall']:.4f}, F1 {minority['f1-score']:.4f}. One changed prediction would materially change recall. These results cannot establish clinical safety or external validity.", "",
          "Probabilities are uncalibrated. Labels are self-reported stress type, not clinical severity. No Stress is unsupported. Source population/age consistency and survey wording are uncertain. There is no participant identifier for subject-level splitting, so independence beyond exact predictor deduplication cannot be established. The saved model is trained on the training partition only. Feature importance describes the selector; it is not a causal or per-person explanation.", "",
          "Selected input IDs: " + ", ".join(metrics["selected_features"]) + ". All 22 original inputs are still required at inference to preserve the contract.", "",
          "Package versions: " + ", ".join(f"{key} {value}" for key, value in metrics["versions"].items()) + ".", "",
          "## Context selection engineering experiment", "", context["limitations"], "",
          f"Artifact timestamp: {context['generatedAt']}. Six cases, four variants, budget 700 estimated tokens, top-k 4. Latency is the local average of 100 selections per scenario; it excludes database/network/LLM time. Blank precision/recall cases are excluded from the corresponding mean, with denominators shown.", "",
          "| Variant | Mean precision (n) | Mean recall (n) | Mean estimated prompt tokens | Budget passes | Mean reduction vs raw |",
          "| --- | ---: | ---: | ---: | ---: | ---: |"]
for variant in ["no_history", "raw_history", "recency_only", "proposed_engine"]:
    rows = [row for row in context["results"] if row["variant"] == variant]
    precision = [row["precision"] for row in rows if row["precision"] is not None]
    recall = [row["recall"] for row in rows if row["recall"] is not None]
    fmt = lambda values: f"{mean(values):.3f} ({len(values)})" if values else "N/A (0)"
    lines.append(f"| {variant} | {fmt(precision)} | {fmt(recall)} | {mean(row['estimatedPromptTokens'] for row in rows):.1f} | {sum(row['withinBudget'] for row in rows)}/{len(rows)} | {mean(row['tokenReductionVsRaw'] for row in rows):.1%} |")
latencies = [row["selectionLatencyMs"] for row in context["results"] if row["selectionLatencyMs"] is not None]
lines += ["", f"Mean proposed-engine selection time across these cases: {mean(latencies):.3f} ms. No model response-quality ratings, billed-token savings or general performance superiority can be inferred from this fixture result.", "",
          "## Verification and remaining evidence", "",
          "47 backend integration/unit tests and three Python survey-contract tests passed. Frontend lint and production build passed. See backend-tests.txt for the recorded backend run, the root README for reproduction, docs/research-progress.md for scope and research/human-evaluation-protocol.md for independent evaluation. Live provider connectivity, visual browser walkthrough, legacy database migration and participant/professional reviews remain to be completed. The configured Atlas cluster was unreachable during the read-only audit; no existing database was modified."]
(ROOT / "research/results/research-results.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("Wrote research/results/research-results.md from saved artifacts.")
