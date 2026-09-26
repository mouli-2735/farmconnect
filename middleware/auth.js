const { createAnonymousSession, getSession, sign } = require("../lib/session");

const COOKIE_NAME = "fc_session";
const isProd = process.env.NODE_ENV === "production";

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = decodeURIComponent(pair.slice(idx + 1).trim());
    out[k] = v;
  });
  return out;
}

function setSessionCookie(res, signedValue) {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(signedValue)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 12}`,
  ];
  if (isProd) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

// Every request gets a session (anonymous or logged in). This also gives
// every page a stable CSRF token, including for pre-login forms like OTP request.
function attachSession(req, res, next) {
  const cookies = parseCookies(req);
  req.cookies = cookies;

  let session = getSession(cookies[COOKIE_NAME]);
  if (!session) {
    const created = createAnonymousSession();
    session = { id: created.id, csrfToken: undefined };
    // re-fetch to get the actual stored record (csrfToken included)
    session = getSession(created.cookie);
    setSessionCookie(res, created.cookie);
  }

  req.session = session;
  req.user = session && session.userId ? {
    id: session.userId,
    phone: session.phone,
    role: session.role,
    name: session.name,
  } : null;

  res.locals.user = req.user;
  res.locals.csrfToken = session.csrfToken;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}

function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    if (!allowed.includes(req.user.role)) {
      return res.status(403).send(`This action requires a ${allowed.join("/")} account. You're logged in as a ${req.user.role}.`);
    }
    next();
  };
}

function requireCsrf(req, res, next) {
  const token = req.body && req.body._csrf;
  if (!req.session || !token || token !== req.session.csrfToken) {
    return res.status(403).send("Your session expired or the form was resubmitted incorrectly. Go back and try again.");
  }
  next();
}

module.exports = { attachSession, requireAuth, requireRole, requireCsrf, setSessionCookie, COOKIE_NAME };

module.exports.parseCookies = parseCookies;
