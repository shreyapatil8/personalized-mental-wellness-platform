import mongoose from "mongoose";
import { z } from "zod";
import Appointment from "../models/Appointment.js";
import CounsellingMessage from "../models/CounsellingMessage.js";

function fail(statusCode, message) { throw Object.assign(new Error(message), { statusCode }); }
const validId = (value) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
const sendSchema = z.object({ clientMessageId: z.string().uuid(), content: z.string().trim().min(1).max(2000) });
const pageSchema = z.object({
  before: z.string().refine(validId).optional(),
  after: z.string().refine(validId).optional()
}).refine((value) => !(value.before && value.after), "Use one history cursor.");

export async function authorizeCounsellingChat(user, appointmentId, { writing = false } = {}) {
  if (!user?.isActive || !["student", "counsellor"].includes(user.role)) fail(403, "This session is not available to your account.");
  if (!validId(appointmentId)) fail(400, "Invalid session identifier.");
  const appointment = await Appointment.findOne({ _id: appointmentId, [user.role]: user._id })
    .select("student counsellor status scheduledFor").populate("student counsellor", "name role");
  if (!appointment) fail(404, "Counselling session not found.");
  if (!appointment.student || !appointment.counsellor || !["approved", "completed"].includes(appointment.status)) {
    fail(403, "Chat is available only after approval. Cancelled sessions are unavailable.");
  }
  if (writing && appointment.status !== "approved") fail(403, "This session is complete. Its conversation is read-only.");
  return appointment;
}

export function sessionDetails(appointment) {
  const person = (user) => ({ id: String(user._id), name: user.name, role: user.role });
  return { id: String(appointment._id), student: person(appointment.student), counsellor: person(appointment.counsellor),
    status: appointment.status, scheduledFor: appointment.scheduledFor, canSend: appointment.status === "approved" };
}

function messageDetails(message) {
  return { _id: String(message._id), appointment: String(message.appointment), sender: String(message.sender),
    clientMessageId: message.clientMessageId, content: message.content, createdAt: message.createdAt };
}

export async function loadCounsellingHistory(user, appointmentId, query = {}) {
  const appointment = await authorizeCounsellingChat(user, appointmentId);
  const { before, after } = pageSchema.parse(query);
  const filter = { appointment: appointment._id };
  if (before || after) filter._id = { [after ? "$gt" : "$lt"]: new mongoose.Types.ObjectId(after || before) };
  const rows = await CounsellingMessage.find(filter).sort({ _id: after ? 1 : -1 }).limit(51).lean();
  const hasMore = rows.length > 50;
  const page = rows.slice(0, 50);
  if (!after) page.reverse();
  return { session: sessionDetails(appointment), messages: page.map(messageDetails), hasMore };
}

export async function saveCounsellingMessage(user, appointmentId, payload) {
  const appointment = await authorizeCounsellingChat(user, appointmentId, { writing: true });
  const { clientMessageId, content } = sendSchema.parse(payload);
  await CounsellingMessage.init();
  const key = { appointment: appointment._id, sender: user._id, clientMessageId };
  let message = await CounsellingMessage.findOne(key);
  if (!message) {
    try { message = await CounsellingMessage.create({ ...key, content }); }
    catch (error) {
      if (error.code !== 11000) throw error;
      message = await CounsellingMessage.findOne(key);
      if (!message) throw error;
    }
  }
  if (message.content !== content) fail(409, "This message was already sent with different text. Reload the conversation before sending again.");
  return messageDetails(message);
}
