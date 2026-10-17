"""Dataset-aligned survey; stress type is not clinical severity."""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "shared" / "stressSurvey.json"
TARGET = "Which type of stress do you primarily experience?"
EXCLUDED = {"Gender", "Age", TARGET, "Have you been dealing with anxiety or tension recently?.1"}


def normalize_label(value):
    text = str(value).strip().lower()
    if text.startswith("eustress"):
        return "eustress"
    if text.startswith("distress"):
        return "distress"
    raise ValueError(f"Unexpected stress-type label: {value!r}")


def create_contract(csv_path):
    with open(csv_path, newline="", encoding="utf-8-sig") as source:
        columns = csv.DictReader(source).fieldnames
    if TARGET not in columns:
        raise ValueError("Dataset target column is missing.")
    questions = [{"id": f"survey_{i + 1:02d}", "column": column, "label": column}
                 for i, column in enumerate(c for c in columns if c not in EXCLUDED)]
    contract = {"version": "kaggle-stress-type-v1", "target": TARGET,
                "labels": ["distress", "eustress"], "questions": questions,
                "scale": ["Not at all", "Slightly", "Moderately", "Very", "Extremely"],
                "notice": "Research survey using the source dataset's 1–5 responses. Estimates self-reported stress type, not clinical risk. Intermediate response anchors are an application convention; the dataset only documents its endpoints. Ambiguous attendance and weight items are a study limitation."}
    SCHEMA_PATH.parent.mkdir(exist_ok=True)
    SCHEMA_PATH.write_text(json.dumps(contract, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return contract


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("data")
    args = parser.parse_args()
    print(json.dumps({"questions": len(create_contract(args.data)["questions"])}))
