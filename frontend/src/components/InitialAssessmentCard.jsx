import { Link } from "react-router-dom";
import assessmentContract from "../../../shared/initialWellnessAssessment.json";

export default function InitialAssessmentCard({ assessment, showSummary = false }) {
  const summaryFields = ["overallWellbeing", "stressFrequency", "primaryConcern", "preferredSupport"];
  const responses = assessment?.responses || {};
  const savedAt = assessment?.updatedAt || assessment?.completedAt;
  return (
    <section className="rounded-xl border border-teal-200 bg-teal-50 p-5">
      <h2 className="text-lg font-semibold text-teal-900">{assessment ? "Your wellness assessment" : "Complete Your Wellness Assessment"}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {assessment ? "Your reflections are saved in your wellness profile. View them or update them as things change." : "Share how you've been feeling and what support would help. You can complete this whenever you're ready."}
      </p>
      {showSummary && assessment && <>
        {savedAt && <p className="mt-3 text-sm text-slate-600">Last updated <time dateTime={savedAt}>{new Date(savedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</time>. This reflects how you felt when you answered.</p>}
        <dl className="mt-5 grid gap-5 sm:grid-cols-2">
          {summaryFields.map((id) => responses[id] && <div key={id}>
            <dt className="text-sm text-slate-600">{{ overallWellbeing: "How you were feeling", stressFrequency: "How often you felt under pressure", primaryConcern: "What was on your mind", preferredSupport: "Support you wanted" }[id]}</dt>
            <dd className="mt-1 font-medium text-slate-800">{responses[id]}</dd>
          </div>)}
        </dl>
        <details className="overview-disclosure mt-4">
          <summary>More of your assessment responses</summary>
          <dl className="mt-3 space-y-4">
            {assessmentContract.questions.filter(({ id, optional }) => !optional && !summaryFields.includes(id) && responses[id]).map(({ id, label }) => <div key={id}>
              <dt className="text-sm text-slate-600">{label}</dt><dd className="mt-1 text-sm font-medium">{responses[id]}</dd>
            </div>)}
          </dl>
          <p className="mt-4 text-sm text-slate-600">Any additional notes stay in your assessment; they aren't displayed here.</p>
        </details>
      </>}
      <Link className="btn-secondary mt-4 inline-flex" to="/wellness-assessment">{assessment ? "View / Update Assessment" : "Start Assessment"}</Link>
    </section>
  );
}
