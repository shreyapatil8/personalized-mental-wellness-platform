import assert from "node:assert/strict";
import { test } from "node:test";
import { safeRequestLogFormat } from "./requestLog.js";
import { notFoundHandler } from "./error.js";

test("request logs omit query values and replace database record identifiers", () => {
  const id = "0123456789abcdef01234567";
  const request = { path: `/appointments/${id}/summary`, originalUrl: `/api/counselling/appointments/${id}/summary?search=private@example.test` };
  const tokens = {
    method: () => "GET", status: () => "200", "response-time": () => "2.5",
    res: (_req, _res, header) => header === "content-length" ? "128" : undefined
  };
  const line = safeRequestLogFormat(tokens, request, {});
  assert.equal(line, "GET /api/counselling/appointments/:id/summary 200 2.5 ms 128");
  assert.doesNotMatch(line, /private@example\.test|0123456789abcdef01234567/);
});

test("unknown-route errors do not echo arbitrary paths, identifiers, or query values", () => {
  let status;
  let body;
  notFoundHandler({ method: "GET", originalUrl: "/api/private?search=private@example.test" }, {
    status(value) { status = value; return this; },
    json(value) { body = value; return this; }
  });
  assert.equal(status, 404);
  assert.deepEqual(body, { message: "Route not found." });
  assert.doesNotMatch(JSON.stringify(body), /private@example\.test|\/api\/private/);
});
