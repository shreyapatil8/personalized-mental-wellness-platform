import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client.js";
import { AuthShell } from "./LoginPage.jsx";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const { data } = await api.post("/auth/forgot-password", { email: email.trim().toLowerCase() });
      setMessage(data.message);
    } catch (err) {
      setError(err.response?.data?.message || "We could not send a reset link. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return <AuthShell title="Reset your password" subtitle="Enter the email address linked to your Wellspace account.">
    {message ? <div role="status" className="notice-success">{message}</div> : <form className="space-y-4" onSubmit={submit} aria-busy={saving}>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
        <input className="input" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      {error && <p role="alert" className="notice-error">{error}</p>}
      <button className="btn-primary w-full" type="submit" disabled={saving}>{saving ? "Sending…" : "Send reset link"}</button>
    </form>}
    <p className="mt-5 text-center text-sm text-slate-600"><Link className="font-semibold text-sea hover:underline" to="/login">Back to login</Link></p>
  </AuthShell>;
}
