import { Save, Stethoscope } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../api/client.js";
import { useAuth } from "../context/useAuth.js";
import InitialAssessmentCard from "../components/InitialAssessmentCard.jsx";
import { Field } from "./LoginPage.jsx";

const emptyStudent = {
  consentForCounsellorSummary: false,
  consentForAssistantJournalContext: false
};

const emptyCounsellor = {
  qualification: "",
  specialization: "",
  availabilityNote: ""
};

export default function ProfilePage() {
  const { user } = useAuth();
  const [form, setForm] = useState(user.role === "student" ? emptyStudent : emptyCounsellor);
  const [account, setAccount] = useState(user);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [initialAssessment, setInitialAssessment] = useState(null);

  useEffect(() => {
    async function loadProfile() {
      setLoading(true); setError(""); setStatus("");
      try {
        const { data } = await api.get("/profile/me");
        const profile = data.profile || {};
        setAccount(data.user || user);

        if (user.role === "student") {
          setInitialAssessment(profile.initialWellnessAssessment || null);
          setForm({
            consentForCounsellorSummary: profile.consentForCounsellorSummary ?? false,
            consentForAssistantJournalContext: profile.consentForAssistantJournalContext ?? false
          });
        } else if (user.role === "counsellor") {
          setForm({
            qualification: profile.qualification || "",
            specialization: (profile.specialization || []).join(", "),
            availabilityNote: profile.availabilityNote || ""
          });
        }
        setLoaded(true);
      } catch {
        setError("We couldn’t load your profile. Please try again before making changes.");
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [user, user.role, attempt]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving || !loaded) return;
    setStatus(""); setError(""); setSaving(true);

    const payload = user.role === "student"
      ? {
          consentForCounsellorSummary: form.consentForCounsellorSummary,
          consentForAssistantJournalContext: form.consentForAssistantJournalContext
        }
      : {
          qualification: form.qualification,
          specialization: form.specialization.split(",").map((item) => item.trim()).filter(Boolean),
          availabilityNote: form.availabilityNote
        };

    try {
      await api.put("/profile/me", payload);
      setStatus(user.role === "student" ? "Privacy settings saved." : "Profile saved.");
    } catch {
      setError("We couldn’t save your profile. Check your details and try again. Your changes are still here.");
    } finally {
      setSaving(false);
    }
  }

  if (user.role === "admin") {
    return (
      <section className="surface p-6">
        <p className="section-kicker">Admin account</p>
        <h2 className="mt-2 text-2xl font-bold">Admin account</h2>
        <p className="mt-2 muted-copy">Admin system monitoring is available from the Admin workspace.</p>
      </section>
    );
  }

  if (user.role === "student") {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="px-1">
          <p className="section-kicker">Account and privacy</p>
          <h1 className="page-heading mt-1">My Profile</h1>
          <p className="mt-1 muted-copy">View your account details and manage how wellness information may be shared.</p>
        </header>

        {error && <div role="alert" className="notice-error">{error}{!loaded && <button className="dashboard-text-link ml-2" onClick={() => setAttempt(attempt + 1)} type="button">Try again</button>}</div>}
        {loading ? (
          <p role="status" className="surface p-4 text-sm text-slate-600">Loading profile…</p>
        ) : loaded ? (
          <>
            <section className="surface p-5 sm:p-6" aria-labelledby="profile-information-heading">
              <h2 id="profile-information-heading" className="text-base font-semibold text-slate-800">Profile information</h2>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <div><dt className="text-sm text-slate-500">Name</dt><dd className="mt-1 break-words font-medium text-slate-800">{account?.name || "—"}</dd></div>
                <div><dt className="text-sm text-slate-500">Email</dt><dd className="mt-1 break-words font-medium text-slate-800">{account?.email || "—"}</dd></div>
              </dl>
            </section>

            <InitialAssessmentCard assessment={initialAssessment} />

            <form className="surface space-y-4 p-5 sm:p-6" onSubmit={handleSubmit} aria-labelledby="profile-privacy-heading">
              <div>
                <h2 id="profile-privacy-heading" className="text-base font-semibold text-slate-800">Privacy and sharing</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">These choices are saved to your account. You can change them at any time.</p>
              </div>
              <label htmlFor="consentForAssistantJournalContext" className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <input
                  id="consentForAssistantJournalContext"
                  name="consentForAssistantJournalContext"
                  checked={form.consentForAssistantJournalContext}
                  className="mt-1 h-4 w-4 accent-teal-700"
                  onChange={(event) => setForm((current) => ({ ...current, consentForAssistantJournalContext: event.target.checked }))}
                  type="checkbox"
                />
                <span><span className="block font-medium text-slate-800">Allow journal excerpts in my AI assistant chats</span><span className="mt-1 block leading-5 text-slate-600">When enabled, the assistant may use short, relevant excerpts from your journal with the local Ollama model. Your full journal is not included.</span></span>
              </label>
              <label htmlFor="consentForCounsellorSummary" className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <input
                  id="consentForCounsellorSummary"
                  name="consentForCounsellorSummary"
                  checked={form.consentForCounsellorSummary}
                  className="mt-1 h-4 w-4 accent-teal-700"
                  onChange={(event) => setForm((current) => ({ ...current, consentForCounsellorSummary: event.target.checked }))}
                  type="checkbox"
                />
                <span><span className="block font-medium text-slate-800">Counsellor summary consent</span><span className="mt-1 block leading-5 text-slate-600">Allow your assigned counsellor to view your wellness overview and request a local AI-assisted briefing. Sharing also needs to be enabled for that appointment.</span></span>
              </label>
              <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                {status ? <p role="status" className="rounded-lg bg-teal-50 px-3 py-2 text-sm font-semibold text-sea">{status}</p> : <p className="text-sm text-slate-500">Your saved privacy choices are shown above.</p>}
                <button className="btn-primary inline-flex min-h-11 items-center justify-center gap-2" disabled={saving || !loaded} type="submit">
                  <Save size={18} aria-hidden="true" />{saving ? "Saving…" : "Save privacy settings"}
                </button>
              </div>
            </form>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <section className="surface overflow-hidden">
      <div className="border-b border-slate-200 bg-paper p-6">
        <p className="section-kicker">Profile</p>
        <h1 className="page-heading mt-2">Your profile</h1>
        <p className="mt-2 muted-copy">A few details about you, and choices about what you share.</p>
      </div>

      <div className="p-5 sm:p-7">
        {error && <div role="alert" className="notice-error mb-5">{error}{!loaded && <button className="dashboard-text-link ml-2" onClick={() => setAttempt(attempt + 1)} type="button">Try again</button>}</div>}
        {loading ? (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Loading profile...</p>
        ) : loaded ? (
          <form className="space-y-5" onSubmit={handleSubmit}>
            <CounsellorProfileForm form={form} setForm={setForm} />
            <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
              {status ? <p role="status" className="rounded-lg bg-teal-50 px-3 py-2 text-sm font-semibold text-sea">{status}</p> : <p className="text-sm text-slate-500">Changes are saved to your protected profile.</p>}
              <button className="btn-primary inline-flex items-center justify-center gap-2" disabled={saving} type="submit">
                <Save size={18} aria-hidden="true" />{saving ? "Saving…" : "Save profile"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}

function CounsellorProfileForm({ form, setForm }) {
  return (
    <div className="border-b border-slate-200 pb-6">
      <SectionTitle icon={<Stethoscope size={19} />} title="Counsellor details" />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Qualification" name="qualification" onChange={setForm} value={form.qualification} />
        <Field label="Specializations" name="specialization" onChange={setForm} placeholder="Stress, anxiety, academic counselling" value={form.specialization} />
      </div>
      <label className="block">
        <span className="mb-1 mt-4 block text-sm font-medium text-slate-700">Availability note</span>
        <textarea className="input min-h-28 resize-y" name="availabilityNote" onChange={(event) => setForm((current) => ({ ...current, availabilityNote: event.target.value }))} value={form.availabilityNote} />
      </label>
    </div>
  );
}

function SectionTitle({ icon, title }) {
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-teal-50 text-sea">{icon}</div>
      <h2 className="text-base font-bold">{title}</h2>
    </div>
  );
}
