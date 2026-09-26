const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const { getReferencePrice, getSellTip } = require("../lib/pricing");
const rateLimit = require("../lib/rateLimit");

/**
 * USSD callback, in the same request/response shape a real telecom USSD
 * gateway uses (this is the Africa's Talking / most-common-aggregator
 * convention): the gateway POSTs sessionId, phoneNumber, text (the FULL
 * accumulated input for the session, star-separated) and expects a plain
 * text body starting with "CON " (show more menu, session continues) or
 * "END " (show this and close the session).
 *
 * Point a real USSD aggregator's callback URL at POST /ussd/callback and
 * this logic runs unchanged — the only mock part of this feature is that
 * there's no aggregator account wired up, so /ussd (GET) serves an
 * in-browser simulator that talks to this same endpoint instead of a
 * phone's USSD dialer.
 */

router.get("/ussd", (req, res) => {
  res.render("ussd");
});

router.post(
  "/ussd/callback",
  rateLimit({ windowMs: 60_000, max: 60, message: "END Too many requests. Try again in a minute." }),
  async (req, res) => {
    res.set("Content-Type", "text/plain");
    const phoneNumber = (req.body.phoneNumber || "").toString().trim();
    const text = (req.body.text || "").toString().trim();
    const parts = text === "" ? [] : text.split("*");

    try {
      const reply = await route(phoneNumber, parts);
      res.send(reply);
    } catch (err) {
      console.error("USSD error:", err);
      res.send("END Something went wrong. Please try again later.");
    }
  }
);

async function route(phoneNumber, parts) {
  if (parts.length === 0) {
    return (
      "CON Welcome to FarmConnect\n" +
      "1. Check Today's Price\n" +
      "2. List My Crop\n" +
      "3. My Orders\n" +
      "4. Help"
    );
  }

  switch (parts[0]) {
    case "1":
      return handleCheckPrice(parts);
    case "2":
      return handleListCrop(phoneNumber, parts);
    case "3":
      return handleMyOrders(phoneNumber);
    case "4":
      return (
        "END FarmConnect shows mandi prices and lets you list crops from any " +
        "phone. For a smartphone, visit the full site. Helpline: 1800-XXX-XXXX."
      );
    default:
      return "END Invalid choice. Dial in again and pick a number from the menu.";
  }
}

const DEMO_CROPS = ["Tomato", "Onion", "Wheat"];

async function handleCheckPrice(parts) {
  if (parts.length === 1) {
    const lines = DEMO_CROPS.map((c, i) => `${i + 1}. ${c}`).join("\n");
    return `CON Select a crop:\n${lines}\n0. Back`;
  }

  const choice = parseInt(parts[1], 10);
  if (choice === 0) return route_root();
  const cropName = DEMO_CROPS[choice - 1];
  if (!cropName) return "END Invalid crop. Dial in again.";

  const [latest] = await pool.query(
    `SELECT * FROM market_prices WHERE crop_name = ? ORDER BY price_date DESC LIMIT 1`,
    [cropName]
  );
  if (!latest.length) {
    return `END No cached price for ${cropName} yet. Ask the app admin to run the price fetch.`;
  }
  const [history] = await pool.query(
    `SELECT modal_price FROM market_prices WHERE crop_name = ? AND market = ? ORDER BY price_date DESC LIMIT 7`,
    [cropName, latest[0].market]
  );
  const tip = getSellTip(history);
  const row = latest[0];
  return (
    `END ${cropName} (${row.market})\n` +
    `Modal: Rs ${row.modal_price}/quintal\n` +
    `Range: Rs ${row.min_price}-${row.max_price}\n` +
    `Date: ${new Date(row.price_date).toLocaleDateString("en-IN")}\n` +
    `Tip: ${tip.label}`
  );
}

function route_root() {
  return (
    "CON Welcome to FarmConnect\n" +
    "1. Check Today's Price\n" +
    "2. List My Crop\n" +
    "3. My Orders\n" +
    "4. Help"
  );
}

// text flow: 2 -> crop name -> quantity(kg) -> price/kg -> name -> confirm
async function handleListCrop(phoneNumber, parts) {
  if (parts.length === 1) {
    return "CON Enter crop name:";
  }
  if (parts.length === 2) {
    if (!parts[1].trim()) return "END Crop name can't be empty. Dial in again.";
    return "CON Enter quantity in kg (number only):";
  }
  if (parts.length === 3) {
    const qty = parseFloat(parts[2]);
    if (isNaN(qty) || qty <= 0) return "END Enter a valid quantity in kg. Dial in again.";
    return "CON Enter your price per kg in Rs (number only):";
  }
  if (parts.length === 4) {
    const price = parseFloat(parts[3]);
    if (isNaN(price) || price <= 0) return "END Enter a valid price. Dial in again.";
    return "CON Enter your name:";
  }
  if (parts.length === 5) {
    const [, cropName, qtyStr, priceStr, farmerName] = parts;
    const qty = parseFloat(qtyStr);
    const price = parseFloat(priceStr);
    if (!farmerName.trim()) return "END Name can't be empty. Dial in again.";
    if (!phoneNumber) return "END Could not identify your phone number. Dial in again.";

    await pool.query(
      `INSERT INTO crops (farmer_name, crop_name, quantity, price, contact, location, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [farmerName.trim(), cropName.trim(), `${qty} kg`, price, phoneNumber, "Not specified (USSD)"]
    );

    const ref = await getReferencePrice(cropName.trim());
    let priceNote = "";
    if (ref && ref.modal_price) {
      const modalPerKg = ref.modal_price / 100;
      const diffPct = (((price - modalPerKg) / modalPerKg) * 100).toFixed(1);
      priceNote = `\nMandi ref: ~Rs ${modalPerKg.toFixed(2)}/kg (${diffPct >= 0 ? "+" : ""}${diffPct}% vs yours)`;
    }

    return `END Listed: ${cropName.trim()}, ${qty}kg at Rs ${price}/kg.${priceNote}\nBuyers can now see this listing.`;
  }
  return "END Something went wrong. Dial in again.";
}

async function handleMyOrders(phoneNumber) {
  if (!phoneNumber) return "END Could not identify your phone number.";

  const [asFarmer] = await pool.query(
    `SELECT o.status, c.crop_name, o.buyer_name
     FROM orders o JOIN crops c ON o.crop_id = c.id
     WHERE c.contact = ? ORDER BY o.created_at DESC LIMIT 3`,
    [phoneNumber]
  );
  const [asBuyer] = await pool.query(
    `SELECT o.status, c.crop_name, c.farmer_name
     FROM orders o JOIN crops c ON o.crop_id = c.id
     WHERE o.buyer_phone = ? ORDER BY o.created_at DESC LIMIT 3`,
    [phoneNumber]
  );

  if (!asFarmer.length && !asBuyer.length) {
    return "END No orders found for this number yet.";
  }

  let lines = [];
  asFarmer.forEach((o) => lines.push(`Sell ${o.crop_name} to ${o.buyer_name}: ${o.status}`));
  asBuyer.forEach((o) => lines.push(`Buy ${o.crop_name} from ${o.farmer_name}: ${o.status}`));

  return `END Your recent orders:\n${lines.slice(0, 4).join("\n")}`;
}

module.exports = router;
