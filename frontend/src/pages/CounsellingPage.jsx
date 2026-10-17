import {
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  UserRound,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client.js";
import { useAuth } from "../context/useAuth.js";
import CounsellorWellnessOverview from "../components/CounsellorWellnessOverview.jsx";
import SessionNotes from "../components/SessionNotes.jsx";
import AppointmentDocuments from "../components/AppointmentDocuments.jsx";
import { isFutureAppointmentSlot, minimumAppointmentTime, toLocalDateTimeInput } from "../utils/appointmentTime.js";

const concernOptions = [
  { value: "academic_stress", label: "Academic stress" },
  { value: "anxiety", label: "Anxiety" },
  { value: "sleep", label: "Sleep" },
  { value: "relationships", label: "Relationships" },
  { value: "career", label: "Career" },
  { value: "general", label: "General" }
];

const statusStyles = {
  pending: "border-amber-200 bg-amber-50 text-amber",
  approved: "border-blue-200 bg-blue-50 text-ocean",
  completed: "border-teal-200 bg-teal-50 text-sea",
  cancelled: "border-red-200 bg-red-50 text-red-700"
};

export default function CounsellingPage() {
  const { user } = useAuth();

  if (user.role === "admin") {
    return (
      <section className="surface p-6">
        <p className="section-kicker">Admin workspace</p>
        <h2 className="mt-2 text-2xl font-bold">Admin counselling oversight</h2>
        <p className="mt-2 muted-copy">Use the Admin workspace to monitor counselling workload and platform activity.</p>
      </section>
    );
  }

  return user.role === "student" ? <StudentCounselling /> : <CounsellorCounselling />;
}

function StudentCounselling() {
  const [counsellors, setCounsellors] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [form, setForm] = useState({
    counsellorId: "",
    scheduledFor: defaultAppointmentTime(),
    concernType: "academic_stress",
    notes: "",
    shareSummary: false
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function refreshData() {
    try {
      setError("");
      const [counsellorResult, appointmentResult] = await Promise.all([
        api.get("/counselling/counsellors"),
        api.get("/counselling/appointments")
      ]);

      const nextCounsellors = counsellorResult.data.counsellors || [];
      setCounsellors(nextCounsellors);
      setAppointments(appointmentResult.data.appointments || []);
      setForm((current) => ({
        ...current,
        counsellorId: current.counsellorId || nextCounsellors[0]?.user?.id || ""
      }));
    } catch (loadError) {
      setError(loadError.response?.data?.message || "We couldn’t load counselling. Please refresh to try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshData();
  }, []);

  async function bookAppointment(event) {
    event.preventDefault();
    if (!isFutureAppointmentSlot(form.scheduledFor)) {
      setStatus("");
      setError("Choose a future 30-minute appointment slot on the hour or half hour.");
      return;
    }
    setSaving(true);
    setStatus("");
    setError("");

    try {
      await api.post("/counselling/appointments", { ...form, scheduledFor: new Date(form.scheduledFor).toISOString() });
      setStatus("Appointment request sent.");
      setForm((current) => ({
        ...current,
        scheduledFor: defaultAppointmentTime(),
        notes: ""
      }));
      await refreshData();
    } catch (saveError) {
      setError(saveError.response?.data?.message || "Unable to book appointment.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelAppointment(id) {
    try {
      setStatus("");
      setError("");
      await api.patch(`/counselling/appointments/${id}/status`, { status: "cancelled" });
      setStatus("Appointment cancelled.");
      await refreshData();
    } catch (cancelError) {
      setError(cancelError.response?.data?.message || "Unable to cancel appointment.");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        description="You don’t have to work through everything alone. Choose someone to talk with, at a time that suits you."
        title="Talk with a counsellor"
      />

      {status && <p className="rounded-lg bg-teal-50 px-4 py-3 text-sm font-semibold text-sea" role="status">{status}</p>}
      {error && <ErrorNotice message={error} />}

      <section className="grid gap-5 lg:grid-cols-2">
        <section className="surface p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-teal-50 text-sea">
              <CalendarClock size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Request appointment</h2>
              <p className="text-sm text-slate-500">Counsellors approve requests from their dashboard.</p>
            </div>
          </div>

          {loading ? (
            <LoadingLine text="Loading counsellors" />
          ) : counsellors.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No counsellor accounts are available yet.</p>
          ) : (
            <form className="space-y-4" onSubmit={bookAppointment}>
              <SelectField
                label="Counsellor"
                name="counsellorId"
                onChange={setForm}
                options={counsellors.map((item) => ({
                  value: item.user.id,
                  label: `${item.user.name}${item.profile?.qualification ? `, ${item.profile.qualification}` : ""}`
                }))}
                value={form.counsellorId}
              />
              {counsellors.find((item) => item.user.id === form.counsellorId)?.profile?.availabilityNote && <p className="muted-copy">Availability: {counsellors.find((item) => item.user.id === form.counsellorId).profile.availabilityNote}</p>}
              <TextField
                label="Date and time"
                min={minimumAppointmentTime()}
                name="scheduledFor"
                onChange={setForm}
                type="datetime-local"
                step={1800}
                required
                value={form.scheduledFor}
              />
              <p className="text-sm text-slate-600">Choose a future time on the hour or half hour. Times use your local timezone; your counsellor will confirm the request.</p>
              <SelectField label="What would you like support with?" name="concernType" onChange={setForm} options={concernOptions} value={form.concernType} />
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Anything you’d like to share? (optional)</span>
                <textarea
                  className="input min-h-28 resize-y"
                  maxLength={1000}
                  name="notes"
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Share what you want help with."
                  value={form.notes}
                />
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-teal-100 bg-teal-50 p-4 text-sm">
                <input
                  checked={form.shareSummary}
                  className="mt-1"
                  onChange={(event) => setForm((current) => ({ ...current, shareSummary: event.target.checked }))}
                  type="checkbox"
                />
                <span>
                  <span className="block font-semibold text-ink">Share wellness summary</span>
                  <span className="mt-1 block text-slate-600">
                    Use assessments, moods, journal themes and your stress-type estimate to prepare a summary for this counsellor. Generating the summary sends selected records to the AI provider. Profile consent must also be enabled.
                  </span>
                </span>
              </label>
              <button className="btn-primary inline-flex w-full items-center justify-center gap-2" disabled={saving} type="submit">
                {saving ? <Loader2 className="animate-spin" size={18} /> : <CalendarCheck size={18} />}
                {saving ? "Sending request..." : "Book appointment"}
              </button>
            </form>
          )}
        </section>

        <section className="surface p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="appointment-heading">
              <h2 className="text-lg font-bold">My appointments</h2>
              <p className="text-sm text-slate-500">Open an approved session or return to a completed conversation. Messages stay saved with their appointment.</p>
            </div>
            <button className="btn-secondary appointment-refresh" onClick={refreshData} type="button">
              <RefreshCw size={16} aria-hidden="true" />
              Refresh
            </button>
          </div>
          <AppointmentList appointments={appointments} loading={loading} onCancel={cancelAppointment} role="student" onSharing={async (appointment) => {
            try {
              await api.patch(`/counselling/appointments/${appointment._id}/sharing`, { shareSummary: !appointment.shareSummary });
              await refreshData();
            } catch (err) { setError(err.response?.data?.message || "Unable to update sharing."); }
          }} />
        </section>
      </section>
    </div>
  );
}

function CounsellorCounselling() {
  const [appointments, setAppointments] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const selectedAppointment = useMemo(
    () => appointments.find((appointment) => appointment._id === selectedId) || appointments[0] || null,
    [appointments, selectedId]
  );

  async function refreshAppointments() {
    try {
      setError("");
      const { data } = await api.get("/counselling/appointments");
      const nextAppointments = data.appointments || [];
      setAppointments(nextAppointments);
      setSelectedId((current) => current || nextAppointments[0]?._id || "");
    } catch (loadError) {
      setError(loadError.response?.data?.message || "Unable to load appointments. Check that the backend is running.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAppointments();
  }, []);


  async function updateStatus(nextStatus) {
    if (!selectedAppointment) {
      return;
    }

    try {
      setStatus("");
      setError("");
      const { data } = await api.patch(`/counselling/appointments/${selectedAppointment._id}/status`, {
        status: nextStatus,
        counsellorNotes: selectedAppointment.counsellorNotes || ""
      });
      setAppointments((current) => current.map((appointment) => (appointment._id === data.appointment._id ? data.appointment : appointment)));
      setStatus(`Appointment marked ${titleCase(nextStatus)}.`);
    } catch (updateError) {
      setError(updateError.response?.data?.message || "Unable to update appointment.");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        description="Review appointment requests, approve care sessions, and read student summaries when consent is enabled."
        title="Counsellor Appointments"
      />

      {status && <p className="rounded-lg bg-teal-50 px-4 py-3 text-sm font-semibold text-sea" role="status">{status}</p>}
      {error && <ErrorNotice message={error} />}

      <section className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <section className="surface p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Requests</h2>
            <button className="btn-secondary appointment-refresh" onClick={refreshAppointments} type="button">
              <RefreshCw size={16} aria-hidden="true" />
              Refresh
            </button>
          </div>
          <AppointmentList
            appointments={appointments}
            loading={loading}
            onSelect={(appointment) => setSelectedId(appointment._id)}
            role="counsellor"
            selectedId={selectedAppointment?._id}
          />
        </section>

        <section className="space-y-5">
          <section className="surface p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Session details</h2>
                <p className="text-sm text-slate-500">Approve, close, or cancel the selected request.</p>
              </div>
              <Stethoscope className="text-coral" size={23} aria-hidden="true" />
            </div>

            {!selectedAppointment ? (
              <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No appointment selected.</p>
            ) : (
              <div className="space-y-4">
                <DetailGrid appointment={selectedAppointment} />
                {["pending", "approved"].includes(selectedAppointment.status) && <AppointmentDocuments key={`documents-${selectedAppointment._id}`} appointment={selectedAppointment} role="counsellor" />}
                {["approved", "completed"].includes(selectedAppointment.status) && <SessionNotes key={selectedAppointment._id}
                  appointment={selectedAppointment} onSaved={(updated) => setAppointments((current) => current.map((item) => item._id === updated._id ? updated : item))} />}
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary inline-flex items-center gap-2" onClick={() => updateStatus("approved")} type="button">
                    <CheckCircle2 size={16} />
                    Approve
                  </button>
                  <button className="btn-secondary inline-flex items-center gap-2" onClick={() => updateStatus("completed")} type="button">
                    <ShieldCheck size={16} />
                    Complete
                  </button>
                  <button className="btn-secondary inline-flex items-center gap-2" onClick={() => updateStatus("cancelled")} type="button">
                    <XCircle size={16} />
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>

          <CounsellorWellnessOverview key={selectedAppointment?._id || "none"} appointment={selectedAppointment} />
        </section>
      </section>
    </div>
  );
}

function PageHeader({ description, title }) {
  return <header className="mb-8">
    <p className="section-kicker">Support, at your pace</p>
    <h1 className="page-heading mt-2">{title}</h1>
    <p className="mt-3 max-w-2xl muted-copy">{description}</p>
  </header>;
}

function AppointmentList({ appointments, loading, onCancel, onSelect, onSharing, role, selectedId }) {
  if (loading) {
    return <LoadingLine text="Loading appointments" />;
  }

  if (!appointments.length) {
    return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No counselling sessions scheduled yet.</p>;
  }

  return (
    <div className="space-y-3">
      {appointments.map((appointment) => {
        const isSelected = selectedId === appointment._id;
        const person = role === "student" ? appointment.counsellor : appointment.student;
        return (
          <article
            className={`appointment-card border ${
              isSelected ? "border-teal-300 shadow-sm" : "border-slate-200 hover:border-teal-200"
            }`}
            key={appointment._id}
          >
            {appointment.progressUpdate && <p className="mb-3 text-sm"><strong>Progress update:</strong> {appointment.progressUpdate}</p>}
            {["approved", "completed"].includes(appointment.status) && <Link className="btn-primary mb-3 inline-flex" to={`/counselling/${appointment._id}/session`}>{appointment.status === "approved" ? "Open counselling chat" : "View conversation"}</Link>}
            {appointment.status === "pending" && <p className="mb-3 text-sm text-slate-600">Chat will be available when this appointment is approved.</p>}
            {role === "student" && <AppointmentDocuments appointment={appointment} role="student" />}
            {role === "student" && ["pending", "approved"].includes(appointment.status) && <button className="btn-secondary mb-3" type="button" onClick={() => onSharing?.(appointment)}>
              {appointment.shareSummary ? "Stop sharing summary" : "Allow summary sharing"}
            </button>}
            {role === "student" && appointment.shareSummary && ["pending", "approved"].includes(appointment.status) && <p className="mb-3 text-sm text-slate-600">Appointment sharing is enabled. Also enable <Link className="dashboard-text-link" to="/profile">Counsellor summary consent in Profile</Link> to share your wellness overview.</p>}
            <button className="block w-full text-left" onClick={() => onSelect?.(appointment)} type="button">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-600">
                    <UserRound size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-bold">{person?.name || "Counselling user"}</p>
                    <p className="mt-1 text-sm text-slate-500">{formatDateTime(appointment.scheduledFor)}</p>
                  </div>
                </div>
                <StatusPill status={appointment.status} />
              </div>
              <p className="text-sm font-semibold text-slate-700">{titleCase(appointment.concernType.replace("_", " "))}</p>
              {appointment.notes && <p className="mt-2 text-sm leading-6 text-slate-600">{appointment.notes}</p>}
            </button>
            {role === "student" && ["pending", "approved"].includes(appointment.status) && (
              <button className="btn-secondary mt-3 inline-flex items-center gap-2" onClick={() => onCancel(appointment._id)} type="button">
                <XCircle size={16} aria-hidden="true" />
                Cancel
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}

function DetailGrid({ appointment }) {
  const items = [
    { label: "Student", value: appointment.student?.name || "-" },
    { label: "Concern", value: titleCase(appointment.concernType.replace("_", " ")) },
    { label: "Scheduled", value: formatDateTime(appointment.scheduledFor) },
    { label: "Status", value: titleCase(appointment.status) }
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" key={item.label}>
          <p className="text-xs font-bold uppercase text-slate-500">{item.label}</p>
          <p className="mt-1 font-semibold text-ink">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }) {
  return <span className={`status-pill ${statusStyles[status] || statusStyles.pending}`}>{titleCase(status)}</span>;
}

function TextField({ label, name, onChange, value, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        className="input"
        name={name}
        onChange={(event) => onChange((current) => ({ ...current, [name]: event.target.value }))}
        value={value}
        {...props}
      />
    </label>
  );
}

function SelectField({ label, name, onChange, options, value }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <select
        className="input"
        name={name}
        onChange={(event) => onChange((current) => ({ ...current, [name]: event.target.value }))}
        required
        value={value}
      >
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ErrorNotice({ message }) {
  return (
    <div role="alert" className="notice-error flex items-start gap-2">
      <CircleAlert className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
      {message}
    </div>
  );
}

function LoadingLine({ text }) {
  return (
    <div role="status" className="flex items-center gap-2 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
      <Loader2 className="animate-spin" size={17} aria-hidden="true" />
      {text}
    </div>
  );
}

function defaultAppointmentTime() {
  const nextDay = new Date();
  nextDay.setDate(nextDay.getDate() + 1);
  nextDay.setHours(10, 0, 0, 0);
  return toLocalDateTimeInput(nextDay);
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function titleCase(value) {
  return String(value || "")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
