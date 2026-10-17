import { HeartPulse } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../context/useAuth.js";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, user } = useAuth();
  const [form, setForm] = useState({ email: location.state?.registeredEmail || "", password: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (user) return <Navigate to={user.role === "student" ? "/wellness-assessment" : "/"} state={{ fromLogin: true }} replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setError("");
    setSaving(true);

    try {
      const signedInUser = await login({ ...form, email: form.email.trim().toLowerCase() });
      navigate(signedInUser.role === "student" ? "/wellness-assessment" : "/", {
        replace: true,
        state: { fromLogin: true }
      });
    } catch (err) {
      setError(err.response?.data?.message || "Unable to sign in.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Your space to check in, reflect, and find support.">
      {location.state?.message && (
        <p role="status" className="mb-4 rounded-lg bg-teal-50 px-3 py-2 text-sm text-sea">{location.state.message}</p>
      )}
      <form className="space-y-4" onSubmit={handleSubmit} aria-busy={saving}>
        <Field
          label="Email"
          name="email"
          autoComplete="email"
          onChange={setForm}
          required
          type="email"
          value={form.email}
        />
        <Field
          label="Password"
          name="password"
          autoComplete="current-password"
          onChange={setForm}
          required
          type="password"
          value={form.password}
        />
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" disabled={saving} type="submit">
          {saving ? "Logging in..." : "Login"}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-slate-600">
        New here?{" "}
        <Link className="font-semibold text-sea hover:underline" to="/register">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

export function AuthShell({ title, subtitle, children }) {
  return (
    <main className="auth-page min-h-screen px-5 py-6 text-ink sm:px-8 sm:py-8">
      <div className="auth-container mx-auto max-w-5xl">
        <Link to="/" aria-label="Wellspace home" className="auth-brand inline-flex min-h-12 items-center gap-2.5 text-2xl font-bold tracking-tight text-sea"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-teal-800 text-white"><HeartPulse size={21} aria-hidden="true" /></span> Wellspace</Link>
        <section className="auth-layout mt-6 grid items-center gap-8 lg:mt-8 lg:grid-cols-2 lg:gap-14">
          <div className="auth-intro hidden lg:block">
            <p className="section-kicker">A little space for you</p>
            <h2 className="mt-4 text-5xl font-semibold leading-tight tracking-tight">Take a breath.<br />Start where you are.</h2>
            <p className="mt-6 max-w-sm text-lg leading-8 text-slate-600">Some days ask a lot of you. Make room to reflect, talk things through, and find support at your own pace.</p>
            <img src="/images/student-wellness.svg" alt="" className="mt-8 w-72 rounded-3xl" width="640" height="560" />
          </div>
          <div className="auth-card surface mx-auto w-full max-w-lg p-6 sm:p-8">
            <h1 className="page-heading">{title}</h1>
            <p className="mb-7 mt-3 muted-copy">{subtitle}</p>
            {children}
          </div>
        </section>
        <p className="mt-10 text-center text-sm text-slate-600">One small step at a time.</p>
      </div>
    </main>
  );
}

export function Field({ label, name, onChange, value, ...props }) {
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
