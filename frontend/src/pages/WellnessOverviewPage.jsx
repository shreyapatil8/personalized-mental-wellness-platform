import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../context/useAuth.js";
import InitialAssessmentCard from "../components/InitialAssessmentCard.jsx";
import StressSurveyForm from "../components/StressSurveyForm.jsx";

const WellnessCharts = lazy(() => import("../components/WellnessCharts.jsx"));

export default function WellnessOverviewPage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [estimateError, setEstimateError] = useState("");
  const [updatingEstimate, setUpdatingEstimate] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const request = useRef({ sequence: 0 });

  const loadOverview = useCallback(async () => {
    const current = ++request.current.sequence;
    setRefreshing(true);
    setError("");
    try {
      const { data } = await api.get("/dashboard/me");
      if (current === request.current.sequence) setDashboard(data.dashboard);
    } catch {
      if (current === request.current.sequence) setError("We couldn't load your overview. Please try again.");
    } finally {
      if (current === request.current.sequence) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    const pendingRequests = request.current;
    setDashboard(null);
    setLoading(true);
    if (user.role !== "student") return;
    loadOverview();
    // Revalidate with the existing service after changes in another tab.
    const onVisible = () => { if (document.visibilityState === "visible") loadOverview(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      pendingRequests.sequence++;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user.id, user.role, loadOverview]);

  async function updateEstimate() {
    setUpdatingEstimate(true);
    setEstimateError("");
    // Changed survey responses invalidate the previous estimate on the server.
    setDashboard((current) => current && ({ ...current, overview: { ...current.overview, latestPrediction: null } }));
    try {
      await api.post("/predictions/me");
    } catch (failure) {
      setEstimateError(failure.response?.status === 422
        ? "Complete or update the stress check-in below before updating your estimate."
        : "Your estimate couldn't be updated. You can try again; your saved check-ins are still available.");
    } finally {
      await loadOverview();
      setUpdatingEstimate(false);
    }
  }

  if (user.role !== "student") return <Navigate to="/" replace />;
  const overview = dashboard?.overview || {};
  const baseline = dashboard?.profile?.initialWellnessAssessment;
  const goals = dashboard?.profile?.wellnessGoals || [];
  const mood = overview.moodSummary || {};
  const latestMood = mood.trend?.at(-1);
  const who5 = overview.latestAssessment;
  // The server validates survey age, ownership, model compatibility and changed inputs.
  // Hide cached estimates when their validity cannot be checked.
  const prediction = !error && !refreshing && !updatingEstimate ? overview.latestPrediction : null;
  const estimateCopy = {
    distress: "Your responses suggest stress may feel difficult to manage.",
    eustress: "Your responses suggest stress may feel motivating or manageable."
  }[prediction?.riskCategory?.toLowerCase()];

  return (
    <div className="wellness-overview mx-auto max-w-4xl space-y-8">
      <header>
        <Link className="dashboard-text-link" to="/">Back to home</Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Wellness Overview</h1>
        <p className="mt-3 leading-7 text-slate-600">A little space to notice how you've been feeling. There is no pace to keep up with.</p>
      </header>
      {error && <div role="alert" className="notice">{error}{dashboard && " Your last loaded check-ins are still shown; your estimate is hidden until it can be checked."}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Your wellness snapshot</h2>
        <button className="dashboard-text-link disabled:opacity-60" disabled={refreshing} onClick={loadOverview} type="button">{refreshing ? "Refreshing..." : error ? "Try again" : "Refresh"}</button>
      </div>
      {loading ? <p role="status" className="muted-copy">Loading your overview...</p> : dashboard && <>
        <section aria-label="Your recent check-in and goals" className="rounded-2xl bg-[#edf5f1] p-6 sm:p-8">
          <p className="leading-7 text-slate-700">{latestMood
            ? <>Your most recent mood check-in was <strong className="font-medium">{moodLabel(latestMood.moodScore)}</strong> on <SavedDate value={latestMood.date} />. Each check-in is a moment in time, not a label for you.</>
            : "You can start with a mood check-in or an assessment, whenever you're ready. Your reflections will build a picture over time."}</p>
          {goals.length > 0 && <div className="mt-5"><h3 className="font-medium">What you'd like to work on</h3><ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700">{goals.slice(0, 3).map((goal, index) => <li key={index}>{goal}</li>)}</ul><Link className="dashboard-text-link mt-2" to="/profile">{goals.length > 3 ? "View all your goals" : "Review your wellness profile"}</Link></div>}
          <Link className="dashboard-primary mt-5" to="/assistant">Talk to your Wellness Assistant</Link>
        </section>

        <section aria-labelledby="mood-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="mood-heading" className="text-xl font-semibold">Your recent mood trend</h2><Link className="dashboard-text-link" to="/tracking?tab=mood">Add Mood Check-in</Link></div>
          {mood.entries > 0 ? <>
            <p className="text-sm leading-6 text-slate-600"><span className="font-medium text-slate-800">Average mood: {mood.averageMood} / 5</span> across your latest {mood.entries} {mood.entries === 1 ? "check-in" : "check-ins"} (up to 14). This describes your recorded moments, not a wellness score.</p>
          </> : <p className="rounded-xl border border-slate-200 bg-white p-5 leading-7 text-slate-600">No mood check-ins yet. Your first check-in starts your history; you can add one whenever it feels helpful.</p>}
          {(mood.entries > 0 || dashboard.trend?.wellnessDaily?.length > 0) && <Suspense fallback={<p role="status" className="muted-copy">Loading your mood trend...</p>}><WellnessCharts trend={dashboard.trend} /></Suspense>}
        </section>

        <InitialAssessmentCard assessment={baseline} showSummary />

        <section aria-labelledby="progress-heading" className="border-y border-slate-200 py-6">
          <h2 id="progress-heading" className="text-xl font-semibold">Your reflections over time</h2>
          <p className="mt-2 muted-copy">These are the moments you've made space for, not targets to meet.</p>
          <dl className="mt-5 grid gap-6 sm:grid-cols-3">
            <ProgressItem label="Recent mood check-ins" value={mood.entries || 0} note="Up to your latest 14 entries" />
            <ProgressItem label="Journal reflections" value={overview.journalEntryCount || 0} note="Your saved entries; their contents stay in Journal" />
            <ProgressItem label="Wellness assessment" value={baseline ? "Completed" : "At your own pace"} note={baseline ? <>First completed <SavedDate value={baseline.completedAt} /></> : "You can complete it when you're ready"} />
          </dl>
          <p className="mt-5 muted-copy">{overview.journalEntryCount ? "Writing can give you a place to reflect. Open Journal to revisit your entries or start a new one." : "There's nothing in your journal yet. When you're ready, you can write down what's on your mind."}</p>
          <Link className="dashboard-text-link mt-2" to="/tracking?tab=journal">Write in Journal</Link>
        </section>

        <details className="overview-disclosure">
          <summary>Your short well-being check-in (WHO-5)</summary>
          {who5 ? <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
            <p>Last completed <SavedDate value={who5.takenAt} />. This separate five-question check-in reflects the preceding two weeks.</p>
            <p><span className="font-medium text-slate-800">WHO-5 check-in: {who5.percentageScore} / 100.</span> Higher values reflect more frequently reported positive well-being in those responses. This is not a diagnosis or an overall wellness grade.</p>
          </div> : <p className="mt-3 muted-copy">You haven't taken this optional short check-in yet. It is separate from your initial wellness assessment.</p>}
          <Link className="dashboard-text-link mt-3" to="/tracking?tab=assessment">{who5 ? "View / update WHO-5 check-in" : "Take a short well-being check-in"}</Link>
        </details>

        <section aria-labelledby="estimate-heading" className="space-y-3">
          <h2 id="estimate-heading" className="text-xl font-semibold">Your wellness estimate</h2>
          {refreshing || updatingEstimate ? <p role="status" className="muted-copy">Checking your current estimate...</p> : error ? <p className="muted-copy">Your estimate will appear once your overview can be refreshed.</p> : estimateCopy ? <>
            <p className="leading-7 text-slate-700">{estimateCopy}</p>
            <p className="muted-copy">Based on your saved stress check-in. Updated <SavedDate value={prediction.createdAt} />.</p>
          </> : <p className="muted-copy">No current estimate is available. Your other check-ins still help you reflect; the stress check-in is optional.</p>}
          <p className="muted-copy">This is an estimate, not a diagnosis, and only one part of your wellness picture. It cannot tell you that you have no stress. How you feel matters more than a category.</p>
          {estimateError && <p role="alert" className="notice">{estimateError}</p>}
          <details className="overview-disclosure" onToggle={(event) => setSurveyOpen(event.currentTarget.open)}>
            <summary>Complete or update your stress check-in</summary>
            {surveyOpen && <div className="mt-4 space-y-4">
              <p className="muted-copy">This optional check-in is separate from your initial assessment. Updating your responses replaces the previous estimate when a new one is available.</p>
              <button className="btn-secondary" disabled={updatingEstimate} onClick={updateEstimate} type="button">{updatingEstimate ? "Updating estimate..." : "Update estimate from saved responses"}</button>
              <StressSurveyForm inOverview onSaved={updateEstimate} />
            </div>}
          </details>
        </section>

        <section aria-labelledby="support-heading" className="pb-4">
          <h2 id="support-heading" className="text-xl font-semibold">Support, whenever you'd like it</h2>
          <p className="mt-2 muted-copy">You don't need a particular result or reason to talk with someone. A counsellor can help you explore what would feel useful.</p>
          <Link className="dashboard-text-link mt-2" to="/counselling">Talk with a counsellor / Book Counselling</Link>
        </section>
      </>}
    </div>
  );
}

function SavedDate({ value }) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? <time dateTime={date.toISOString()}>{date.toLocaleDateString(undefined, { dateStyle: "medium" })}</time> : "Date not recorded";
}

function ProgressItem({ label, value, note }) {
  return <div><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-2"><span className="text-lg font-medium">{value}</span><p className="mt-2 text-sm leading-6 text-slate-600">{note}</p></dd></div>;
}

function moodLabel(value) {
  return { 1: "very_low", 2: "low", 3: "neutral", 4: "good", 5: "great" }[value]?.replaceAll("_", " ") || "recorded";
}
