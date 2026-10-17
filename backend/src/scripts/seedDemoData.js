import dotenv from "dotenv";
import mongoose from "mongoose";

import Appointment from "../models/Appointment.js";
import Assessment from "../models/Assessment.js";
import ConversationMessage from "../models/ConversationMessage.js";
import CounsellorProfile from "../models/CounsellorProfile.js";
import JournalEntry from "../models/JournalEntry.js";
import MoodLog from "../models/MoodLog.js";
import StudentProfile from "../models/StudentProfile.js";
import User from "../models/User.js";
import WellnessContextSnapshot from "../models/WellnessContextSnapshot.js";
import WellnessPrediction from "../models/WellnessPrediction.js";
import { connectDatabase } from "../config/db.js";

dotenv.config();

const demoPassword = "Password123!";
const demoUsers = {
  student: {
    name: "Priya",
    email: "student.demo@wellspace.local",
    role: "student"
  },
  counsellor: {
    name: "Dr. Kapil Lalit",
    email: "counsellor.demo@wellspace.local",
    role: "counsellor"
  },
  admin: {
    name: "YappingPriya",
    email: "admin.demo@wellspace.local",
    role: "admin"
  }
};

async function seedDemoData() {
  if (process.env.ALLOW_DEMO_SEED !== "true") throw new Error("Demo seed replaces demo-account records. Use a disposable database and set ALLOW_DEMO_SEED=true explicitly.");
  await connectDatabase(process.env.MONGODB_URI);

  const student = await upsertDemoUser(demoUsers.student);
  const counsellor = await upsertDemoUser(demoUsers.counsellor);
  const admin = await upsertDemoUser(demoUsers.admin);

  await Promise.all([
    StudentProfile.findOneAndUpdate(
      { user: student._id },
      {
        $set: {
          rollNumber: "1042",
          urn: "12345678",
          department: "Computer Science and Engineering",
          year: "Third Year",
          age: 20,
          gender: "Prefer not to say",
          wellnessGoals: ["Sleep better", "Manage exam stress", "Build a steady routine"],
          consentForCounsellorSummary: true,
          emergencyContact: {
            name: "Riya Sharma",
            phone: "9876543210",
            relation: "Sibling"
          }
        }
      },
      { new: true, upsert: true, runValidators: true }
    ),
    CounsellorProfile.findOneAndUpdate(
      { user: counsellor._id },
      {
        $set: {
          qualification: "M.Phil Clinical Psychology",
          specialization: ["Academic stress", "Sleep", "Anxiety"],
          availabilityNote: "Available Monday to Friday, 10 AM to 4 PM."
        }
      },
      { new: true, upsert: true, runValidators: true }
    )
  ]);

  await clearDemoStudentData(student._id);
  await createTrackingData(student._id);
  await createAssistantData(student._id);
  await createAppointmentData({ studentId: student._id, counsellorId: counsellor._id });

  console.log("Demo data seeded.");
  console.log(`Student: ${demoUsers.student.email} / ${demoPassword}`);
  console.log(`Counsellor: ${demoUsers.counsellor.email} / ${demoPassword}`);
  console.log(`Admin: ${demoUsers.admin.email} / ${demoPassword}`);
  console.log(`Admin id: ${admin._id}`);

  await mongoose.disconnect();
}

async function upsertDemoUser(userData) {
  const existing = await User.findOne({ email: userData.email }).select("+password");

  if (existing) {
    existing.name = userData.name;
    existing.role = userData.role;
    existing.isActive = true;
    existing.password = demoPassword;
    await existing.save();
    return existing;
  }

  return User.create({
    ...userData,
    password: demoPassword,
    isActive: true
  });
}

async function clearDemoStudentData(studentId) {
  await Promise.all([
    MoodLog.deleteMany({ student: studentId }),
    JournalEntry.deleteMany({ student: studentId }),
    Assessment.deleteMany({ student: studentId }),
    WellnessPrediction.deleteMany({ student: studentId }),
    ConversationMessage.deleteMany({ student: studentId }),
    WellnessContextSnapshot.deleteMany({ student: studentId }),
    Appointment.deleteMany({ student: studentId })
  ]);
}

