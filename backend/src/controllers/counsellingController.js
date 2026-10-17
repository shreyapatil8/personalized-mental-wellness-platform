import mongoose from "mongoose";
import { z } from "zod";

import Appointment, { APPOINTMENT_STATUSES, CONCERN_TYPES } from "../models/Appointment.js";
import CounsellorProfile from "../models/CounsellorProfile.js";
import User from "../models/User.js";
import { buildCounsellingSummary } from "../services/counsellingSummaryService.js";
import { canChangeAppointmentStatus, isFutureAppointment } from "../utils/counsellingRules.js";
import { notifyCounsellingStatus } from "../services/counsellingSocketService.js";

const appointmentSchema = z.object({
  counsellorId: z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), "Invalid counsellor id."),
  scheduledFor: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
  concernType: z.enum(CONCERN_TYPES),
  notes: z.string().max(1000).optional().or(z.literal("")),
  shareSummary: z.boolean().optional()
});

const statusSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES),
  counsellorNotes: z.string().max(1500).optional().or(z.literal(""))
});

const appointmentPopulation = [
  { path: "student", select: "name email role" },
  { path: "counsellor", select: "name email role" }
];
const summaryGenerations = new Set();

export async function listCounsellors(req, res, next) {
  try {
    const counsellorUsers = await User.find({ role: "counsellor", isActive: true }).select("name email role");
    const profiles = await CounsellorProfile.find({
      user: { $in: counsellorUsers.map((user) => user._id) }
    });

    const profileByUser = new Map(profiles.map((profile) => [profile.user.toString(), profile]));
    const counsellors = counsellorUsers.map((user) => ({
      user: user.toSafeObject(),
      profile: profileByUser.get(user._id.toString()) || null
    }));

    return res.json({ counsellors });
  } catch (error) {
    return next(error);
  }
}

export async function createAppointment(req, res, next) {
  try {
    const data = appointmentSchema.parse(req.body);

    if (!isFutureAppointment(data.scheduledFor)) {
      return res.status(400).json({ message: "Appointment time must be in the future." });
    }
    if (data.scheduledFor.getUTCMinutes() % 30 || data.scheduledFor.getUTCSeconds() || data.scheduledFor.getUTCMilliseconds()) {
      return res.status(400).json({ message: "Choose a 30-minute appointment slot on the hour or half hour." });
    }

    const counsellor = await User.findOne({
      _id: data.counsellorId,
      role: "counsellor",
      isActive: true
    });

    if (!counsellor) {
      return res.status(404).json({ message: "Counsellor not found." });
    }

    const appointment = await Appointment.create({
      student: req.user._id,
      counsellor: counsellor._id,
      scheduledFor: data.scheduledFor,
      concernType: data.concernType,
      notes: data.notes || "",
      shareSummary: data.shareSummary ?? false
    });

    await appointment.populate(appointmentPopulation);
    return res.status(201).json({ appointment });
  } catch (error) {
    return next(error);
  }
}

export async function listMyAppointments(req, res, next) {
  try {
    const filter = req.user.role === "student" ? { student: req.user._id } : { counsellor: req.user._id };
    const appointments = await Appointment.find(filter).select(req.user.role === "counsellor" ? "+counsellorNotes" : "").sort({ scheduledFor: -1 }).populate(appointmentPopulation);

    return res.json({ appointments });
  } catch (error) {
    return next(error);
  }
}

export async function updateAppointmentStatus(req, res, next) {
  try {
    const data = statusSchema.parse(req.body);
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found." });
    }

    const ownsAppointment =
      req.user.role === "student"
        ? appointment.student.equals(req.user._id)
        : appointment.counsellor.equals(req.user._id);

    if (
      !canChangeAppointmentStatus({
        role: req.user.role,
        currentStatus: appointment.status,
        nextStatus: data.status,
        ownsAppointment
      })
    ) {
      return res.status(403).json({ message: "This appointment status change is not allowed." });
    }

    appointment.status = data.status;
    if (req.user.role === "counsellor" && data.counsellorNotes != null) {
      appointment.counsellorNotes = data.counsellorNotes;
    }

    await appointment.save();
    await notifyCounsellingStatus(appointment);
    await appointment.populate(appointmentPopulation);

    return res.json({ appointment });
  } catch (error) {
    return next(error);
  }
}

export async function getAppointmentSummary(req, res, next) {
  try {
    const appointment = await Appointment.findOne({
      _id: req.params.id,
      counsellor: req.user._id,
      status: { $in: ["pending", "approved"] }
    }).select("+generatedSummary").populate(appointmentPopulation);

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found." });
    }
    if (req.method === "POST" && summaryGenerations.has(String(appointment._id))) {
      return res.status(409).json({ message: "A briefing is already being generated for this appointment. Refresh shortly to see its status." });
    }
    if (req.method === "POST") summaryGenerations.add(String(appointment._id));
    try {
    const summary = await buildCounsellingSummary({ appointment, generate: req.method === "POST" });
    return res.json({ summary });
    } finally {
      if (req.method === "POST") summaryGenerations.delete(String(appointment._id));
    }
  } catch (error) {
    return next(error);
  }
}

export async function updateSessionNotes(req, res, next) {
  try {
    const data = z.object({ counsellorNotes: z.string().trim().max(1500), progressUpdate: z.string().trim().max(1500) }).parse(req.body);
    const appointment = await Appointment.findOneAndUpdate({ _id: req.params.id, counsellor: req.user._id,
      status: { $in: ["approved", "completed"] } }, { $set: { ...data, notesUpdatedAt: new Date() } },
      { new: true, runValidators: true }).select("+counsellorNotes").populate(appointmentPopulation);
    if (!appointment) return res.status(404).json({ message: "An approved or completed appointment assigned to you is required." });
    return res.json({ appointment });
  } catch (error) { return next(error); }
}

export async function updateSummaryConsent(req, res, next) {
  try {
    const data = z.object({ shareSummary: z.boolean() }).parse(req.body);
    const appointment = await Appointment.findOneAndUpdate({ _id: req.params.id, student: req.user._id },
      { $set: data, $unset: { generatedSummary: 1 } }, { new: true }).populate(appointmentPopulation);
    if (!appointment) return res.status(404).json({ message: "Appointment not found." });
    return res.json({ appointment });
  } catch (error) { return next(error); }
}
