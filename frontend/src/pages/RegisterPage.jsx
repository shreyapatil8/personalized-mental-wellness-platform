import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "../context/useAuth.js";
import { AuthShell, Field } from "./LoginPage.jsx";

export default function RegisterPage({ role = "student" }) {
  const navigate = useNavigate();
  const { register, user } = useAuth();
  const [form, setForm] = useState({
    name: "", email: "", password: "", confirmPassword: "",
    qualification: "", specialization: ""
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const isCounsellor = role === "counsellor";

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving || notice) return;
    setError("");
    if (form.name.trim().length < 2) {
      setError("Please enter your full name (at least 2 characters).");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match. Please enter the same password in both fields.");
      return;
    }
    setSaving(true);
    try {
      const email = form.email.trim().toLowerCase();
      const result = await register({
        name: form.name.trim(), email, password: form.password, role,
        ...(isCounsellor ? { profile: {
          qualification: form.qualification,
          specialization: form.specialization.split(",").map((item) => item.trim()).filter(Boolean)
        } } : {})
      });
      if (result.requiresApproval) {
        setNotice(result.message);
        return;
      }
      navigate("/login", {
        replace: true,
        state: { registeredEmail: email, message: "Your account has been created. Log in to get started." }
      });
    } catch (err) {
      setError(err.response?.data?.issues?.[0]?.message || err.response?.data?.message || "Unable to create your account. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthShell
      title={isCounsellor ? "Counsellor registration" : "Create your student account"}
      subtitle={isCounsellor ? "Apply for a counsellor account. Administrator approval is required." : "Start with the basics. Your wellness profile and assessments come later."}
    >
      <form className="space-y-4" onSubmit={handleSubmit} aria-busy={saving}>
        <Field label="Full Name" name="name" autoComplete="name" minLength={2} maxLength={80} onChange={setForm} required value={form.name} />
        <Field label="Email" name="email" autoComplete="email" onChange={setForm} required type="email" value={form.email} />
        <Field label="Password" name="password" autoComplete="new-password" minLength={8} aria-describedby="password-hint" onChange={setForm} required type="password" value={form.password} />
        <p id="password-hint" className="text-sm text-slate-600">Use at least 8 characters.</p>
        <Field label="Confirm Password" name="confirmPassword" autoComplete="new-password" minLength={8} onChange={setForm} required type="password" value={form.confirmPassword} />
        {isCounsellor && (
          <>
            <Field label="Qualification" name="qualification" onChange={setForm} value={form.qualification} />
            <Field label="Specializations" name="specialization" onChange={setForm} placeholder="Stress, anxiety, academic counselling" value={form.specialization} />
          </>
        )}
        {notice && <p role="status" className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-sea">{notice}</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" disabled={saving || Boolean(notice)} type="submit">
          {saving ? "Creating account..." : notice ? "Application submitted" : "Register"}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-slate-600">
        Already registered? <Link className="font-semibold text-sea hover:underline" to="/login">Login</Link>
      </p>
      <p className="mt-3 text-center text-sm text-slate-600">
        <Link className="underline underline-offset-4" to={isCounsellor ? "/register" : "/register/counsellor"}>
          {isCounsellor ? "Register as a student" : "Counsellor registration"}
        </Link>
      </p>
    </AuthShell>
  );
}
