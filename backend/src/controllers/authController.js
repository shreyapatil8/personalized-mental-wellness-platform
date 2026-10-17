import { z } from "zod";

import CounsellorProfile from "../models/CounsellorProfile.js";
import StudentProfile from "../models/StudentProfile.js";
import User from "../models/User.js";
import { DEPARTMENTS, STUDENT_YEARS } from "../constants/studentOptions.js";
import { createAuthToken } from "../utils/tokens.js";

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
    const user = await User.findOne({ email: data.email.toLowerCase() }).select("+password");

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
