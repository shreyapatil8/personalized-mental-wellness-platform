"""Create a corrected Markdown edition without changing the supplied Word document."""
from pathlib import Path
import re
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[1]
source = Document(ROOT / "docs/research-synopsis-source.docx")
changes = {
    "Preprocesses assessment and mood-related features": "Preprocesses the 22 dataset-aligned survey responses",
    "predict a Low / Medium / High wellness-risk category": "predict an Eustress or Distress stress-type label",
    "through a lightweight prediction REST API (Flask/FastAPI) or a serialized-model inference call": "through a serialized-model Python subprocess inference call",
    "React.js frontend with a charting library (Recharts / Chart.js)": "React.js frontend with Recharts",
    "see Section 6.1.4, Dataset": "see Dataset for Machine Learning Model",
    "aggregate/anonymized": "aggregate",
    "aggregate, anonymized analytics": "aggregate analytics without directly identifying records",
    "This is the “user-specific context orchestration layer” that is the platform's key point of novelty over a plain chatbot.": "This is the proposed context-selection contribution, evaluated against explicit baselines; novelty and general benefit require independent evidence.",
    "[4] Trustworthy Data and AI Environments for Clinical Prediction, IEEE, 2024.": "[4] Y. J. Msosa et al. Trustworthy Data and AI Environments for Clinical Prediction: Application to Crisis-Risk in People With Depression. IEEE Journal of Biomedical and Health Informatics 27(11), 5588–5598 (2023). https://discovery.ucl.ac.uk/id/eprint/10183194/",
    "one of the five objectives": "one of the six objectives",
    "seven modules above": "eight modules above",
    "Low / Medium / High wellness-risk category": "Eustress or Distress stress-type label",
    "wellness/stress risk category": "self-reported stress-type label (Eustress or Distress)",
    "wellness or stress risk category": "self-reported stress-type label (Eustress or Distress)",
    "wellness/stress risk": "self-reported stress type",
    "ML risk category": "ML stress-type estimate",
    "ML-assisted wellness-risk state": "ML-assisted stress-type estimate",
    "OpenAI API (chat/completions)": "OpenAI Responses API",
    "User-data aggregation → mood & trend analysis → journal summarization → AI-generated user summary pipeline": "Consent check → user-data aggregation → mood and trend analysis → context selection → AI-generated counsellor briefing",
    "the best model on the held-out test set is selected for deployment": "the model with the highest training-only cross-validation macro F1 is selected before evaluating the held-out test set",
    "(843 student responses, 26 columns), used for training and evaluating the Module 3 Machine Learning model.": "(843 source responses, 26 columns), used for the explicitly scoped Eustress/Distress classification study. The original No Stress class is excluded, not relabelled. Dataset URL: https://www.kaggle.com/datasets/ashutoshsingh22102/stress-and-well-being-data-of-college-students",
}

dataset_text = (
    'The study uses the "Stress and Well-being Data of College Students" dataset from Kaggle. '
    'Inspection of the downloaded CSV found 843 rows and 26 columns: 768 Eustress, 32 Distress and 43 No Stress responses. '
    'The approved research task is binary Eustress/Distress classification. The 43 No Stress rows are excluded explicitly; '
    'they are not relabelled, and the classifier cannot identify No Stress. After removing 47 exact duplicate predictor rows, '
    '753 observations remain (725 Eustress and 28 Distress). The target is self-reported stress type, not clinical risk severity. '
    'The data card describes ages 18–21, but the CSV contains ages from 14 to 100; the age field is not used as a predictor and '
    'its inconsistencies are reported as a source-data limitation. Gender and the duplicated anxiety column are also excluded. '
    'The remaining 22 survey items form the application and model feature contract. WHO-5, longitudinal mood records, journals '
    'and chat history are separate inputs to the context engine and are not fabricated from the Kaggle survey.'
)
performance_section = [
    "## 10. Performance Analysis",
    "### 10.1 ML Model Performance",
    "Use a reproducible stratified 80:20 split (seed 42), yielding 602 training and 151 held-out observations after documented cleaning. Fit imputation, feature selection and scaling within each training fold. Compare a majority-class baseline, Logistic Regression, Random Forest and XGBoost using five-fold stratified cross-validation on the training portion. Select by mean macro F1, then evaluate the held-out set once. Report accuracy, balanced accuracy, per-class precision/recall/F1, macro F1, ROC AUC and confusion matrices, together with sample counts and package versions. Tree feature importance and correlations are descriptive, not causal.",
    "The retained holdout has only six Distress examples. Report this small denominator and class imbalance beside every result. Do not claim clinical validity or external generalization. Preserve the dataset checksum, feature contract and model artifact. The observed experiment results are recorded separately in research/results/research-results.md.",
    "### 10.2 Wellness Intelligence Engine Performance",
    "Compare no-history, raw-history, recency-only and proposed context selection on identical scenarios. Report estimated prompt size, token reduction, relevance precision/recall, budget compliance and local selection latency. The initial six hand-authored fixtures are engineering checks, not a participant study or independent proof of novelty. Extend the evaluation with independently labelled scenarios before making general performance claims. Token counts based on characters divided by four are estimates, not provider billing counts.",
    "Conduct a separate blinded comparison of assistant replies using relevance, factual grounding, continuity, empathy and appropriateness of referral rubrics. Have qualified reviewers assess counsellor briefings for omissions, unsupported statements and preparation usefulness. Record rater agreement and sample size. These human evaluations are planned work until actual ratings are collected.",
    "### 10.3 Overall System Performance",
    "Measure HTTP response duration, request counts, success rate (HTTP status below 400) and server-error counts. Store route templates and timings without user identifiers or message bodies. Assess student and counsellor usability through optional 1–5 ease-of-use and helpfulness ratings, reporting role, category and response count. Use controlled functional and authorization tests for registration, prediction, consent, appointment conflicts, private notes and anonymous analytics. Report controlled-test timings separately from real deployment performance. Feedback is descriptive and does not demonstrate therapeutic effectiveness."
]


