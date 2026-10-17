import { BrainCircuit, ChevronRight, Database, Gauge, ListChecks, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../api/client.js";
import { useAuth } from "../context/useAuth.js";
import StressSurveyForm from "../components/StressSurveyForm.jsx";

const featureLabels = {
  latestWho5Score: "Latest WHO-5 score",
  assessmentRiskScore: "Assessment risk score",
  averageMoodScore: "Average mood",
  averageStressLevel: "Average stress",
  averageSleepHours: "Average sleep",
  moodVolatility: "Mood volatility",
  journalNegativeRatio: "Negative journal ratio",
  journalEntryCount: "Journal entries",
  moodEntryCount: "Mood logs",
  assessmentCount: "Assessments"
};

export default function PredictionPage({ embedded = false }) {
  const { user } = useAuth();
  const [prediction, setPrediction] = useState(null);
  const [features, setFeatures] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);

  async function loadPredictionData() {
    try {
      setError("");
      const [predictionResult, featuresResult] = await Promise.all([
        api.get("/predictions/me"),
        api.get("/predictions/me/features")
      ]);
      setPrediction(predictionResult.data.prediction);
      setFeatures(featuresResult.data.features);
    } catch (err) {
      setError(err.response?.data?.message || "We could not load your estimate. Please refresh to try again.");
    } finally {
      setLoading(false);
    }
  }

  async function generatePrediction() {
    try {
      setPredicting(true);
      setError("");
      setPrediction(null);
      const { data } = await api.post("/predictions/me");
      setPrediction(data.prediction);
      await loadPredictionData();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to generate prediction.");
    } finally {
      setPredicting(false);
    }
  }

  useEffect(() => {
    if (user.role === "student") {
      loadPredictionData();
    }
  }, [user.role]);

  if (user.role !== "student") {
    return (
      <section className="surface p-6">
        <p className="section-kicker">Wellness estimate</p>
        <h2 className="mt-2 text-2xl font-bold">Your stress check-in</h2>
        <p className="mt-2 muted-copy">Prediction is available for student accounts after tracking data is recorded.</p>
      </section>
    );
  }

  if (embedded) {
    return (
      <section className="space-y-5" aria-label="Stress summary" aria-busy={loading || predicting}>
        {loading ? <p role="status" className="text-sm text-slate-600">Loading your summary...</p> : <>
          <p className="text-sm leading-6 text-slate-600">{prediction ? "Your latest stress check-in suggests:" : "Complete the optional stress check-in to see a summary here."}</p>
          {prediction && <p className="text-xl font-medium">{titleCase(prediction.riskCategory)}</p>}
          <p className="text-sm leading-6 text-slate-600">This research estimate is not a diagnosis. It distinguishes Eustress and Distress, but cannot identify “No Stress”. You can seek support regardless of the result.</p>
          {error && <p role="alert" className="rounded-lg border border-slate-200 bg-white p-3 text-sm">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button className="btn-secondary" disabled={predicting} type="button" onClick={() => setSurveyOpen(!surveyOpen)} aria-expanded={surveyOpen}>{surveyOpen ? "Close check-in" : "Complete / update stress check-in"}</button>
            <button className="dashboard-text-link disabled:opacity-60" disabled={predicting} onClick={generatePrediction} type="button">{predicting ? "Updating summary..." : "Update summary from saved responses"}</button>
          </div>
          {surveyOpen && <StressSurveyForm inOverview onSaved={generatePrediction} />}
          {prediction && <details className="overview-disclosure">
            <summary>About this estimate</summary>
            <p className="mt-4 text-sm text-slate-600">Model probability: {Math.round(prediction.confidence * 100)}% (uncalibrated). Source: {prediction.modelSource === "trained_model" ? "Trained model" : "Fallback predictor"}.</p>
            <div className="mt-4"><ReasonList prediction={prediction} loading={false} /></div>
          </details>}
        </>}
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="surface overflow-hidden">
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="p-6">
            <p className="section-kicker">Wellness estimate</p>
            <h1 className="page-heading mt-2">Your stress check-in</h1>
            <p className="mt-3 max-w-2xl muted-copy">
              Estimate Eustress or Distress from the research survey used by the trained model.
              This is a self-reported stress-type classification, not a diagnosis or a Low/Medium/High risk score.
            </p>
            <button
              className="btn-primary mt-5 inline-flex items-center gap-2"
              disabled={predicting}
              onClick={generatePrediction}
              type="button"
            >
              {predicting ? <RefreshCw className="animate-spin" size={18} /> : <BrainCircuit size={18} />}
              {predicting ? "Generating..." : "Update wellness estimate"}
            </button>
          </div>
          <PredictionCard prediction={prediction} loading={loading} />
        </div>
      </section>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

      <StressSurveyForm onSaved={() => setPrediction(null)} />
      <details className="overview-disclosure"><summary>About your estimate & saved details</summary>
      <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <section className="surface p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-blue-50 text-ocean">
              <Database size={20} aria-hidden="true" />
            </div>
              <div>
                <h3 className="text-lg font-bold">Your saved wellness details</h3>
              <p className="text-sm text-slate-500">These details help personalize conversations. Your stress estimate uses the separate check-in above.</p>
              </div>
          </div>
          <FeatureGrid features={features} loading={loading} />
        </section>

        <section className="surface p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-teal-50 text-sea">
              <ListChecks size={20} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Why this result?</h3>
              <p className="text-sm text-slate-500">Readable signals for counsellor support.</p>
            </div>
          </div>
          <ReasonList prediction={prediction} loading={loading} />
        </section>
      </section>
      </details>
    </div>
  );
}

function PredictionCard({ prediction, loading }) {
  const risk = prediction?.riskCategory || "-";
  const tone =
    risk === "high"
      ? "border-red-100 bg-red-50 text-red-700"
      : risk === "medium"
        ? "border-amber-100 bg-amber-50 text-amber-700"
        : "border-teal-100 bg-teal-50 text-sea";

  return (
    <div className="m-4 rounded-lg border border-slate-200 bg-paper p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-bold text-slate-600">Latest wellness estimate</p>
        <Gauge className="text-sea" size={21} aria-hidden="true" />
      </div>
      {loading ? (
        <p className="text-sm text-slate-500">Loading prediction...</p>
      ) : prediction ? (
        <>
          <div className={`rounded-lg border px-4 py-3 ${tone}`}>
            <p className="text-xs font-bold uppercase">Estimated stress type</p>
            <p className="mt-1 text-3xl font-bold">{titleCase(risk)}</p>
          </div>
          <p className="mt-3 text-sm text-slate-600">Model probability: {Math.round(prediction.confidence * 100)}% (uncalibrated)</p>
          <p className="mt-1 text-sm text-slate-600">
            Source: {prediction.modelSource === "trained_model" ? "Trained ML model" : "Fallback predictor"}
          </p>
        </>
      ) : (
        <p className="rounded-lg bg-white p-4 text-sm leading-6 text-slate-600">
          Your estimate will appear after you complete the optional stress check-in and update your summary.
        </p>
      )}
    </div>
  );
}

function FeatureGrid({ features, loading }) {
  if (loading) {
    return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Loading features...</p>;
  }

  if (!features) {
    return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No feature data available yet.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Object.entries(featureLabels).map(([key, label]) => (
        <div className="rounded-lg border border-slate-200 bg-white p-4" key={key}>
          <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-ink">{formatFeature(features[key])}</p>
        </div>
      ))}
    </div>
  );
}

function ReasonList({ prediction, loading }) {
  if (loading) {
    return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Loading reasons...</p>;
  }

  if (!prediction) {
    return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Generate a prediction to view reasons.</p>;
  }

  return (
    <div className="space-y-3">
      {prediction.reasons.map((reason) => (
        <div className="flex gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700" key={reason}>
          <ChevronRight className="mt-1 shrink-0 text-sea" size={16} aria-hidden="true" />
          {reason}
        </div>
      ))}
    </div>
  );
}

function formatFeature(value) {
  if (value == null) {
    return "-";
  }

  return Number.isInteger(value) ? value : Number(value).toFixed(2).replace(/\.00$/, "");
}

function titleCase(value) {
  return value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
