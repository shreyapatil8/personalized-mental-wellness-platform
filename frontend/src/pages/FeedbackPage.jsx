import { useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/useAuth.js";

export default function FeedbackPage() {
  const { user } = useAuth();
  const [form, setForm] = useState({ category: "overall", rating: "", helpfulness: "", comment: "" });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  if (user.role === "admin") return <p>Student and counsellor feedback is summarized in the admin workspace.</p>;
  async function submit(event) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      const { data } = await api.post("/feedback", { ...form, rating: Number(form.rating), helpfulness: Number(form.helpfulness) });
      setMessage(data.message); setForm({ category: "overall", rating: "", helpfulness: "", comment: "" });
    } catch (error) { setMessage(error.response?.data?.message || "Unable to submit feedback."); }
    finally { setSaving(false); }
  }
  return <section className="surface max-w-2xl p-6">
    <h1 className="text-2xl font-bold">Research feedback</h1>
    <p className="mt-2 text-sm text-slate-600">Optional feedback about your experience. Administrators see aggregate ratings. Please keep names and sensitive wellness information out of comments. Responses measure usability, not clinical effectiveness.</p>
    <form className="mt-5 space-y-4" onSubmit={submit}>
      <label className="block">Area<select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
        {["overall", "assistant", "tracking", "counselling"].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      {[{ key: "rating", label: "How easy was it to use?", low: "Very difficult", high: "Very easy" },
        { key: "helpfulness", label: "How helpful was it?", low: "Not helpful", high: "Very helpful" }].map((item) => <label className="block" key={item.key}>
        {item.label}<select className="input" required value={form[item.key]} onChange={(e) => setForm({ ...form, [item.key]: e.target.value })}>
          <option value="">Choose a rating</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}{value === 1 ? ` — ${item.low}` : value === 5 ? ` — ${item.high}` : ""}</option>)}
        </select>
      </label>)}
      <label className="block">Optional comment<textarea className="input" maxLength={1000} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></label>
      <p role="status">{message}</p><button className="btn-primary" disabled={saving}>{saving ? "Submitting…" : "Submit feedback"}</button>
    </form>
  </section>;
}
