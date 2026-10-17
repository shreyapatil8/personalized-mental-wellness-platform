import { Router } from "express";
import { z } from "zod";
import Appointment from "../models/Appointment.js";
import SharedDocument from "../models/SharedDocument.js";
import { requireAuth, allowRoles } from "../middleware/auth.js";
import { validatePdf, uploadDocument, documentDownloadUrl, removeDocument } from "../services/documentStorageService.js";

const router = Router();
router.use(requireAuth, allowRoles("student", "counsellor"));
async function authorizedAppointment(id, user) {
  const filter = user.role === "student" ? { student: user._id } : { counsellor: user._id, status: { $in: ["pending", "approved"] } };
  return Appointment.findOne({ _id: id, ...filter });
}
router.get("/:appointmentId", async (req, res, next) => {
  try {
    if (!await authorizedAppointment(req.params.appointmentId, req.user)) return res.status(404).json({ message: "Appointment not available." });
    return res.json({ documents: await SharedDocument.find({ appointment: req.params.appointmentId }).sort({ createdAt: -1 }) });
  } catch (error) { return next(error); }
});
router.post("/:appointmentId", allowRoles("student"), async (req, res, next) => {
  let uploaded;
  try {
    const data = z.object({ name: z.string().trim().min(1).max(120), base64: z.string().min(1).max(700000), shareWithCounsellor: z.literal(true) }).parse(req.body);
    const appointment = await authorizedAppointment(req.params.appointmentId, req.user);
    if (!appointment || !["pending", "approved"].includes(appointment.status)) return res.status(404).json({ message: "An active appointment is required." });
    const bytes = validatePdf(data.base64);
    uploaded = await uploadDocument(bytes);
    const document = await SharedDocument.create({ ...uploaded, name: data.name, appointment: appointment._id, student: req.user._id });
    return res.status(201).json({ document: { _id: document._id, name: document.name, bytes: document.bytes, createdAt: document.createdAt } });
  } catch (error) {
    if (uploaded) await removeDocument(uploaded.publicId).catch(() => {});
    return next(error);
  }
});
router.post("/download/:id", async (req, res, next) => {
  try {
    const document = await SharedDocument.findById(req.params.id).select("+publicId");
    if (!document || !await authorizedAppointment(document.appointment, req.user)) return res.status(404).json({ message: "Document not available." });
    res.set("Cache-Control", "no-store");
    return res.json({ url: documentDownloadUrl(document.publicId), expiresInSeconds: 60 });
  } catch (error) { return next(error); }
});
router.delete("/:id", allowRoles("student"), async (req, res, next) => {
  try {
    const document = await SharedDocument.findOne({ _id: req.params.id, student: req.user._id }).select("+publicId");
    if (!document) return res.status(404).json({ message: "Document not found." });
    await removeDocument(document.publicId);
    await document.deleteOne();
    return res.status(204).send();
  } catch (error) { return next(error); }
});
export default router;
