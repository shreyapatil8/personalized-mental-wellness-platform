import { buildStudentDashboard } from "../services/dashboardService.js";

export async function getMyDashboard(req, res, next) {
  try {
    const dashboard = await buildStudentDashboard({ user: req.user });
    return res.json({ dashboard });
  } catch (error) {
    return next(error);
  }
}