def revise(text):
    text = text.strip()
    if text.startswith('The ML component (Module 3) will be trained'):
        return dataset_text
    if text.startswith('• Preprocessing:'):
        return "- Preprocessing: validate 1–5 responses, retain documented labels, exclude No Stress for the binary task, remove exact predictor duplicates before splitting, and fit missing-value imputation and scaling only on training data."
    if text.startswith('• Feature selection:'):
        return "- Feature selection: compute training-set correlations and use tree-based importance selection fitted inside each cross-validation fold. Retain the same 22-item input contract for application inference."
    if text.startswith('• Class balance check:'):
        return "- Class balance: report all source and retained class counts; use stratified splits, class weighting where supported, macro F1 and a majority-class baseline."
    if text.startswith('Typical real-world usage includes'):
        return "The prototype supports reviewing self-reported wellness trends, preparing consented draft briefings and tracking student reflections. Whether it reduces counsellor preparation time or improves engagement is a research question; Eustress/Distress is not used as a clinical triage severity scale."
    if text.startswith('The platform is expected to enhance'):
        return "The research will evaluate response relevance, factual grounding, usability and counsellor briefing usefulness. Improvements in engagement, preparation time and mental well-being are hypotheses, not established outcomes of the implementation."
    if text.startswith('Estimates the student') and 'Module 2' in text:
        return "Estimates Eustress or Distress using a complete dataset-aligned research survey collected in Module 2. The estimate is supplied to Module 4 alongside separate WHO-5, mood, journal and conversation context. Incomplete or stale surveys do not produce a substitute estimate."
    if text.startswith('Rule-based scoring of the assessment'):
        return "Rule-based WHO-5 scoring and time-series mood aggregation support longitudinal context. A separate 22-item dataset-aligned survey supplies the ML classifier; WHO-5 and journal features are not treated as interchangeable with the training survey."
    if text.startswith('Structured wellness assessment ('):
        text += " A separate 22-item research survey records the exact input features required by Module 3."
    if text.startswith('Student, counsellor and admin registration and login;'):
        return "Student registration and login; counsellor registration with administrator activation; administrator accounts provisioned through a restricted setup command; JWT role-based access and student-owned wellness profiles."
    for old, new in changes.items():
        text = text.replace(old, new)
    return text


lines = ["# Personalized Mental Wellness Platform for College Students", "", "Research synopsis corrected for the approved Eustress and Distress study", "", "The implementation-aligned architecture is in [research-architecture.md](research-architecture.md). The supplied literature claims are retained for review; except for explicitly sourced corrections, their publication details and comparison claims still require primary-source verification before submission.", ""]
inserted_performance = False
for child in source.element.body:
    if child.tag == qn("w:p"):
        text = revise(Paragraph(child, source).text)
        if not text:
            continue
        # Word's cached TOC page numbers are invalid in this Markdown edition.
        if text == "Table of Contents" or re.match(r"^\d+(?:\.\d+)?\.?\s+.+\d+$", text):
            continue
        if text.startswith("11. Conclusion") and not inserted_performance:
            lines.extend(performance_section); inserted_performance = True
        if re.match(r"^\d+\.\s", text):
            text = "## " + text
        elif re.match(r"^\d+\.\d+\s", text) or text.startswith("Module "):
            text = "### " + text
        lines.extend([text, ""])
    elif child.tag == qn("w:tbl"):
        rows = [[revise(cell.text).replace("\n", "<br>").replace("|", "\\|") for cell in row.cells] for row in Table(child, source).rows]
        if rows:
            lines.append("| " + " | ".join(rows[0]) + " |")
            lines.append("| " + " | ".join("---" for _ in rows[0]) + " |")
            lines.extend("| " + " | ".join(row) + " |" for row in rows[1:]); lines.append("")
lines.extend(["## Editorial and research verification notes", "",
    "The original Word document and its figures remain unchanged. This text edition corrects the six-objective/eight-module counts, target labels, feature contract and evaluation design, and supplies the missing Performance Analysis body. Existing architecture/schedule figures must be updated in Word to reflect the survey classifier before submission. The bibliography contains inconsistent years between the literature table and reference list; verify each item against its primary publication before submission. Claims about novelty and clinical benefit remain hypotheses requiring independent evaluation, not established findings."])
(ROOT / "docs/research-synopsis-corrected.md").write_text("\n".join(lines), encoding="utf-8")
print("Corrected synopsis text written; original Word file preserved.")
