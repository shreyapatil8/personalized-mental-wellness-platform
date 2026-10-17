import argparse
import json
import math
import hashlib
import io
from pathlib import Path
from dataset_contract import SCHEMA_PATH


def validate_bundle(bundle, contract):
    names = [question["id"] for question in contract["questions"]]
    model = bundle["model"]
    if (bundle["schema_version"] != contract["version"] or bundle["feature_names"] != names
            or bundle["labels"] != contract["labels"]
            or list(model.feature_names_in_) != names or model.n_features_in_ != len(names)
            or list(model.classes_) != list(range(len(contract["labels"])))):
        raise ValueError("Saved model does not match the application feature/label contract.")
    return names


def validate_features(features, names):
    if set(features) != set(names):
        raise ValueError("Complete survey answers matching the trained feature contract are required.")
    for value in features.values():
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value != int(value) or not 1 <= value <= 5:
            raise ValueError("Survey responses must be integers from 1 to 5.")
    return {name: features[name] for name in names}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--features-json", required=True)
    args = parser.parse_args()
    import joblib
    import pandas as pd
    model_bytes = Path(args.model).read_bytes()
    bundle = joblib.load(io.BytesIO(model_bytes))
    contract = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    names = validate_bundle(bundle, contract)
    row = validate_features(json.loads(args.features_json), names)
    frame = pd.DataFrame([row], columns=names)
    predicted = int(bundle["model"].predict(frame)[0])
    probabilities = bundle["model"].predict_proba(frame)[0]
    if (predicted not in range(len(bundle["labels"])) or len(probabilities) != len(bundle["labels"])
            or not all(math.isfinite(float(p)) and 0 <= p <= 1 for p in probabilities)
            or not math.isclose(float(sum(probabilities)), 1.0, abs_tol=1e-6)):
        raise ValueError("Model returned an invalid category/probability.")
    predicted_index = list(bundle["model"].classes_).index(predicted)
    print(json.dumps({"riskCategory": bundle["labels"][predicted], "confidence": round(float(probabilities[predicted_index]), 4),
                      "modelName": bundle["model_name"], "schemaVersion": bundle["schema_version"],
                      "datasetSha256": bundle["dataset_sha256"],
                      "modelSha256": hashlib.sha256(model_bytes).hexdigest(),
                      "reasons": ["Estimates self-reported stress type from the research survey, not clinical risk.",
                                  "Probability is an uncalibrated model output, not certainty about your health."]}, allow_nan=False))


if __name__ == "__main__":
    main()
