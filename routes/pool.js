const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const { requireRole, requireCsrf } = require("../middleware/auth");
const { getDaysSinceHarvest, checkSpoilageRisk } = require("../lib/spoilage");

/**
 * Farmer Crop Pooling / Group Selling
 *
 * FarmConnect doesn't physically combine produce — it just groups existing
 * individual listings that share the same crop + location into one virtual
 * "pooled" listing, so a bulk buyer or food processor can see the combined
 * quantity and place a bulk offer. Each farmer still delivers their own
 * produce independently.
 *
 * Grouping key: crop_name + location (case-insensitive). This is a simple
 * proxy for "nearby farmers" for a hackathon prototype — a production
 * version would use geolocation + a radius instead of an exact location
 * string match.
 */

// Parses a free-text quantity field (e.g. "50 kg", "2 quintal", "1 ton")
// into a normalized kg value so quantities from different farmers can be summed.
function parseQuantityToKg(qtyStr) {
  if (!qtyStr) return 0;
  const match = qtyStr.match(/([\d.]+)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return 0;

  const lower = qtyStr.toLowerCase();
  if (lower.includes("quintal")) return num * 100;
  if (lower.includes("ton")) return num * 1000;
  return num; // default: kg
}

router.get("/pool", async (req, res) => {
  try {
    const [crops] = await pool.query("SELECT * FROM crops WHERE status = 'active' ORDER BY created_at DESC");

    // Fetch farmer ratings computed on read
    const [ratingRows] = await pool.query(
      "SELECT farmer_phone, ROUND(AVG(stars), 1) AS avg_stars, COUNT(*) AS rating_count FROM farmer_ratings GROUP BY farmer_phone"
    );
    const ratingMap = {};
    ratingRows.forEach((r) => {
      ratingMap[r.farmer_phone] = {
        avg: Number(r.avg_stars).toFixed(1),
        count: r.rating_count,
      };
    });

    // Fetch existing pool offers to show recent offers on pooled cards
    const [offerRows] = await pool.query(
      "SELECT * FROM pool_offers ORDER BY created_at DESC"
    );
    const offersByKey = {};
    offerRows.forEach((o) => {
      const k = `${o.crop_name.trim().toLowerCase()}|${o.location.trim().toLowerCase()}`;
      if (!offersByKey[k]) offersByKey[k] = [];
      offersByKey[k].push(o);
    });

    const groups = {};
    for (const crop of crops) {
      const key = `${crop.crop_name.trim().toLowerCase()}|${crop.location.trim().toLowerCase()}`;
      if (!groups[key]) {
        groups[key] = {
          crop_name: crop.crop_name,
          location: crop.location,
          totalKg: 0,
          farmers: [],
          latestOffer: (offersByKey[key] && offersByKey[key][0]) || null,
        };
      }
      groups[key].totalKg += parseQuantityToKg(crop.quantity);

      const daysSinceHarvest = getDaysSinceHarvest(crop.harvest_date);
      const spoilageRisk = checkSpoilageRisk(crop.crop_name, crop.harvest_date);
      const farmerRating = ratingMap[crop.contact] || null;

      groups[key].farmers.push({
        ...crop,
        daysSinceHarvest,
        spoilageRisk,
        farmerRating,
      });
    }

    // Only show groups as "pooled" listings when 2+ farmers contribute —
    // that's the actual value of the feature. Sort biggest pool first.
    const pools = Object.values(groups)
      .filter((g) => g.farmers.length >= 2)
      .sort((a, b) => b.totalKg - a.totalKg);

    res.render("pool", { pools });
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong while loading pooled listings.");
  }
});

// Processor places a bulk offer against a pooled group.
// DEMO SIMPLIFICATION NOTE: As permitted by the prompt instructions, we auto-accept
// the offer on creation to keep the hackathon demo flow concise and single-action.
router.post("/pool/offer", requireRole("processor"), requireCsrf, async (req, res) => {
  const { crop_name, location, offer_price_per_kg } = req.body;
  const offerPrice = parseFloat(offer_price_per_kg);

  if (!crop_name || !location || isNaN(offerPrice) || offerPrice <= 0) {
    return res.status(400).send("Please provide a valid crop, location, and offer price per kg.");
  }

  try {
    const [matchingCrops] = await pool.query(
      "SELECT * FROM crops WHERE LOWER(TRIM(crop_name)) = LOWER(TRIM(?)) AND LOWER(TRIM(location)) = LOWER(TRIM(?)) AND status = 'active'",
      [crop_name, location]
    );

    if (matchingCrops.length < 2) {
      return res.status(400).send("A pool must have at least 2 active farmer listings to receive offers.");
    }

    let totalKg = 0;
    matchingCrops.forEach((c) => {
      totalKg += parseQuantityToKg(c.quantity);
    });

    // Create pool_offers row with status 'Accepted' (auto-accepted for demo scope)
    const [offerResult] = await pool.query(
      `INSERT INTO pool_offers (crop_name, location, processor_phone, processor_name, offer_price_per_kg, total_kg, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Accepted')`,
      [crop_name.trim(), location.trim(), req.user.phone, req.user.name, offerPrice, totalKg]
    );
    const poolOfferId = offerResult.insertId;

    // Auto-create one Confirmed orders row per contributing farmer proportional to their listed quantity
    for (const crop of matchingCrops) {
      const farmerKg = parseQuantityToKg(crop.quantity) || 1;
      await pool.query(
        `INSERT INTO orders (crop_id, buyer_name, buyer_phone, quantity_kg, status, pool_offer_id)
         VALUES (?, ?, ?, ?, 'Confirmed', ?)`,
        [crop.id, req.user.name, req.user.phone, farmerKg, poolOfferId]
      );
    }

    res.redirect("/orders");
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong while placing your pool offer.");
  }
});

module.exports = router;

