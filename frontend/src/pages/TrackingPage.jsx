import {
  Activity,
  BarChart3,
  BookOpenText,
  CalendarDays,
  ClipboardCheck,
  Save,
  SmilePlus,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api } from "../api/client.js";
import { useAuth } from "../context/useAuth.js";

const tabs = [
  { id: "mood", label: "Mood", icon: Activity },
  { id: "journal", label: "Journal", icon: BookOpenText },
  { id: "assessment", label: "Wellbeing", icon: ClipboardCheck }
];

const moodOptions = [
  { value: "very_low", label: "Very low" },
  { value: "low", label: "Low" },
  { value: "neutral", label: "Neutral" },
  { value: "good", label: "Good" },
  { value: "great", label: "Great" }
];

const who5Labels = [
  "At no time",
  "Some of the time",
  "Less than half",
  "More than half",
  "Most of the time",
  "All of the time"
];

export default function TrackingPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabs.some((tab) => tab.id === searchParams.get("tab")) ? searchParams.get("tab") : "mood";

  function setActiveTab(tab) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("tab", tab);
      return next;
    });
  }
  const [moodLogs, setMoodLogs] = useState([]);
  const [journals, setJournals] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function refreshData() {
    try {
      setError("");
      const [moodsResult, journalsResult, assessmentsResult, summaryResult] = await Promise.all([
        api.get("/tracking/moods"),
        api.get("/tracking/journals"),
        api.get("/tracking/assessments"),
        api.get("/tracking/summary")
      ]);

      setMoodLogs(moodsResult.data.moodLogs);
      setJournals(journalsResult.data.journalEntries);
      setAssessments(assessmentsResult.data.assessments);
      setSummary(summaryResult.data);
    } catch {
      setError("We couldn’t load your check-ins. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user.role === "student") {
      refreshData();
    }
  }, [user.role]);

  useEffect(() => { setStatus(""); setError(""); }, [activeTab]);

  if (user.role !== "student") {
    return (
      <section className="rounded-lg border border-teal-900/10 bg-white p-6 shadow-soft">
        <h2 className="text-xl font-semibold">Student wellness tracking</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          This workspace is available for student accounts. Counsellors and admins use their own protected views.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <header className="tracking-welcome">
        <p className="section-kicker">A moment for you</p>
        <h1 className="page-heading mt-2">{activeTab === "mood" ? "How are you feeling?" : activeTab === "journal" ? "Room for your thoughts" : "Your wellbeing check-in"}</h1>
        <p className="mt-3 muted-copy">{activeTab === "mood" ? "Check in with today. Every feeling has a place here." : activeTab === "journal" ? "You don't need the right words. Start with what's on your mind." : "Reflect on the past two weeks, at your own pace."}</p>
      </header>
      <section className="tracking-tabs surface p-1.5">
        <div className="grid grid-cols-3 gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                className={`tracking-tab flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-2 py-2.5 text-sm font-semibold transition ${
                  isActive ? "bg-teal-50 text-teal-900" : "text-slate-600 hover:bg-slate-50"
                }`}
                aria-pressed={isActive}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <Icon className="hidden shrink-0 sm:block" size={18} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {status && <p role="status" className="notice-success">{status}</p>}
      {error && <p role="alert" className="notice-error">{error} <button className="dashboard-text-link" onClick={refreshData}>Try again</button></p>}
      {loading && <p role="status" className="muted-copy">Loading your saved check-ins…</p>}

      {!loading && activeTab === "mood" && (
        <MoodPanel moodLogs={moodLogs} onRefresh={refreshData} setStatus={setStatus} setError={setError} summary={summary} />
      )}
      {!loading && activeTab === "journal" && (
        <JournalPanel journals={journals} onRefresh={refreshData} setStatus={setStatus} setError={setError} />
      )}
      {activeTab === "mood" && <details className="overview-disclosure"><summary>Recent check-in averages</summary><SummaryStrip summary={summary} /></details>}
      {!loading && activeTab === "assessment" && (
        <AssessmentPanel assessments={assessments} onRefresh={refreshData} setStatus={setStatus} setError={setError} />
      )}
    </div>
  );
}

function SummaryStrip({ summary }) {
  const latest = summary?.latestAssessment;
  return (
    <div className="grid min-w-full gap-3 sm:grid-cols-3">
      <Metric label="Avg mood" value={summary?.mood?.averageMood ?? "-"} />
      <Metric label="Avg stress" value={summary?.mood?.averageStress ?? "-"} />
      <Metric label="WHO-5 score" value={latest ? `${latest.percentageScore}/100` : "-"} />
    </div>
  );
}

function Metric({ label, value, tone }) {
  const toneClass =
    tone === "high" ? "text-red-700" : tone === "moderate" ? "text-amber-700" : tone === "low" ? "text-sea" : "text-ink";

  return (
    <div className="rounded-lg border border-slate-200 bg-paper px-4 py-3">
      <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function MoodPanel({ moodLogs, onRefresh, setStatus, setError, summary }) {
  const [form, setForm] = useState({
    mood: "neutral",
    stressLevel: 3,
    sleepHours: 7,
    note: ""
  });

  const [saving, setSaving] = useState(false);

  async function saveMood(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(""); setStatus("");
    try {
      await api.post("/tracking/moods", form);
      setForm({ mood: "neutral", stressLevel: 3, sleepHours: 7, note: "" });
      setStatus("Thanks for checking in. Your mood has been recorded.");
      await onRefresh();
    } catch {
      setError("We couldn’t save your mood log. Your answers are still here. Please try again.");
    } finally { setSaving(false); }
  }

  async function deleteMood(id) {
    setError(""); setStatus("");
    try {
      await api.delete(`/tracking/moods/${id}`);
      setStatus("Entry deleted.");
      await onRefresh();
    } catch { setError("We couldn’t delete this entry. Please try again."); }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <section className="surface p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-coral/10 text-coral">
            <SmilePlus size={20} aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Mood Check-in</h2>
            <p className="text-sm text-slate-500">A quick check-in for today.</p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={saveMood}>
          <fieldset>
            <legend className="mb-3 text-sm font-medium text-slate-700">Your mood today</legend>
            <div className="grid grid-cols-2 gap-2 min-[430px]:grid-cols-3">{moodOptions.map((option) => <label key={option.value} className={`mood-option flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${form.mood === option.value ? "border-sea bg-teal-50 text-teal-900" : "border-slate-300 bg-paper hover:bg-teal-50/50"}`}>
              <input type="radio" name="mood" value={option.value} checked={form.mood === option.value} onChange={() => setForm((current) => ({ ...current, mood: option.value }))} />{option.label}
            </label>)}</div>
          </fieldset>
          <RangeField label="Stress level" max={5} min={1} name="stressLevel" setForm={setForm} value={form.stressLevel} />
          <RangeField label="Sleep hours" max={16} min={0} name="sleepHours" setForm={setForm} value={form.sleepHours} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Note (optional)</span>
            <textarea
              className="input min-h-24 resize-y"
              onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
              placeholder="What affected your mood today?"
              value={form.note}
            />
          </label>
          <button className="btn-primary inline-flex items-center gap-2" disabled={saving} type="submit">
            <Save size={18} aria-hidden="true" />
            {saving ? "Saving…" : "Save mood"}
          </button>
        </form>
      </section>

      <section className="mood-history surface p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">14-day trend</h2>
          <BarChart3 className="text-sea" size={22} aria-hidden="true" />
        </div>
        <TrendBars trend={summary?.mood?.trend || []} />
        <EntryList
          emptyText="Your first check-in starts here, whenever you’re ready."
          items={moodLogs}
          onDelete={deleteMood}
          renderItem={(item) => (
            <>
              <p className="font-semibold">{titleCase(item.mood.replace("_", " "))}</p>
              <p className="text-sm text-slate-600">
                Stress {item.stressLevel}/5 {item.sleepHours != null ? `- Sleep ${item.sleepHours}h` : ""}
              </p>
              {item.note && <p className="mt-2 text-sm leading-6 text-slate-600">{item.note}</p>}
            </>
          )}
        />
      </section>
    </div>
  );
}

function JournalPanel({ journals, onRefresh, setStatus, setError }) {
  const [form, setForm] = useState({
    title: "",
    content: "",
    tags: "",
    sentiment: "unrated"
  });

  const [saving, setSaving] = useState(false);

  async function saveJournal(event) {
    event.preventDefault();
    if (saving) return;
    if (!form.content.trim()) {
      setStatus("");
      setError("Please write a reflection before saving your journal.");
      return;
    }
    setSaving(true); setError(""); setStatus("");
    try {
      await api.post("/tracking/journals", {
        ...form,
        tags: form.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      });
      setForm({ title: "", content: "", tags: "", sentiment: "unrated" });
      setStatus("Your reflection has been saved. Take your time.");
      await onRefresh();
    } catch {
      setError("We couldn’t save your journal entry. Your answers are still here. Please try again.");
    } finally { setSaving(false); }
  }

  async function deleteJournal(id) {
    setError(""); setStatus("");
    try {
      await api.delete(`/tracking/journals/${id}`);
      setStatus("Entry deleted.");
      await onRefresh();
    } catch { setError("We couldn’t delete this entry. Please try again."); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <section className="journal-editor surface p-5 sm:p-6">
        <h2 className="text-lg font-bold">New journal entry</h2>
        <p className="mt-1 text-sm text-slate-500">Share only what feels comfortable. Counsellor sharing follows your consent settings.</p>
        <form className="mt-4 space-y-4" onSubmit={saveJournal}>
          <TextField label="Title (optional)" name="title" setForm={setForm} value={form.title} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Reflection</span>
            <textarea
              className="journal-input input min-h-56 resize-y sm:min-h-64"
              placeholder="Today, I’ve been thinking about…"
              onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
              required
              value={form.content}
            />
          </label>
          <details className="overview-disclosure"><summary>Add tags or a feeling (optional)</summary>
          <TextField label="Tags" name="tags" placeholder="exam, sleep, friends" setForm={setForm} value={form.tags} />
          <SelectField
            label="How this felt"
            name="sentiment"
            options={[
              { value: "unrated", label: "Prefer not to label" },
              { value: "positive", label: "Positive" },
              { value: "mixed", label: "Mixed" },
              { value: "negative", label: "Difficult" }
            ]}
            setForm={setForm}
            value={form.sentiment}
          />
          </details>
          <div className="flex flex-wrap gap-3">
          <button className="btn-primary inline-flex items-center gap-2" disabled={saving} type="submit">
            <Save size={18} aria-hidden="true" />
            {saving ? "Saving…" : "Save journal"}
          </button>
          <button className="btn-secondary" disabled={saving} type="button" onClick={() => setForm({ title: "", content: "", tags: "", sentiment: "unrated" })}>Clear draft</button>
          </div>
        </form>
      </section>

      <section className="surface p-5">
        <h2 className="mb-4 text-lg font-bold">Recent reflections</h2>
        <EntryList
          emptyText="When you’re ready, you can write down what’s on your mind."
          items={journals}
          onDelete={deleteJournal}
          renderItem={(item) => (
            <>
              <p className="font-semibold">{item.title || "Untitled reflection"}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-base leading-7 text-slate-600">{item.content}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {titleCase(item.sentiment)}
                </span>
                {item.tags?.map((tag) => (
                  <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-sea" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </>
          )}
        />
      </section>
    </div>
  );
}

function AssessmentPanel({ assessments, onRefresh, setStatus, setError }) {
  const [responses, setResponses] = useState([3, 3, 3, 3, 3]);

  const currentPreview = useMemo(() => {
    const raw = responses.reduce((sum, item) => sum + Number(item), 0);
    const percentage = raw * 4;
    const riskLevel = percentage < 32 ? "high" : percentage < 52 ? "moderate" : "low";
    return { raw, percentage, riskLevel };
  }, [responses]);

  const [saving, setSaving] = useState(false);

  async function saveAssessment(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(""); setStatus("");
    try {
      await api.post("/tracking/assessments", { responses });
      setStatus("Assessment saved.");
      await onRefresh();
    } catch {
      setError("We couldn’t save your assessment. Your answers are still here. Please try again.");
    } finally { setSaving(false); }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <section className="surface p-5">
        <h2 className="text-lg font-bold">WHO-5 wellness assessment</h2>
        <p className="mt-1 text-sm text-slate-500">Choose the answer that best matches the last two weeks.</p>
        <p className="mt-2 text-sm text-slate-600">Higher scores indicate better reported well-being. Support flags are app heuristics, not clinical risk levels or a diagnosis.</p>
        <form className="mt-4 space-y-5" onSubmit={saveAssessment}>
          {[
            "I have felt cheerful and in good spirits.",
            "I have felt calm and relaxed.",
            "I have felt active and vigorous.",
            "I woke up feeling fresh and rested.",
            "My daily life has been filled with things that interest me."
          ].map((question, index) => (
            <label className="block rounded-lg border border-slate-200 bg-paper p-4" key={question}>
              <span className="block text-sm font-semibold text-ink">{question}</span>
              <select
                className="input mt-3"
                onChange={(event) =>
                  setResponses((current) => current.map((value, itemIndex) => (itemIndex === index ? Number(event.target.value) : value)))
                }
                value={responses[index]}
              >
                {who5Labels.map((label, value) => (
                  <option key={label} value={value}>
                    {value} - {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button className="btn-primary inline-flex items-center gap-2" disabled={saving} type="submit">
            <ClipboardCheck size={18} aria-hidden="true" />
            {saving ? "Saving…" : "Save assessment"}
          </button>
        </form>
      </section>

      <aside className="space-y-5">
        <section className="surface p-5">
          <h2 className="text-lg font-bold">Current score</h2>
          <p className="mt-4 text-5xl font-bold text-sea">{currentPreview.percentage}</p>
          <p className="mt-1 text-sm text-slate-600">Raw score {currentPreview.raw}/25</p>
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            App support flag: {titleCase(currentPreview.riskLevel)} (heuristic)
          </p>
        </section>
        <section className="surface p-5">
          <h2 className="mb-4 text-lg font-bold">Assessment history</h2>
          <div className="space-y-3">
            {assessments.length === 0 ? (
              <p className="text-sm text-slate-500">No assessments yet.</p>
            ) : (
              assessments.map((item) => (
                <div className="rounded-lg border border-slate-200 p-3" key={item._id}>
                  <p className="font-semibold">{item.percentageScore}/100</p>
                  <p className="text-sm text-slate-600">
                    {formatDate(item.takenAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

function TrendBars({ trend }) {
  if (!trend.length) {
    return <p className="mb-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Your mood patterns will appear as you check in.</p>;
  }

  const visibleTrend = trend.slice(-14);
  return (
    <div
      className="mood-trend mb-5 flex items-end justify-center gap-1.5 rounded-xl bg-[#F5F3ED] p-4 sm:gap-2"
      role="img"
      aria-label={`Mood trend across ${visibleTrend.length} recorded check-ins: ${visibleTrend.map((item) => `${formatDate(item.date)}, mood ${item.moodScore} out of 5`).join("; ")}`}
    >
      {visibleTrend.map((item) => (
        <div className="mood-trend-column flex min-w-0 flex-1 flex-col items-center gap-2" key={item.id}>
          <div className="mood-trend-track flex h-28 w-full items-end justify-center rounded-lg border border-slate-100 bg-paper">
            <div
              className="mood-trend-bar w-4 max-w-[65%] rounded-t-full bg-sea"
              style={{ height: `${Math.max(12, item.moodScore * 20)}%` }}
              title={`Mood ${item.moodScore}/5`}
            />
          </div>
          <time className="text-xs text-slate-500" dateTime={item.date}>{new Date(item.date).getDate()}</time>
        </div>
      ))}
    </div>
  );
}

function EntryList({ emptyText, items, onDelete, renderItem }) {
  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">{emptyText}</p>
      ) : (
        items.map((item) => (
          <article className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-teal-200 hover:shadow-sm" key={item._id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 break-words">
                {renderItem(item)}
                <p className="mt-3 flex items-center gap-1 text-xs text-slate-500">
                  <CalendarDays size={14} aria-hidden="true" />
                  {formatDate(item.loggedFor || item.createdAt)}
                </p>
              </div>
              <button
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                onClick={() => onDelete(item._id)}
                title="Delete"
                type="button"
              >
                <Trash2 size={16} aria-hidden="true" />
                <span className="sr-only">Delete</span>
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

function TextField({ label, name, setForm, value, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        className="input"
        name={name}
        onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}
        value={value}
        {...props}
      />
    </label>
  );
}

function SelectField({ label, name, options, setForm, value }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <select
        className="input"
        name={name}
        onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RangeField({ label, max, min, name, setForm, value }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-sm font-medium text-slate-700">
        {label}
        <span className="font-semibold text-sea">{value}</span>
      </span>
      <input
        className="w-full accent-teal-700"
        max={max}
        min={min}
        name={name}
        onChange={(event) => setForm((current) => ({ ...current, [name]: Number(event.target.value) }))}
        type="range"
        value={value}
      />
    </label>
  );
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function titleCase(value) {
  if (!value) {
    return "";
  }

  return value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
