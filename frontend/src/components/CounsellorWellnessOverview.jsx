import { FileText, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";

// Shared by appointment management and the private session. The API enforces both consent gates.
export default function CounsellorWellnessOverview({ appointment: selectedAppointment }) {
  const [summary, setSummary] = useState(null);
  const summaryRequestVersion = useRef(0);
  const summaryAppointmentId = useRef(null);
  const generationInFlight = useRef(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const [summaryError, setSummaryError] = useState("");

  useEffect(() => {
    const requestState = summaryRequestVersion;
    const version = ++requestState.current;
    setSummaryError("");
    async function loadSummary() {
      if (summaryAppointmentId.current !== selectedAppointment?._id) {
        summaryAppointmentId.current = selectedAppointment?._id || null;
        generationInFlight.current = null;
        setSummaryGenerating(false);
        setSummary(null);
      }
      if (!selectedAppointment?._id || !["pending", "approved"].includes(selectedAppointment.status)) {
        setSummary(selectedAppointment?._id ? { consentGranted: false, appointmentStatus: selectedAppointment.status, message: "Shared wellness information is available only for pending or approved appointments." } : null);
        setSummaryLoading(false);
        return;
      }
      try {
        setSummaryLoading(true);
        const { data } = await api.get(`/counselling/appointments/${selectedAppointment._id}/summary`);
        if (version === summaryRequestVersion.current) setSummary(data.summary);
      } catch (error) {
        if (version === summaryRequestVersion.current) {
          if ([401, 403, 404].includes(error.response?.status)) setSummary({ consentGranted: false, message: error.response?.data?.message || "Shared wellness information is unavailable for this appointment." });
          setSummaryError(error.response?.data?.message || "Unable to refresh the shared overview. The last loaded information is still shown.");
        }
      } finally {
        if (version === summaryRequestVersion.current) setSummaryLoading(false);
      }
    }
    loadSummary();
    return () => { requestState.current++; };
  }, [selectedAppointment?._id, selectedAppointment?.status, selectedAppointment?.shareSummary, selectedAppointment?.concernType, selectedAppointment?.notes, summaryRefresh]);

  useEffect(() => {
    const refreshSummary = () => {
      if (document.visibilityState === "visible" && !generationInFlight.current) setSummaryRefresh(value => value + 1);
    };
    const interval = window.setInterval(refreshSummary, 60000);
    window.addEventListener("focus", refreshSummary);
    document.addEventListener("visibilitychange", refreshSummary);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshSummary);
      document.removeEventListener("visibilitychange", refreshSummary);
    };
  }, []);

  async function refreshOverview() {
    setSummaryError("");
    setSummaryRefresh(value => value + 1);
  }

  async function generateBriefing() {
    if (generationInFlight.current === selectedAppointment?._id || !selectedAppointment?._id) return;
    const generationId = selectedAppointment._id;
    generationInFlight.current = generationId;
    const version = summaryRequestVersion.current;
    setSummaryGenerating(true);
    setSummaryError("");
    try {
      const { data } = await api.post(`/counselling/appointments/${selectedAppointment._id}/summary`, undefined, { timeout: 200000 });
      if (version === summaryRequestVersion.current) setSummary(data.summary);
    } catch (error) {
      if (version === summaryRequestVersion.current) {
        const conflict = error.response?.status === 409;
        setSummaryError(conflict
          ? "Shared information changed during generation. Refresh the overview before trying again."
          : error.response?.data?.message || "The AI briefing could not be generated. Your saved briefing and factual overview are unchanged; retry when the local service is available.");
        // A conflict means the current saved draft may now be stale. Fetch the server's
        // freshness state; ordinary provider failures leave the displayed draft intact.
        if (conflict) setSummaryRefresh(value => value + 1);
      }
    } finally {
      if (generationInFlight.current === generationId) {
        generationInFlight.current = null;
        setSummaryGenerating(false);
      }
    }
  }

  return (
    <section className="surface p-4 sm:p-5" aria-labelledby="wellness-overview-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-teal-50 text-sea"><FileText size={20} aria-hidden="true" /></div>
          <div>
            <h2 id="wellness-overview-heading" className="text-lg font-semibold">Wellness overview</h2>
            <p className="text-sm text-slate-500">Shared records for this appointment</p>
          </div>
        </div>
        {selectedAppointment && <button className="btn-secondary inline-flex min-h-10 items-center gap-2 px-3 py-2" disabled={summaryLoading || summaryGenerating} type="button" onClick={refreshOverview}>
          {summaryLoading ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
          Refresh overview
        </button>}
      </div>
      <SummaryPanel loading={summaryLoading} summary={summary} />
      {summaryError && <p role="alert" className="notice-error mt-4">{summaryError}</p>}
      {summaryGenerating && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="animate-spin" size={16} aria-hidden="true" />Generating briefing. You can continue reviewing the records.</p>}
      {summary?.consentGranted && <div className="mt-4">
        <button className="btn-primary inline-flex items-center gap-2" disabled={summaryLoading || summaryGenerating || !summary.aiSummary?.canGenerate} type="button" onClick={generateBriefing}>
          {summaryGenerating && <Loader2 className="animate-spin" size={16} aria-hidden="true" />}
          {summaryGenerating ? "Generating briefing…" : summary.narrative ? "Regenerate AI briefing" : "Generate AI briefing"}
        </button>
        {!summary.aiSummary?.canGenerate && <p className="mt-2 text-sm text-slate-500">{summary.aiSummary?.message}</p>}
      </div>}
    </section>
  );
}

function SummaryPanel({ loading, summary }) {
  if (loading && !summary) return <LoadingLine text="Loading shared wellness overview" />;
  if (!summary) return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Select an appointment to view its overview.</p>;

  if (!summary.consentGranted) return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <ShieldCheck className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
      <p>{summary.message}</p>
    </div>
  );

  const hasWho5 = Number.isFinite(summary.latestAssessment?.rawScore);
  const trend = Array.isArray(summary.mood?.trend) ? summary.mood.trend : [];
  return <div className="space-y-4">
    {(summary.appointmentConcern?.type || summary.appointmentConcern?.note) && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <p><strong>Appointment focus:</strong> {summary.appointmentConcern?.type ? titleCase(summary.appointmentConcern.type.replaceAll("_", " ")) : "Not specified"}</p>
      {summary.appointmentConcern?.note && <p className="mt-1 whitespace-pre-wrap text-slate-600">Student’s appointment note: {summary.appointmentConcern.note}</p>}
    </div>}

    <section aria-labelledby="factual-metrics-heading">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="factual-metrics-heading" className="text-sm font-semibold text-slate-800">Recorded wellness measures</h3>
        <span className="text-xs text-slate-500">Backend-calculated from shared records</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Average mood" value={summary.mood?.averageMood ?? "Insufficient data"} scale="Scale 1–5" />
        <Metric label="Average stress" value={summary.mood?.averageStress ?? "Insufficient data"} scale="Scale 1–5" tone="amber" />
        <Metric label="WHO-5 raw score" value={hasWho5 ? `${summary.latestAssessment.rawScore}/25` : "Not available"} scale="WHO-5 raw scale: 0–25" tone="ocean" />
      </div>
    </section>

    <section className="rounded-xl border border-teal-200 bg-teal-50/50 p-4" aria-label="AI-assisted pre-session briefing">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="section-kicker">AI-assisted pre-session briefing</p>
          {summary.aiSummary?.stale && <p className="mt-1 text-sm font-medium text-amber-800">Saved briefing is out of date for the current shared records.</p>}
        </div>
        {summary.narrative?.generatedAt && <p className="text-xs text-slate-500">Generated {formatDateTime(summary.narrative.generatedAt)}</p>}
      </div>
      {summary.narrative?.source === "ollama" && summary.narrative?.text ? <>
        <BriefingText text={summary.narrative.text} />
        <p className="mt-2 text-xs text-slate-500">Generated locally with Ollama · {formatDateTime(summary.narrative.generatedAt)}</p>
        {summary.narrative.validation === "unverified" && <p role="note" className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs leading-5 text-amber-900">AI-generated wording is unverified. Review it against source records; it is not a diagnosis.</p>}
      </> : <p className="mt-3 text-sm text-slate-600">{summary.aiSummary?.stale ? "Generate a new briefing to match the current records." : "No relevant information available in a saved AI briefing."}</p>}
      <details className="mt-3 border-t border-teal-200 pt-2 text-sm">
        <summary className="min-h-10 cursor-pointer py-2 font-medium text-teal-900">Briefing coverage and source details</summary>
        <div className="space-y-1 pb-1 text-slate-600">
          <p><strong>Sources:</strong> {summary.dataSources?.length ? summary.dataSources.join(", ") : "No dated records selected"}</p>
          <p><strong>Coverage:</strong> {summary.coverage?.from && summary.coverage?.through ? `${formatDateTime(summary.coverage.from)} to ${formatDateTime(summary.coverage.through)}` : "No dated records available"}</p>
          {summary.generatedAt && <p>Saved briefing generated {formatDateTime(summary.generatedAt)}. Records checked through {formatDateTime(summary.coverage?.through)}.</p>}
          <p>Private assistant conversations and counsellor notes are excluded. Journal context contains authorized themes only.</p>
        </div>
      </details>
    </section>

    <section aria-labelledby="mood-history-heading" className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="mood-history-heading" className="font-semibold">Mood history</h3>
        <span className="text-sm text-slate-500">{summary.mood?.entries || 0} recorded {(summary.mood?.entries || 0) === 1 ? "check-in" : "check-ins"}</span>
      </div>
      {trend.length ? <ul className="mt-3 divide-y divide-slate-100">
        {[...trend].reverse().map((entry, index) => <li key={entry.id || `${entry.date}-${index}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
          <time className="text-slate-600" dateTime={entry.date}>{formatDateTime(entry.date)}</time>
          <span>Mood {entry.moodScore}/5 <span className="px-1 text-slate-300">·</span> Stress {entry.stressLevel}/5</span>
        </li>)}
      </ul> : <p className="mt-2 text-sm text-slate-500">No valid mood check-ins are available.</p>}
    </section>

    {summary.journalSignals?.length > 0 && <section className="rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold">Relevant journal themes</h3>
      <ul className="mt-2 space-y-2">{summary.journalSignals.map((entry, index) => <li key={`${entry.createdAt}-${index}`} className="flex flex-wrap justify-between gap-2 text-sm">
        <span>{entry.themes.map(titleCase).join(", ")}</span><time className="text-slate-500" dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
      </li>)}</ul>
    </section>}

    <details className="rounded-xl border border-slate-200 px-4">
      <summary className="min-h-12 cursor-pointer py-3 font-semibold text-slate-800">Initial assessment</summary>
      <div className="space-y-4 border-t border-slate-100 pb-4 pt-3">
        {summary.latestAssessment ? <section>
          <h4 className="text-sm font-medium">WHO-5 assessment</h4>
          <p className="mt-1 text-sm text-slate-600">{summary.latestAssessment.rawScore}/25 raw score · {summary.latestAssessment.percentageScore}/100 percentage · recorded {formatDateTime(summary.latestAssessment.takenAt)}. The stored application band is “{summary.latestAssessment.resultBand}”; this is not a diagnosis.</p>
          {summary.latestAssessment.answers?.length > 0 && <dl className="mt-3 grid gap-3 sm:grid-cols-2">{summary.latestAssessment.answers.map(item => <div key={item.question} className="rounded-lg bg-slate-50 p-3"><dt className="text-sm font-medium">{item.question}</dt><dd className="mt-1 text-sm text-slate-600">Recorded response: {item.response}/5</dd></div>)}</dl>}
        </section> : <p className="text-sm text-slate-500">No completed WHO-5 assessment is available.</p>}
        {summary.initialAssessment ? <section>
          <h4 className="text-sm font-medium">Student-reported baseline · {formatDateTime(summary.initialAssessment.recordedAt)}</h4>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">{summary.initialAssessment.responses.map(item => <div key={item.id} className="rounded-lg bg-slate-50 p-3"><dt className="text-sm font-medium">{item.label}</dt><dd className="mt-1 text-sm text-slate-600">{item.response}</dd></div>)}</dl>
          {summary.assessmentNote && <p className="mt-3 whitespace-pre-wrap rounded-lg border border-slate-200 p-3 text-sm"><strong>Student-provided note:</strong> {summary.assessmentNote}</p>}
        </section> : <p className="text-sm text-slate-500">No initial wellness assessment is available.</p>}
      </div>
    </details>

    {summary.latestPrediction && <details className="rounded-xl border border-slate-200 px-4">
      <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium">Stored classifier output</summary>
      <p className="border-t border-slate-100 py-3 text-sm text-slate-600">{titleCase(summary.latestPrediction.label)} · recorded {formatDateTime(summary.latestPrediction.createdAt)}. This model-generated indicator is not a clinical diagnosis or severity rating.</p>
    </details>}

    <details className="rounded-xl border border-slate-200 px-4">
      <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium">Data details</summary>
      <div className="space-y-1 border-t border-slate-100 py-3 text-sm text-slate-600">
        <p><strong>Records considered:</strong> {summary.dataSources?.length ? summary.dataSources.join(", ") : "No dated records selected"}</p>
        <p><strong>Date range:</strong> {summary.coverage?.from && summary.coverage?.through ? `${formatDateTime(summary.coverage.from)} to ${formatDateTime(summary.coverage.through)}` : "No dated records available"}</p>
        <p><strong>Valid mood check-ins:</strong> {summary.mood?.entries || 0}</p>
        {summary.mood?.pattern && <p><strong>Mood calculation notes:</strong> {summary.mood.pattern}</p>}
        <p><strong>WHO-5 assessment:</strong> {summary.latestAssessment ? `completed ${formatDateTime(summary.latestAssessment.takenAt)}` : "not available"}</p>
        {summary.latestPrediction && <p><strong>Classifier label:</strong> {titleCase(summary.latestPrediction.label)} · {formatDateTime(summary.latestPrediction.createdAt)}</p>}
      </div>
    </details>
  </div>;
}

function Metric({ label, value, scale, tone = "sea" }) {
  const toneClass = tone === "ocean" ? "text-ocean" : tone === "amber" ? "text-amber" : "text-sea";
  const missing = typeof value === "string" && (value === "Insufficient data" || value === "Not available");
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`mt-1 break-words text-lg font-bold sm:text-xl ${missing ? "text-slate-500" : toneClass}`}>{value}</p>
    <p className="mt-1 text-xs text-slate-500">{scale}</p>
  </div>;
}

function BriefingText({ text }) {
  return <div className="mt-3 space-y-1 break-words text-sm leading-6 text-slate-800">
    {text.split(/\r?\n/u).map((raw, index) => {
      const line = raw.trim();
      if (!line) return <div key={`gap-${index}`} aria-hidden="true" className="h-1" />;
      const heading = line.match(/^(?:#{1,4}\s*)?\*\*(.+?)\*\*:?\s*$/u) || line.match(/^#{1,4}\s+(.+)$/u);
      if (heading) return <h4 key={index} className="pt-1 font-semibold text-teal-900">{heading[1].replace(/\*\*/gu, "")}</h4>;
      const bullet = line.match(/^[-*]\s+(.+)$/u);
      return <p key={index} className={bullet ? "pl-3" : ""}>{renderEmphasis(bullet?.[1] || line, index)}</p>;
    })}
  </div>;
}

function renderEmphasis(text, key) {
  return text.split(/(\*\*[^*]+\*\*)/u).map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <strong key={`${key}-${index}`}>{part.slice(2, -2)}</strong>
    : part);
}

function LoadingLine({ text }) {
  return <div role="status" className="flex items-center gap-2 rounded-lg bg-slate-50 p-4 text-sm text-slate-600"><Loader2 className="animate-spin" size={17} aria-hidden="true" />{text}</div>;
}

function formatDateTime(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Not available";
  return new Intl.DateTimeFormat("en", { day: "2-digit", hour: "numeric", minute: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function titleCase(value) { return String(value || "").split(" ").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }
