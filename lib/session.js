/**
 * Minimal signed-cookie session store.
 *
 * Deliberately dependency-free (no express-session / cookie-parser) so the
 * project doesn't need a fresh `npm install` of new packages to get auth.
 * Sessions live in memory, so they reset when the server restarts — fine
 * for a prototype/demo, not for production (swap in a real session store
 * with a persistent backend, e.g. Redis, before going further than a demo).
 *
 * Every visitor gets an anonymous session on their first request (see
 * middleware/auth.js). Logging in upgrades that same session in place,
 * which keeps the CSRF token stable across login.
 */
const crypto = require("crypto");

const SECRET = process.env.SESSION_SECRET || "dev-insecure-secret-change-me";
if (!process.env.SESSION_SECRET) {
  console.warn(
    "[session] SESSION_SECRET is not set in .env — using an insecure default. " +
      "Set SESSION_SECRET before deploying anywhere real."
  );
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const sessions = new Map(); // sessionId -> { csrfToken, userId?, phone?, role?, name?, createdAt }

function sign(id) {
  const sig = crypto.createHmac("sha256", SECRET).update(id).digest("hex");
  return `${id}.${sig}`;
}

function verify(signedCookie) {
  if (!signedCookie) return null;
  const idx = signedCookie.lastIndexOf(".");
  if (idx === -1) return null;
  const id = signedCookie.slice(0, idx);
  const sig = signedCookie.slice(idx + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(id).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? id : null;
}

function createAnonymousSession() {
  const id = crypto.randomBytes(24).toString("hex");
  sessions.set(id, { csrfToken: crypto.randomBytes(16).toString("hex"), createdAt: Date.now() });
  return { id, cookie: sign(id) };
}

function getSession(signedCookie) {
  const id = verify(signedCookie);
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  return { id, ...s };
}

function updateSession(id, patch) {
  const s = sessions.get(id);
  if (!s) return null;
  Object.assign(s, patch);
  return { id, ...s };
}

function destroySession(signedCookie) {
  const id = verify(signedCookie);
  if (id) sessions.delete(id);
}

module.exports = { createAnonymousSession, getSession, updateSession, destroySession, sign };
