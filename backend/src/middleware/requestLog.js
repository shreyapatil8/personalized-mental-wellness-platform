export function safeRequestLogFormat(tokens, req, res) {
  const path = String(req.originalUrl || req.path || "/").split("?", 1)[0]
    .replace(/\/[a-f\d]{24}(?=\/|$)/giu, "/:id");
  return [
    tokens.method(req, res),
    path,
    tokens.status(req, res),
    tokens["response-time"](req, res),
    "ms",
    tokens.res(req, res, "content-length") || "-"
  ].join(" ");
}
