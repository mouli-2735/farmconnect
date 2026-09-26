/**
 * Fixed-window in-memory rate limiter. Good enough to stop a single client
 * from hammering OTP/login endpoints in a demo; a production deployment
 * behind a load balancer needs a shared store (e.g. Redis) instead, since
 * this resets per-process and doesn't share state across instances.
 */
const buckets = new Map();

function rateLimit({ windowMs = 60_000, max = 10, message } = {}) {
  return (req, res, next) => {
    // In development mode, allow rapid testing and automated test suites
    if (process.env.NODE_ENV !== "production") {
      return next();
    }
    const key = `${req.ip}:${req.baseUrl || ""}${req.path}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).send(message || "Too many requests. Please wait a minute and try again.");
    }
    next();
  };
}

module.exports = rateLimit;
