import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { api } from "../api/client.js";
import { AuthShell, Field } from "./LoginPage.jsx";

export default function ResetPasswordPage() {
  const location = useLocation();
  const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
  const [validating, setValidating] = useState(true);
  const [valid, setValid] = useState(false);
  const [form, setForm] = useState({ password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.get("/auth/reset-password/validate", { params: { token } })
      .then(() => { if (active) setValid(true); })
      .catch(() => { if (active) setValid(false); })
      .finally(() => { if (active) setValidating(false); });
    return () => { active = false; };
  }, [token]);

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post("/auth/reset-password", { token, password: form.password });
      setComplete(true);
      setError(data.message);
    } catch (err) {
      setError(err.response?.data?.message || "We could not reset your password. Request a new link.");
    } finally {
      setSaving(false);
    }
  }

  return <AuthShell title="Choose a new password" subtitle="Reset links expire after 30 minutes and can only be used once.">
    {validating ? <p role="status" className="muted-copy">Checking your reset link…</p>
      : complete ? <div role="status" className="notice-success">{error}<Link className="mt-3 inline-flex min-h-11 items-center font-semibold text-sea hover:underline" to="/login">Go to login</Link></div>
        : !valid ? <div role="alert" className="notice-error">This reset link is invalid or has expired. <Link className="font-semibold text-sea hover:underline" to="/forgot-password">Request a new link</Link>.</div>
          : <form className="space-y-4" onSubmit={submit} aria-busy={saving}>
            <Field label="New password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={form.password} onChange={setForm} required />
            <p className="text-sm text-slate-600">Use at least 8 characters.</p>
            <Field label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={form.confirmPassword} onChange={setForm} required />
            {error && <p role="alert" className="notice-error">{error}</p>}
            <button className="btn-primary w-full" type="submit" disabled={saving}>{saving ? "Saving…" : "Reset password"}</button>
          </form>}
    {!complete && <p className="mt-5 text-center text-sm text-slate-600"><Link className="font-semibold text-sea hover:underline" to="/login">Back to login</Link></p>}
  </AuthShell>;
}
