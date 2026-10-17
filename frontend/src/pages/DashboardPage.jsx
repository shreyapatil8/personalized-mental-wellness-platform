import { ArrowRight, BookOpenText, Heart, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { Link } from "react-router-dom";
import { useAuth } from "../context/useAuth.js";

export default function DashboardPage() {
  const { user } = useAuth();
  if (user?.role !== "student") return <StaffDashboard user={user} />;

  return <StudentHome user={user} />;
}

function StudentHome({ user }) {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  async function load() {
    setError("");
    try { const { data } = await api.get("/dashboard/me"); setDashboard(data.dashboard); }
    catch { setError("Your recent updates could not be loaded."); }
  }
  useEffect(() => { load(); }, []);
  const moodCount = dashboard?.overview?.moodSummary?.entries || 0;
  const journalCount = dashboard?.overview?.journalEntryCount || 0;
  const appointment = dashboard?.counselling?.upcomingAppointment;
  return (
    <div className="student-home mx-auto grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,.8fr)]">
      <header className="dashboard-welcome">
        <p className="section-kicker">Your space, at your pace</p>
        <h1 className="mt-2 break-words">Hi, {user.name}.</h1>
        <p className="mt-3 text-base leading-7 text-slate-600">A little space for you. What would help today?</p>
      </header>

      <section aria-labelledby="assistant-title" className="dashboard-assistant">
        <div className="min-w-0 self-center">
          <p className="section-kicker">Here when you need it</p>
          <h2 id="assistant-title" className="mt-2 text-xl font-semibold text-slate-800">A space to talk</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-600">Talk through what's on your mind, at your own pace.</p>
          <Link className="dashboard-primary mt-5" to="/assistant">Talk to your Wellness Assistant</Link>
        </div>
        <img src="/images/student-wellness.svg" alt="" aria-hidden="true" width="180" height="158" className="dashboard-assistant-art" />
      </section>

      <nav aria-label="Daily check-ins" className="dashboard-checkins">
        <Link className="dashboard-checkin" to="/tracking?tab=mood">
          <span className="dashboard-checkin-icon" aria-hidden="true"><Heart size={18} /></span>
          <span><span className="block font-semibold text-teal-800">Mood Check-in</span><span className="mt-1 block text-sm text-slate-600">How are you feeling today?</span></span>
          <ArrowRight size={17} aria-hidden="true" className="shrink-0 text-slate-500" />
        </Link>
        <Link className="dashboard-checkin" to="/tracking?tab=journal">
          <span className="dashboard-checkin-icon" aria-hidden="true"><BookOpenText size={18} /></span>
          <span><span className="block font-semibold text-teal-800">Journal</span><span className="mt-1 block text-sm text-slate-600">Make room for your thoughts.</span></span>
          <ArrowRight size={17} aria-hidden="true" className="shrink-0 text-slate-500" />
        </Link>
      </nav>

      <section aria-labelledby="recent-heading" className="dashboard-reflection">
        <h2 id="recent-heading" className="text-lg font-semibold">A little reflection</h2>
        {error ? <p role="alert" className="mt-3 text-sm text-slate-600">{error} <button className="dashboard-text-link" onClick={load}>Try again</button></p> : !dashboard ? <p role="status" className="mt-3 muted-copy">Loading your recent updates…</p> : <>
          <p className="mt-2 muted-copy">{moodCount || journalCount ? `${moodCount} recent mood ${moodCount === 1 ? "check-in" : "check-ins"} and ${journalCount} saved ${journalCount === 1 ? "reflection" : "reflections"}. There is no pace to keep up with.` : "Your first check-in can start here, whenever you're ready."}</p>
          <Link className="dashboard-text-link mt-2" to="/wellness-assessment">{dashboard.profile?.initialWellnessAssessment ? "Revisit your wellness assessment" : "Take your first wellness assessment"}</Link>
          {appointment && <p className="mt-3 muted-copy">Next session: {new Date(appointment.scheduledFor).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · {appointment.status}</p>}
        </>}
      </section>
      <nav aria-label="Overview and support" className="dashboard-support">
        <Link className="home-quiet-link" to="/wellness-overview">
          <span><span className="block font-medium">Wellness Overview</span><span className="mt-1 block text-sm text-slate-500">See how you've been doing.</span></span>
          <ArrowRight size={17} aria-hidden="true" className="shrink-0 text-slate-500" />
        </Link>
        <Link className="home-quiet-link" to="/counselling">
          <span><span className="block font-medium">Counselling</span><span className="mt-1 block text-sm text-slate-500">Find support or manage a session.</span></span>
          <ArrowRight size={17} aria-hidden="true" className="shrink-0 text-slate-500" />
        </Link>
      </nav>
    </div>
  );
}
function StaffDashboard({ user }) {
  return (
    <div className="space-y-5">
      <section className="surface overflow-hidden">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="p-6">
            <p className="section-kicker">Workspace</p>
            <h2 className="mt-2 text-3xl font-bold">Hello, {user?.name}</h2>
            <p className="mt-3 max-w-3xl muted-copy">
              Counsellor tools and admin monitoring are ready.
            </p>
            {user?.role === "counsellor" && (
              <Link className="btn-primary mt-5 inline-flex items-center gap-2" to="/counselling">
                Review appointments
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            )}
            {user?.role === "admin" && (
              <Link className="btn-primary mt-5 inline-flex items-center gap-2" to="/admin">
                Open admin
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            )}
          </div>
          <div className="m-4 flex min-w-56 items-center gap-3 rounded-lg border border-teal-100 bg-teal-50 px-4 py-4">
            <ShieldCheck className="text-sea" size={24} aria-hidden="true" />
            <div>
              <p className="text-sm font-bold">Protected session</p>
              <p className="text-xs text-slate-500">Role: {user?.role}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}


