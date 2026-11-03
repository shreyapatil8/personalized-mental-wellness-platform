import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";

import CounsellorProfile from "../models/CounsellorProfile.js";
import StudentProfile from "../models/StudentProfile.js";
import User from "../models/User.js";
import PasswordResetToken from "../models/PasswordResetToken.js";
import { DEPARTMENTS, STUDENT_YEARS } from "../constants/studentOptions.js";
import { createAuthToken } from "../utils/tokens.js";
import { sendPasswordResetEmail, smtpConfiguration } from "../services/smtpEmailService.js";

const rollNumberSchema = z.string().regex(/^\d{4}$/, "Roll number must be exactly 4 digits.");
const urnSchema = z.string().regex(/^(\d{8}|\d{10})$/, "URN must be exactly 8 or 10 digits.");

const registerSchema = z.object({
  name: z.string().trim().min(2, "Full name must be at least 2 characters.").max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  role: z.enum(["student", "counsellor"]).default("student"),
  profile: z
    .object({
      rollNumber: rollNumberSchema.optional(),
      urn: urnSchema.optional(),
      department: z.enum(DEPARTMENTS).optional(),
      year: z.enum(STUDENT_YEARS).optional(),
      age: z.coerce.number().min(16).max(30).optional(),
      gender: z.string().optional(),
      qualification: z.string().optional(),
      specialization: z.array(z.string()).optional()
    })
    .optional()
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1)
});

const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });
const resetPasswordSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(8, "Password must be at least 8 characters.").max(128)
});

const hashResetToken = (token) => createHash("sha256").update(token).digest("hex");

export async function forgotPassword(req, res, next) {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    // Fail before checking whether the account exists; SMTP setup errors never disclose account status.
    smtpConfiguration();
    const user = await User.findOne({ email });
    if (user) {
      const token = randomBytes(32).toString("hex");
      const tokenHash = hashResetToken(token);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await PasswordResetToken.deleteMany({ user: user._id });
      await PasswordResetToken.create({ user: user._id, tokenHash, expiresAt });
      const origin = (process.env.CLIENT_ORIGIN || "http://localhost:5173").replace(/\/$/, "");
      try {
        await sendPasswordResetEmail(email, `${origin}/reset-password#token=${encodeURIComponent(token)}`);
      } catch (error) {
        await PasswordResetToken.deleteOne({ tokenHash });
        throw error;
      }
    }
    return res.json({ message: "If an account exists for that email, a password reset link has been sent." });
  } catch (error) {
    return next(error);
  }
}

export async function validatePasswordReset(req, res, next) {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token || token.length > 256) return res.status(400).json({ valid: false, message: "This reset link is invalid or has expired." });
    const reset = await PasswordResetToken.findOne({ tokenHash: hashResetToken(token), expiresAt: { $gt: new Date() } }).select("_id");
    return res.status(reset ? 200 : 400).json(reset ? { valid: true } : { valid: false, message: "This reset link is invalid or has expired." });
  } catch (error) {
    return next(error);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const { token, password } = resetPasswordSchema.parse(req.body);
    const reset = await PasswordResetToken.findOneAndDelete({ tokenHash: hashResetToken(token), expiresAt: { $gt: new Date() } });
    if (!reset) return res.status(400).json({ message: "This reset link is invalid or has expired. Request a new link." });
    const user = await User.findById(reset.user).select("+tokenVersion");
    if (!user) return res.status(400).json({ message: "This reset link is invalid or has expired. Request a new link." });
    user.password = password;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    await PasswordResetToken.deleteMany({ user: user._id });
    return res.json({ message: "Your password has been reset. Please sign in with your new password." });
  } catch (error) {
    return next(error);
  }
}

export async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);
    const user = await User.create({
      name: data.name,
      email: data.email,
      password: data.password,
      role: data.role,
      isActive: data.role === "student"
    });

    if (user.role === "student") {
      await StudentProfile.create({
        user: user._id,
        rollNumber: data.profile?.rollNumber,
        urn: data.profile?.urn,
        department: data.profile?.department,
        year: data.profile?.year,
        age: data.profile?.age,
        gender: data.profile?.gender
      });
    }

    if (user.role === "counsellor") {
      await CounsellorProfile.create({
        user: user._id,
        qualification: data.profile?.qualification,
        specialization: data.profile?.specialization || []
      });
    }

    if (!user.isActive) {
      return res.status(201).json({ requiresApproval: true, message: "Your counsellor registration is awaiting administrator approval." });
    }
    const token = createAuthToken(user);
    return res.status(201).json({ user: user.toSafeObject(), token });
  } catch (error) {
    return next(error);
  }
}

export async function login(req, res, next) {
  try {
    const data = loginSchema.parse(req.body);
    const user = await User.findOne({ email: data.email.toLowerCase() }).select("+password +tokenVersion");

    if (!user || !(await user.comparePassword(data.password))) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (!user.isActive) return res.status(403).json({ message: "This account is inactive or awaiting administrator approval." });
    user.lastLoginAt = new Date();
    await user.save();

    const token = createAuthToken(user);
    return res.json({ user: user.toSafeObject(), token });
  } catch (error) {
    return next(error);
  }
}

export async function me(req, res) {
  return res.json({ user: req.user.toSafeObject() });
}
