import Appointment from "../models/Appointment.js";
import WellnessContextSnapshot from "../models/WellnessContextSnapshot.js";

export async function invalidateDerivedContext(studentId, sourceId) {
  await Promise.all([
    WellnessContextSnapshot.deleteMany({ student: studentId, ...(sourceId ? { $or: [
      { "selectedItems.sourceId": String(sourceId) },
      { "selectedItems.sourceIds": String(sourceId) }
    ] } : {}) }),
    Appointment.updateMany({ student: studentId }, { $unset: { generatedSummary: 1 } })
  ]);
}