async function createTrackingData(studentId) {
  const today = startOfDay(new Date());
  const moodPlan = [
    { offset: 6, mood: "low", moodScore: 2, stressLevel: 5, sleepHours: 5, note: "Felt behind on lab work." },
    { offset: 5, mood: "neutral", moodScore: 3, stressLevel: 4, sleepHours: 6, note: "Finished one assignment draft." },
    { offset: 4, mood: "very_low", moodScore: 1, stressLevel: 5, sleepHours: 4.5, note: "Could not sleep well." },
    { offset: 3, mood: "neutral", moodScore: 3, stressLevel: 3, sleepHours: 7, note: "Talked with a classmate." },
    { offset: 2, mood: "good", moodScore: 4, stressLevel: 3, sleepHours: 7.5, note: "Study plan felt manageable." },
    { offset: 1, mood: "neutral", moodScore: 3, stressLevel: 4, sleepHours: 6, note: "Exam pressure returned." },
    { offset: 0, mood: "low", moodScore: 2, stressLevel: 4, sleepHours: 5.5, note: "Worried about upcoming test." }
  ];

  await MoodLog.insertMany(
    moodPlan.map((item) => ({
      student: studentId,
      mood: item.mood,
      moodScore: item.moodScore,
      stressLevel: item.stressLevel,
      sleepHours: item.sleepHours,
      note: item.note,
      loggedFor: daysAgo(today, item.offset)
    }))
  );

  await JournalEntry.insertMany([
    {
      student: studentId,
      title: "Exam week worries",
      content: "I am worried that I will not finish revision on time, especially for operating systems.",
      tags: ["exam", "study"],
      sentiment: "negative"
    },
    {
      student: studentId,
      title: "A better evening",
      content: "A short walk and a call with home helped me feel steadier.",
      tags: ["routine", "family"],
      sentiment: "positive"
    }
  ]);

  await Assessment.create({
    student: studentId,
    responses: [2, 2, 3, 1, 2],
    rawScore: 10,
    percentageScore: 40,
    riskLevel: "moderate",
    takenAt: today
  });
}

async function createAssistantData(studentId) {
  await ConversationMessage.insertMany([
    {
      student: studentId,
      role: "student",
      content: "I feel stressed about exams and I am not sleeping well."
    },
    {
      student: studentId,
      role: "assistant",
      content:
        "Start with one 25-minute revision block and write down the next tiny task before sleeping. If this keeps feeling heavy, book a counselling checkpoint."
    }
  ]);

  await WellnessContextSnapshot.create({
    student: studentId,
    userMessage: "I feel stressed about exams and I am not sleeping well.",
    tokenBudget: 1400,
    candidateCount: 6,
    estimatedTokens: 260,
    selectedItems: [
      {
        sourceType: "assessment",
        sourceId: "demo-who5",
        title: "Moderate WHO-5 risk",
        content: "Latest WHO-5 score is 40 with moderate risk.",
        timestamp: new Date(),
        priority: 4,
        recencyScore: 1,
        relevanceScore: 0.8,
        totalScore: 4.8,
        estimatedTokens: 40
      }
    ],
    structuredPrompt:
      "Student is experiencing exam stress, lower sleep, and moderate WHO-5 risk. Offer supportive, non-diagnostic guidance and recommend counsellor support when needed."
  });
}

async function createAppointmentData({ studentId, counsellorId }) {
  await Appointment.create({
    student: studentId,
    counsellor: counsellorId,
    scheduledFor: daysFromNow(new Date(), 2),
    concernType: "academic_stress",
    notes: "Need help managing exam stress and sleep routine.",
    status: "approved",
    shareSummary: true
  });
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(9, 0, 0, 0);
  return date;
}

function daysAgo(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() - days);
  return date;
}

function daysFromNow(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  date.setHours(11, 0, 0, 0);
  return date;
}

seedDemoData().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
