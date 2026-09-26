const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const { requireRole, requireCsrf } = require("../middleware/auth");
const { getReferencePrice, comparePrice } = require("../lib/pricing");
const { getDaysSinceHarvest, checkSpoilageRisk } = require("../lib/spoilage");
const { gradeProduce } = require("../lib/aiGrader");

// Show the "add crop" form (farmer side) — requires a farmer login so the
// listing is tied to a real account, not a free-text name/contact anyone
// could type in.
router.get("/add-crop", requireRole("farmer"), (req, res) => {
  res.render("add-crop", { reference: null });
});

// Small JSON endpoint the add-crop form calls (via fetch) as the farmer
// types a crop name, so they see today's mandi price before they submit.
router.get("/api/reference-price", requireRole("farmer"), async (req, res) => {
  try {
    const ref = await getReferencePrice(req.query.crop || "");
    res.json({ reference: ref });
  } catch (err) {
    console.error(err);
    res.status(500).json({ reference: null });
  }
});

// AI Produce Quality Grading endpoint (inspects photo, assigns Grade A/B/C, shelf life & observations)
router.post("/api/ai-grade", requireRole("farmer"), requireCsrf, async (req, res) => {
  const { image, cropName } = req.body;
  if (!image) {
    return res.status(400).json({ error: "Please provide an image of your produce to grade." });
  }

  try {
    const result = await gradeProduce(image, cropName);
    res.json({ success: true, result });
  } catch (err) {
    console.error("AI grading error:", err);
    res.status(500).json({ error: "Produce grading analysis failed. Please try again." });
  }
});

// Handle form submission — insert new crop listing under the logged-in farmer.
router.post("/add-crop", requireRole("farmer"), requireCsrf, async (req, res) => {
  const { crop_name, quantity, price, harvest_date, grade, image_url } = req.body;
  const farmer_name = req.user.name;
  const contact = req.user.phone;
  const location = (req.body.location || "").trim();

  if (!crop_name || !crop_name.trim() || !quantity || !quantity.trim() || !price || !location) {
    return res.status(400).send("Please fill in crop name, quantity, price and location.");
  }
  const priceNum = parseFloat(price);
  if (isNaN(priceNum) || priceNum <= 0) {
    return res.status(400).send("Enter a valid price.");
  }

  // Harvest date validation (optional date)
  let harvestDateVal = null;
  if (harvest_date && harvest_date.trim()) {
    const parsedDate = new Date(harvest_date.trim());
    if (!isNaN(parsedDate.getTime())) {
      harvestDateVal = harvest_date.trim();
    }
  }

  // Grade validation: A, B, or C (defaults to 'B')
  const validGrades = ["A", "B", "C"];
  const gradeVal = validGrades.includes((grade || "").trim().toUpperCase())
    ? (grade || "").trim().toUpperCase()
    : "B";

  const imageUrlVal = (image_url || "").trim() || null;

  try {
    await pool.query(
      "INSERT INTO crops (farmer_name, crop_name, quantity, price, contact, location, status, harvest_date, grade, image_url) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)",
      [farmer_name, crop_name.trim(), quantity.trim(), priceNum, contact, location, harvestDateVal, gradeVal, imageUrlVal]
    );
    res.redirect("/listings");
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong while saving your crop listing.");
  }
});

// Buyer browse page — shows active listings, optional crop + grade filter,
// fair-price comparison, harvest date / spoilage alert, and farmer star ratings.
router.get("/listings", async (req, res) => {
  const { crop, grade } = req.query;
  try {
    let query = "SELECT * FROM crops WHERE status = 'active'";
    const params = [];

    if (crop && crop.trim()) {
      query += " AND crop_name LIKE ?";
      params.push(`%${crop.trim()}%`);
    }

    const validGrades = ["A", "B", "C"];
    const activeGrade = grade && validGrades.includes(grade.trim().toUpperCase())
      ? grade.trim().toUpperCase()
      : null;

    if (activeGrade) {
      query += " AND grade = ?";
      params.push(activeGrade);
    }

    query += " ORDER BY created_at DESC";
    const [rows] = await pool.query(query, params);

    // One reference-price lookup per distinct crop name on the page, not
    // one per row, to avoid an N+1 query pattern.
    const distinctCrops = [...new Set(rows.map((r) => r.crop_name.toLowerCase()))];
    const refByCrop = {};
    await Promise.all(
      distinctCrops.map(async (name) => {
        refByCrop[name] = await getReferencePrice(name);
      })
    );

    // Fetch average farmer ratings computed on read
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

    const withExtras = rows.map((r) => {
      const ref = refByCrop[r.crop_name.toLowerCase()];
      const comparison = ref ? comparePrice(r.price, ref.modal_price) : null;
      const daysSinceHarvest = getDaysSinceHarvest(r.harvest_date);
      const spoilageRisk = checkSpoilageRisk(r.crop_name, r.harvest_date);
      const farmerRating = ratingMap[r.contact] || null;

      return {
        ...r,
        comparison,
        referenceMarket: ref ? ref.market : null,
        daysSinceHarvest,
        spoilageRisk,
        farmerRating,
      };
    });

    res.render("listings", {
      crops: withExtras,
      filter: crop || "",
      gradeFilter: activeGrade || "",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong while loading listings.");
  }
});

module.exports = router;
