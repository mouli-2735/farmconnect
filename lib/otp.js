/**
 * Phone-number OTP login. There is no SMS gateway wired up (that needs a
 * paid aggregator account), so in non-production mode the OTP is returned
 * to the caller and shown directly on screen, clearly labeled as a demo
 * shortcut. Swap sendViaSms() for a real gateway call before using this
 * anywhere the OTP shouldn't be visible to whoever is at the keyboard.
 */
const crypto = require("crypto");
const pool = require("../config/db");

const OTP_TTL_MINUTES = 5;
const isProd = process.env.NODE_ENV === "production";

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000)); // always 6 digits
}

async function issueOtp(phone, purpose = "login") {
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  await pool.query(
    "INSERT INTO otp_codes (phone, code, purpose, expires_at) VALUES (?, ?, ?, ?)",
    [phone, code, purpose, expiresAt]
  );

  // [ROADMAP] real SMS delivery: await sendViaSms(phone, `Your FarmConnect code is ${code}`);
  const devVisible = !isProd;
  return { code: devVisible ? code : null, devVisible };
}

async function verifyOtp(phone, submittedCode, purpose = "login") {
  const [rows] = await pool.query(
    `SELECT * FROM otp_codes
     WHERE phone = ? AND purpose = ? AND consumed = 0
     ORDER BY id DESC LIMIT 1`,
    [phone, purpose]
  );
  if (!rows.length) return false;
  const row = rows[0];
  if (new Date(row.expires_at) < new Date()) return false;
  if (String(row.code) !== String(submittedCode).trim()) return false;

  await pool.query("UPDATE otp_codes SET consumed = 1 WHERE id = ?", [row.id]);
  return true;
}

module.exports = { issueOtp, verifyOtp, OTP_TTL_MINUTES };
