import json
import unittest
from dataset_contract import SCHEMA_PATH, normalize_label
from infer_stress_model import validate_features, validate_bundle


class SurveyContractTests(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        self.names = [q["id"] for q in self.contract["questions"]]
        self.answers = dict.fromkeys(self.names, 3)

    def test_contract_has_22_independent_survey_items(self):
        self.assertEqual(len(self.names), 22)
        self.assertEqual(len(set(q["column"] for q in self.contract["questions"])), 22)
        self.assertEqual(validate_features(self.answers, self.names), self.answers)

    def test_inference_refuses_missing_extra_and_invalid_values(self):
        for invalid in [{}, {**self.answers, "mood": 3}, *[{**self.answers, self.names[0]: x} for x in [True, 0, 6, 1.5, "3", float("nan")]]]:
            with self.assertRaises(ValueError):
                validate_features(invalid, self.names)

    def test_no_stress_is_never_mapped_to_eustress(self):
        with self.assertRaises(ValueError):
            normalize_label("No Stress - Currently experiencing minimal to no stress.")

    def test_saved_pipeline_matches_exact_feature_order_and_label_encoding(self):
        import joblib
        bundle = joblib.load(SCHEMA_PATH.parents[1] / "ml" / "models" / "stress-type-model.joblib")
        self.assertEqual(validate_bundle(bundle, self.contract), self.names)
        self.assertEqual([name for name, _ in bundle["model"].steps], ["imputer", "selection", "scaler", "model"])
        for invalid in [{**bundle, "feature_names": self.names[::-1]},
                        {**bundle, "labels": bundle["labels"][::-1]},
                        {**bundle, "schema_version": "incompatible"}]:
            with self.assertRaises(ValueError):
                validate_bundle(invalid, self.contract)


if __name__ == "__main__":
    unittest.main()
