const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const { issueOtp, verifyOtp } = require("../lib/otp");
const { updateSession, sign } = require("../lib/session");
const { setSessionCookie, requireCsrf } = require("../middleware/auth");
const rateLimit = require("../lib/rateLimit");

const PHONE_RE = /^[6-9]\d{9}$/; // Indian mobile numbers

router.get("/login", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("login", { step: "phone", next: req.query.next || "/", error: null, phone: "" });
});

// Step 1: request an OTP for a phone number + role.
router.post("/login/request-otp", requireCsrf, rateLimit({ windowMs: 60_000, max: 5, message: "Too many code requests. Wait a minute and try again." }), async (req, res) => {
  const { phone, role, name, next: nextUrl } = req.body;

  if (!PHONE_RE.test(phone || "")) {
    return res.render("login", { step: "phone", next: nextUrl || "/", error: "Enter a valid 10-digit mobile number.", phone: phone || "" });
  }
  if (!["farmer", "buyer", "processor"].includes(role)) {
    return res.render("login", { step: "phone", next: nextUrl || "/", error: "Choose whether you're a farmer, buyer, or processor.", phone });
  }

  const { code, devVisible } = await issueOtp(phone, "login");

  res.render("login", {
    step: "otp",
    next: nextUrl || "/",
    error: null,
    phone,
    role,
    name: name || "",
    devOtp: devVisible ? code : null,
  });
});

// Step 2: verify the OTP, create/find the user, upgrade the session.
router.post("/login/verify-otp", requireCsrf, rateLimit({ windowMs: 60_000, max: 8, message: "Too many attempts. Wait a minute and try again." }), async (req, res) => {
  const { phone, code, role, name, next: nextUrl } = req.body;

  const ok = await verifyOtp(phone, code, "login");
  if (!ok) {
    return res.render("login", {
      step: "otp", next: nextUrl || "/", phone, role, name,
      error: "That code is wrong or expired. Request a new one.",
      devOtp: null,
    });
  }

  try {
    let [rows] = await pool.query("SELECT * FROM users WHERE phone = ?", [phone]);
    let user = rows[0];
    if (!user) {
      const [result] = await pool.query(
        "INSERT INTO users (phone, role, name) VALUES (?, ?, ?)",
        [phone, role, (name || "").trim() || "Farmer/Buyer"]
      );
      user = { id: result.insertId, phone, role, name: (name || "").trim() || "Farmer/Buyer" };
    }

    updateSession(req.session.id, {
      userId: user.id,
      phone: user.phone,
      role: user.role,
      name: user.name,
    });
    // session id is unchanged, so the existing cookie is still valid — no
    // new Set-Cookie needed, but we re-send it defensively in case this is
    // the very first request of the session.
    setSessionCookie(res, sign(req.session.id));

    res.redirect(nextUrl && nextUrl.startsWith("/") ? nextUrl : "/");
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong while logging you in.");
  }
});

router.post("/logout", requireCsrf, (req, res) => {
  const { destroySession } = require("../lib/session");
  destroySession(sign(req.session.id));
  res.redirect("/");
});

module.exports = router;
