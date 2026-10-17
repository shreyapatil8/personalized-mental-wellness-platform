import { BrainCircuit, Clipboard, Layers3, ListFilter, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client.js";
import { useAuth } from "../context/useAuth.js";

const sampleMessages = [
  "I feel stressed about exams and cannot sleep well.",
  "I feel lonely and I am losing interest in daily activities.",
  "I want help building a healthier study routine."
];

export default function IntelligencePage() {
  const { user } = useAuth();
  const [context, setContext] = useState(null);
  const [userMessage, setUserMessage] = useState(sampleMessages[0]);
  const [tokenBudget, setTokenBudget] = useState(1400);
  const [maxItems, setMaxItems] = useState(10);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  async function loadLatestContext() {
    try {
      setError("");
      const { data } = await api.get("/intelligence/context/me");
      setContext(data.context);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load intelligence context. Check that the backend is running.");
    } finally {
      setLoading(false);
    }
  }

  async function generateContext(event) {
    event.preventDefault();
    try {
      setGenerating(true);
      setError("");
      const { data } = await api.post("/intelligence/context/me", {
        userMessage,
        tokenBudget,
        maxItems
      });
      setContext(data.context);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to generate context.");
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    if (user.role === "student") {
      loadLatestContext();
    }
  }, [user.role]);

  if (user.role !== "student") {
    return (
      <section className="surface p-6">
        <p className="section-kicker">Wellness intelligence</p>
        <h2 className="mt-2 text-2xl font-bold">Wellness Intelligence Engine</h2>
        <p className="mt-2 muted-copy">Context generation is available for student accounts.</p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="surface overflow-hidden">
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="p-6">
            <p className="section-kicker">Wellness intelligence</p>
            <h1 className="mt-2 text-3xl font-bold">Wellness Intelligence Engine</h1>
            <p className="mt-3 max-w-2xl muted-copy">
              Build the AI-ready context package from profile, assessments, moods, journals, previous conversations,
              and the latest prediction.
            </p>
          </div>
          <ContextStats context={context} loading={loading} />
        </div>
      </section>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[390px_minmax(0,1fr)]">
        <section className="surface p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-teal-50 text-sea">
              <ListFilter size={20} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Generate context</h3>
              <p className="text-sm text-slate-500">Use the message to rank relevance.</p>
            </div>
          </div>

          <form className="space-y-4" onSubmit={generateContext}>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Student message</span>
              <textarea
                className="input min-h-32 resize-y"
                onChange={(event) => setUserMessage(event.target.value)}
                required
                value={userMessage}
              />
            </label>

            <div className="grid gap-3">
              {sampleMessages.map((message) => (
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-600 transition hover:border-teal-200 hover:bg-teal-50 hover:text-sea"
                  key={message}
                  onClick={() => setUserMessage(message)}
                  type="button"
                >
                  {message}
                </button>
              ))}
            </div>

            <RangeField label="Token budget" max={3000} min={400} setValue={setTokenBudget} step={100} value={tokenBudget} />
            <RangeField label="Max context items" max={20} min={3} setValue={setMaxItems} step={1} value={maxItems} />

            <button className="btn-primary inline-flex w-full items-center justify-center gap-2" disabled={generating} type="submit">
              {generating ? <RefreshCw className="animate-spin" size={18} /> : <Layers3 size={18} />}
              {generating ? "Building context..." : "Build intelligence context"}
            </button>
          </form>
        </section>

        <section className="min-w-0 space-y-5">
          <section className="surface p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">Selected context</h3>
                <p className="text-sm text-slate-500">Highest-ranked items under the budget.</p>
              </div>
              <BrainCircuit className="text-ocean" size={22} aria-hidden="true" />
            </div>
            <ContextItemList context={context} loading={loading} />
          </section>

          <section className="surface p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-blue-50 text-ocean">
                <Clipboard size={20} aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Structured prompt</h3>
                <p className="text-sm text-slate-500">This is the context package sent to the AI assistant.</p>
              </div>
            </div>
            <PromptPreview context={context} loading={loading} />
          </section>
        </section>
      </section>
    </div>
  );
}

function ContextStats({ context, loading }) {
  const stats = useMemo(
    () => [
      { label: "Candidates", value: context?.candidateCount ?? "-" },
      { label: "Selected", value: context?.selectedItems?.length ?? "-" },
      { label: "Tokens", value: context?.estimatedTokens ?? "-" }
    ],
    [context]
  );

  return (
    <div className="m-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
      {stats.map((stat) => (
        <div className="rounded-lg border border-slate-200 bg-paper p-4" key={stat.label}>
          <p className="text-xs font-bold uppercase text-slate-500">{stat.label}</p>
          <p className="mt-1 text-2xl font-bold text-ink">{loading ? "-" : stat.value}</p>
        </div>
      ))}
    </div>
  );
}

function ContextItemList({ context, loading }) {
  if (loading) {
    return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Loading context...</p>;
  }

  if (!context?.selectedItems?.length) {
    return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No context snapshot yet.</p>;
  }

  return (
    <div className="space-y-3">
      {context.selectedItems.map((item) => (
        <article className="rounded-lg border border-slate-200 bg-white p-4" key={`${item.sourceType}-${item.sourceId}-${item.title}`}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="status-pill border-teal-100 bg-teal-50 text-sea">{item.sourceType}</span>
            <span className="status-pill border-slate-200 bg-slate-50 text-slate-600">score {formatNumber(item.totalScore)}</span>
            <span className="status-pill border-blue-100 bg-blue-50 text-ocean">{item.estimatedTokens} tokens</span>
          </div>
          <h4 className="font-bold">{item.title}</h4>
          <p className="mt-2 text-sm leading-6 text-slate-600">{item.content}</p>
        </article>
      ))}
    </div>
  );
}

function PromptPreview({ context, loading }) {
  if (loading) {
    return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Loading prompt...</p>;
  }

  if (!context?.structuredPrompt) {
    return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Build context to preview the prompt.</p>;
  }

  return (
    <pre className="max-h-[520px] overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 text-sm leading-6 text-slate-100">
      {context.structuredPrompt}
    </pre>
  );
}

function RangeField({ label, max, min, setValue, step, value }) {
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
        onChange={(event) => setValue(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}

function formatNumber(value) {
  if (value == null) {
    return "-";
  }

  return Number(value).toFixed(2).replace(/\.00$/, "");
}
