import mongoose from "mongoose";
import { z } from "zod";

import User, { USER_ROLES } from "../models/User.js";
import CounsellorProfile from "../models/CounsellorProfile.js";
import { buildAdminOverview, counsellorReviewExpression } from "../services/adminOverviewService.js";

const listUsersSchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  search: z.string().max(120).optional(),
  reviewStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

const userStatusSchema = z.object({
  isActive: z.boolean()
});

export async function getAdminOverview(req, res, next) {
  try {
    const { period } = z.object({ period: z.enum(["weekly", "monthly"]).default("weekly") }).parse(req.query);
    const overview = await buildAdminOverview({ period });
    return res.json({ overview });
  } catch (error) {
    return next(error);
  }
}

export async function listUsers(req, res, next) {
  try {
    const requests = req.path === "/counsellor-requests";
    const query = listUsersSchema.parse(requests ? { ...req.query, role: "counsellor" } : req.query);
    const filter = {};

    if (query.role) {
      filter.role = query.role;
    }

    if (query.status) {
      filter.isActive = query.status === "active";
    }

    if (query.reviewStatus) {
      filter.role = "counsellor";
      filter.$expr = { $eq: [counsellorReviewExpression, query.reviewStatus] };
    }

    if (query.search) {
      const expression = new RegExp(escapeRegex(query.search), "i");
      filter.$or = [{ name: expression }, { email: expression }];
    }

    const [users, total] = await Promise.all([
      User.find(filter).select("name email role isActive createdAt lastLoginAt +counsellorReviewStatus")
        .sort({ createdAt: -1, _id: -1 }).skip((query.page - 1) * query.limit).limit(query.limit),
      User.countDocuments(filter)
    ]);
    const profiles = requests ? await CounsellorProfile.find({ user: { $in: users.map(user => user._id) } }).select("user qualification specialization").lean() : [];
    const profileByUser = new Map(profiles.map(profile => [String(profile.user), profile]));
    return res.json({ users: users.map(user => ({ ...adminUser(user), ...(requests ? {
      qualification: profileByUser.get(String(user._id))?.qualification || "",
      specialization: profileByUser.get(String(user._id))?.specialization || []
    } : {}) })), pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
  } catch (error) {
    return next(error);
  }
}

export async function updateUserStatus(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid user id." });
    }

    const data = userStatusSchema.parse(req.body);

    if (req.params.id === req.user._id.toString() && !data.isActive) {
      return res.status(400).json({ message: "You cannot deactivate your own admin account." });
    }

    const user = await User.findById(req.params.id).select("+counsellorReviewStatus");

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    user.isActive = data.isActive;
    // Preserve existing approval through activation, including existing clients.
    if (user.role === "counsellor" && data.isActive) user.counsellorReviewStatus = "approved";
    // Save the previous approval before deactivation of a legacy active counsellor.
    if (user.role === "counsellor" && !user.counsellorReviewStatus && user.isModified("isActive")) user.counsellorReviewStatus = "approved";
    await user.save();
    return res.json({ user: adminUser(user) });
  } catch (error) {
    return next(error);
  }
}

export async function reviewCounsellor(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid counsellor id." });
    const { decision } = z.object({ decision: z.enum(["approved", "rejected"]) }).strict().parse(req.body);
    const user = await User.findOneAndUpdate({ _id: req.params.id, role: "counsellor",
      $expr: { $eq: [counsellorReviewExpression, "pending"] } },
    { $set: { counsellorReviewStatus: decision, isActive: decision === "approved" } }, { new: true, runValidators: true }).select("+counsellorReviewStatus");
    if (!user) return res.status(409).json({ message: "This request is no longer pending or is unavailable. Refresh the requests list." });
    return res.json({ user: adminUser(user) });
  } catch (error) { return next(error); }
}

function adminUser(user) {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role,
    isActive: user.isActive, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt || null,
    ...(user.role === "counsellor" ? {
      reviewStatus: user.counsellorReviewStatus || (user.isActive || user.lastLoginAt ? "approved" : "pending"),
      reviewRecorded: Boolean(user.counsellorReviewStatus)
    } : {}) };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
