import { performance } from "node:perf_hooks";
import mongoose from "mongoose";
import RequestMetric from "../models/RequestMetric.js";

export function requestMetrics(req, res, next) {
  const started = performance.now();
  const section = /^\/api\/(auth|admin|chat|counselling|dashboard|health|intelligence|predictions|profile|tracking|feedback|documents)(?:\/|$)/.exec(req.path)?.[1];
  res.once("finish", () => {
    if (mongoose.connection.readyState !== 1 || process.env.NODE_ENV === "test") return;
    // Route templates only: no user IDs, request bodies, query text, IPs or tokens.
    const route = req.route && section ? `/api/${section}${req.route.path}` : "unmatched";
    if (route.startsWith("/api/health")) return;
    RequestMetric.create({ route, method: req.method, status: res.statusCode,
      durationMs: Math.round((performance.now() - started) * 100) / 100 }).catch(() => {});
  });
  next();
}
