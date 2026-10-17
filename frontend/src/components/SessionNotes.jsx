import { useState } from "react";
import { api } from "../api/client.js";

export default function SessionNotes({ appointment, onSaved }) {
  const [notes, setNotes] = useState(appointment.counsellorNotes || "");
  const [progress, setProgress] = useState(appointment.progressUpdate || "");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      const { data } = await api.patch(`/counselling/appointments/${appointment._id}/notes`, { counsellorNotes: notes, progressUpdate: progress });
      onSaved(data.appointment); setMessage("Session notes saved.");
    } catch (error) { setMessage(error.response?.data?.message || "Unable to save notes."); }
    finally { setSaving(false); }
  }
  return <form className="space-y-3" onSubmit={save}>
    <label className="block text-sm font-semibold">Private counsellor notes
      <textarea className="input mt-1" maxLength={1500} value={notes} onChange={(event) => setNotes(event.target.value)} />
    </label>
    <label className="block text-sm font-semibold">Progress update shared with the student
      <textarea className="input mt-1" maxLength={1500} value={progress} onChange={(event) => setProgress(event.target.value)} />
    </label>
    <p role="status" className="text-sm">{message}</p>
    <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save session notes"}</button>
  </form>;
}
