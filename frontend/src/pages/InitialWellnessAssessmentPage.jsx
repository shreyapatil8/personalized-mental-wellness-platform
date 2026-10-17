import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { HeartPulse, CheckCircle2 } from "lucide-react";
import { api } from "../api/client.js";
import { useAuth } from "../context/useAuth.js";

const primaryButton = "btn-primary inline-flex items-center justify-center";

export default function InitialWellnessAssessmentPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [contract, setContract] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [responses, setResponses] = useState({});
  const [mode, setMode] = useState("loading");
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const heading = useRef(null);

  useEffect(() => {
    if (user.role !== "student") return;
    let active = true;
    setMode("loading");
    setError("");
    api.get("/profile/me/initial-assessment").then(({ data }) => {
      if (!active) return;
      if (data.assessment && location.state?.fromLogin) {
        navigate("/", { replace: true });
        return;
      }
      setContract(data.contract);
      setAssessment(data.assessment);
      setResponses(data.assessment?.responses || {});
      setMode(data.assessment ? "review" : "invitation");
    }).catch(() => {
      if (!active) return;
      setError("We couldn't load your assessment. Please try again, or continue to your dashboard.");
      setMode("load-error");
    });
    return () => { active = false; };
  }, [user.role, location.state?.fromLogin, navigate, attempt]);

  useEffect(() => { heading.current?.focus(); }, [mode, index]);

  if (user.role !== "student") return <Navigate to="/" replace />;

  const questions = contract?.questions || [];
  const question = questions[index];

  function start() {
    setIndex(0);
    setError("");
    setMode("questions");
  }

  async function next(event) {
    event.preventDefault();
    if (saving) return;
    setError("");
    if (!question.optional && !question.options.includes(responses[question.id])) {
      setError("Please choose a response before continuing.");
      return;
    }
    if (index < questions.length - 1) {
      setIndex(index + 1);
      return;
    }
    const missing = questions.findIndex((item) => !item.optional && !item.options.includes(responses[item.id]));
    if (missing !== -1) {
      setIndex(missing);
      setError("Please answer this question before submitting.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put("/profile/me/initial-assessment", { schemaVersion: contract.version, responses });
      setAssessment(data.assessment);
      setResponses(data.assessment.responses);
      setMode("complete");
    } catch (err) {
      setError(err.response?.data?.issues?.[0]?.message || "We couldn't save your assessment. Your answers are still here. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-mist px-4 py-6 text-slate-800 sm:py-10" style={{ colorScheme: "light" }}>
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <Link to="/" className="inline-flex items-center gap-2 font-bold text-teal-800"><HeartPulse aria-hidden="true" size={23} /> Wellspace</Link>
          <Link to="/" className="text-sm text-slate-600 underline underline-offset-4">Dashboard</Link>
        </header>
        <section className="rounded-2xl border border-teal-100 bg-white p-5 shadow-sm sm:p-9" aria-busy={saving || mode === "loading"}>
          {mode === "loading" && <p role="status">Loading your wellness assessment...</p>}
          {mode === "load-error" && <>
            <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold">Your wellness assessment</h1>
            <p role="alert" className="mt-4 text-slate-700">{error}</p>
            <button className={`${primaryButton} mt-6`} onClick={() => setAttempt(attempt + 1)}>Try again</button>
            <Link className="btn-secondary ml-3 inline-flex" to="/">Continue to Dashboard</Link>
          </>}
          {mode === "invitation" && <>
            <p className="section-kicker">A moment for you</p>
            <h1 ref={heading} tabIndex={-1} className="page-heading mt-3">A check-in, just for you</h1>
            <p className="mt-5 leading-7 text-slate-600">This short assessment helps us understand your current wellness and daily experiences. Your responses will help create your personalized wellness profile and can be shared with your counsellor when you give consent.</p>
            <p className="mt-4 text-sm leading-6 text-slate-600">There are 15 steps: 14 required questions and one optional space to share more. There are no right or wrong answers. This is a personal check-in, not a medical diagnosis or clinical test.</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button className={primaryButton} onClick={start}>Start Assessment</button>
              <Link className="btn-secondary inline-flex items-center justify-center" to="/" replace>Skip for Now</Link>
            </div>
            <p className="mt-4 text-sm text-slate-500">You can return from your dashboard whenever you're ready.</p>
          </>}
          {mode === "questions" && <>
            <div className="mb-7">
              <p className="text-sm font-semibold text-teal-800" aria-live="polite">Question {index + 1} of {questions.length}</p>
              <progress aria-label="Assessment progress" max={questions.length} value={index + 1} className="mt-3 h-2 w-full overflow-hidden rounded-full accent-teal-600 [&::-webkit-progress-bar]:bg-teal-50 [&::-webkit-progress-value]:bg-teal-600 [&::-moz-progress-bar]:bg-teal-600" />
            </div>
            <form onSubmit={next} noValidate>
              <h1 ref={heading} tabIndex={-1} id="assessment-question" className="text-2xl font-semibold leading-snug">{question.label}</h1>
              {!question.optional && <p className="mt-3 text-sm text-slate-600">Choose one answer · Required</p>}
              {question.optional ? <div className="mt-5">
                <p id="notes-hint" className="mb-3 text-sm text-slate-600">Optional. Share only what you feel comfortable sharing (up to {question.maxLength} characters).</p>
                <textarea aria-labelledby="assessment-question" aria-describedby="notes-hint" className="input min-h-40 resize-y" maxLength={question.maxLength} disabled={saving} value={responses[question.id] || ""} onChange={(event) => setResponses((current) => ({ ...current, [question.id]: event.target.value }))} />
              </div> : <fieldset className="mt-6 space-y-3" aria-labelledby="assessment-question" disabled={saving}>
                {question.options.map((option) => <label key={`${question.id}-${option}`} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition focus-within:ring-2 focus-within:ring-teal-600 ${responses[question.id] === option ? "border-teal-400 bg-teal-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                  <input className="h-4 w-4 shrink-0 accent-teal-700" type="radio" name={question.id} value={option} checked={responses[question.id] === option} required onChange={() => { setResponses((current) => ({ ...current, [question.id]: option })); setError(""); }} />
                  <span className="text-base">{option}</span>
                </label>)}
              </fieldset>}
              {error && <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800">{error}</p>}
              <div className="mt-8 flex items-center justify-between gap-3">
                <button type="button" className="btn-secondary" disabled={saving} onClick={() => { setError(""); if (index > 0) setIndex(index - 1); else setMode(assessment ? "review" : "invitation"); }}>Back</button>
                <button className={primaryButton} type="submit" disabled={saving}>{saving ? "Saving..." : index === questions.length - 1 ? "Submit Assessment" : "Next"}</button>
              </div>
              <p className="mt-5 text-sm leading-6 text-slate-500">Your responses are saved when you submit. You can go back to change any answer.</p>
            </form>
          </>}
          {mode === "complete" && <>
            <CheckCircle2 className="mb-4 text-teal-700" size={36} aria-hidden="true" />
            <h1 ref={heading} tabIndex={-1} className="text-3xl font-bold">Assessment complete</h1>
            <p role="status" className="mt-4 leading-7 text-slate-600">Thank you for sharing. Your responses have been saved to your wellness profile. You can view or update them anytime from your dashboard.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link className={primaryButton} to="/" replace>Continue to Dashboard</Link>
              <button className="btn-secondary" onClick={() => setMode("review")}>View responses</button>
            </div>
          </>}
          {mode === "review" && <>
            <h1 ref={heading} tabIndex={-1} className="text-3xl font-bold">Your wellness assessment</h1>
            <p className="mt-3 text-sm text-slate-600">Last updated {new Date(assessment.updatedAt).toLocaleDateString()}. These are your own reflections, not a diagnosis.</p>
            <div className="my-6 flex flex-wrap gap-3">
              <button className={primaryButton} onClick={start}>Update Assessment</button>
              <Link className="btn-secondary inline-flex items-center" to="/">Continue to Dashboard</Link>
            </div>
            <dl className="space-y-5">
              {questions.map((item, number) => <div key={item.id} className="border-t border-slate-100 pt-5">
                <dt className="font-medium">{number + 1}. {item.label}</dt>
                <dd className="mt-2 whitespace-pre-wrap break-words text-slate-600">{assessment.responses[item.id] || "Not provided (optional)"}</dd>
              </div>)}
            </dl>
          </>}
        </section>
      </div>
    </main>
  );
}
