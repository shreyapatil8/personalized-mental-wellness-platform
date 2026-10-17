import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import counsellingRoutes from "./routes/counsellingRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import intelligenceRoutes from "./routes/intelligenceRoutes.js";
import predictionRoutes from "./routes/predictionRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import trackingRoutes from "./routes/trackingRoutes.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import { requestMetrics } from "./middleware/metrics.js";
import { safeRequestLogFormat } from "./middleware/requestLog.js";

const app = express();

app.use(helmet());
app.use(requestMetrics);
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan(safeRequestLogFormat));

app.use("/api/health", healthRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/counselling", counsellingRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/intelligence", intelligenceRoutes);
app.use("/api/predictions", predictionRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/tracking", trackingRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/documents", documentRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
