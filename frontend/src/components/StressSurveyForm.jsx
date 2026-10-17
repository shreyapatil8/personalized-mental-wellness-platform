import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function StressSurveyForm({ onSaved, inOverview = false }) {
  const [contract, setContract] = useState(null);
  const [answers, setAnswers] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get("/predictions/survey").then(({ data }) => {
      setContract(data.contract); setAnswers(data.survey?.answers || {});
    }).catch(() => setMessage("Unable to load the survey. Refresh to retry."));
  }, []);
  async function save(event) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      await api.post("/predictions/survey", { answers });
      setMessage(inOverview ? "Your responses have been saved." : "Research survey saved. You can now generate a stress-type estimate.");
      await onSaved?.();
    } catch (error) { setMessage(error.response?.data?.message || "Unable to save survey."); }
    finally { setSaving(false); }
  }
  return <section className="surface p-5">
    <h3 className="text-lg font-bold">{inOverview ? "Your stress check-in" : "Research stress survey"}</h3>
    <p className="mt-2 text-sm text-slate-600">{inOverview ? "Reflect on each statement using the options below. All questions are required to update your estimate." : contract?.notice || "Loading survey…"}</p>
    <p className="mt-2 text-sm text-slate-600">{inOverview ? "This optional estimate describes stress as more manageable or more difficult to manage. Neither description may fit you, and it cannot identify an absence of stress. You can seek support regardless of the result." : "This binary research model cannot identify “No Stress”. It always chooses Eustress or Distress, even when neither describes you. You can seek support regardless of its estimate."}</p>
    <form className="mt-4 space-y-4" onSubmit={save}>
      {contract?.questions.map((question, index) => <label className="block" key={question.id}>
        <span className="mb-1 block text-sm font-medium">{index + 1}. {question.label}</span>
        <select className="input" required value={answers[question.id] ?? ""}
          onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: Number(event.target.value) }))}>
          <option value="">Choose a response</option>
          {contract.scale.map((label, i) => <option key={label} value={i + 1}>{i + 1} — {label}</option>)}
        </select>
      </label>)}
      <p role="status" className="text-sm">{message}</p>
      <button className="btn-primary" disabled={saving || !contract}>{saving ? "Saving…" : inOverview ? "Save and update summary" : "Save research survey"}</button>
    </form>
  </section>;
}

