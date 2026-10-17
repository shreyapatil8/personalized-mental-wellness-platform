import "dotenv/config";
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import { connectDatabase } from "../config/db.js";

// Read-only audit. Never drops indexes or edits existing appointments automatically.
try {
  mongoose.set("autoIndex", false);
  await connectDatabase(process.env.MONGODB_URI);
  const active = { status: { $in: ["pending", "approved"] } };
  for (const field of ["student", "counsellor"]) {
    const conflicts = await Appointment.aggregate([{ $match: active },
      { $group: { _id: { owner: `$${field}`, slot: "$scheduledFor" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }, { $count: "count" }]);
    console.log(`${field} conflicting active slots: ${conflicts[0]?.count || 0}`);
  }
  const indexes = await Appointment.collection.indexes();
  for (const field of ["student", "counsellor"]) {
    const index = indexes.find((item) => item.key[field] === 1 && item.key.scheduledFor === 1);
    const valid = index?.unique && JSON.stringify(index.partialFilterExpression) === JSON.stringify(active);
    console.log(`${field} active-slot unique index: ${valid ? "ready" : "migration required"}`);
    if (!valid) process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
