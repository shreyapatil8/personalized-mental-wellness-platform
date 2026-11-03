const windows = new Map();

export function createRateLimit({ limit, windowMs, keyPrefix }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${req.ip || req.socket.remoteAddress || "unknown"}`;
    let entry = windows.get(key);
    if (!entry || entry.expiresAt <= now) entry = { count: 0, expiresAt: now + windowMs };
    if (entry.count >= limit) {
      res.set("Retry-After", String(Math.ceil((entry.expiresAt - now) / 1000)));
      return res.status(429).json({ message: "Too many requests. Please wait a while and try again." });
    }
    entry.count += 1;
    windows.set(key, entry);
    if (windows.size > 10000) {
      for (const [storedKey, storedEntry] of windows) if (storedEntry.expiresAt <= now) windows.delete(storedKey);
      if (windows.size > 10000) return res.status(429).json({ message: "Too many requests. Please wait a while and try again." });
    }
    return next();
  };
}

export function clearRateLimitsForTests() { windows.clear(); }
