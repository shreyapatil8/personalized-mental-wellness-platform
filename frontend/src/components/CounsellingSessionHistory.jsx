import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";

export default function CounsellingSessionHistory({ appointmentId, status, role }) {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    api.get("/counselling/appointments").then(({ data }) => {
      if (active) setAppointments((data.appointments || []).filter(item => ["approved", "completed"].includes(item.status)));
    }).catch(() => {
      if (active) { setAppointments([]); setError("We couldn’t load your session history. Please try again."); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [appointmentId, status, refresh]);

  useEffect(() => {
    const reload = () => { if (document.visibilityState === "visible") setRefresh(value => value + 1); };
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, []);

  return <aside className="surface min-w-0 self-start p-4 lg:sticky lg:top-4" aria-label="Session history">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">Session history</h2>
      <button className="dashboard-text-link" disabled={loading} onClick={() => setRefresh(value => value + 1)} type="button">Refresh history</button>
    </div>
    <p className="mt-2 text-sm text-slate-600">Return to a saved conversation. Each appointment has its own private chat.</p>
    {loading ? <p className="mt-4 text-sm" role="status">Loading sessions…</p> : error ? <p className="mt-4 text-sm" role="alert">{error}</p> : !appointments.length ? <p className="mt-4 text-sm text-slate-600">Approved and completed sessions will appear here.</p> :
      <nav aria-label="Saved counselling conversations" className="mt-4 max-h-64 space-y-2 overflow-y-auto lg:max-h-[65dvh]">
        {appointments.map(appointment => {
          const person = role === "student" ? appointment.counsellor : appointment.student;
          const selected = appointment._id === appointmentId;
          return <Link key={appointment._id} to={`/counselling/${appointment._id}/session`} aria-current={selected ? "page" : undefined}
            className={`block break-words rounded-lg border p-3 ${selected ? "border-teal-400 bg-teal-50" : "border-slate-200 hover:bg-stone-50"}`}>
            <span className="block font-medium">{person?.name || "Counselling session"}</span>
            <time className="mt-1 block text-sm text-slate-600" dateTime={appointment.scheduledFor}>{new Date(appointment.scheduledFor).toLocaleString()}</time>
            <span className="mt-1 block text-sm text-slate-600">{appointment.status === "completed" ? "Completed · Read conversation" : "Approved · Open conversation"}{selected ? " · Selected" : ""}</span>
          </Link>;
        })}
      </nav>}
    <Link className="dashboard-text-link mt-4 inline-block" to="/counselling">Manage appointments</Link>
  </aside>;
}
