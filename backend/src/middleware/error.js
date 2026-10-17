export function notFoundHandler(req, res) {
  res.status(404).json({ message: "Route not found." });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error?.name === "ZodError") {
    return res.status(400).json({
      message: "Validation failed.",
      issues: error.issues
    });
  }

  if (error?.code === 11000) {
    if (error.keyPattern?.scheduledFor) return res.status(409).json({ message: "The student or counsellor already has an appointment in this slot." });
    return res.status(409).json({ message: "An account with this email already exists." });
  }
  if (error?.name === "CastError") return res.status(400).json({ message: "Invalid record identifier." });

  const status = error.statusCode || 500;
  const message = status === 500 ? "Something went wrong." : error.message;

  return res.status(status).json({ message });
}
