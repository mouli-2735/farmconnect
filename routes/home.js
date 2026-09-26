const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const { getDaysSinceHarvest, checkSpoilageRisk } = require("../lib/spoilage");
const { getReferencePrice, comparePrice } = require("../lib/pricing");

function parseQuantityToKg(qtyStr) {
  if (!qtyStr) return 0;
  const match = qtyStr.match(/([\d.]+)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return 0;
  const lower = qtyStr.toLowerCase();
  if (lower.includes("quintal")) return num * 100;
  if (lower.includes("ton")) return num * 1000;
  return num;
}

router.get("/", async (req, res) => {
  try {
    const user = req.user;

    // 1. GUEST / LOGGED-OUT USER LANDING PAGE
    if (!user) {
      const [recentCrops] = await pool.query(
        "SELECT * FROM crops WHERE status = 'active' ORDER BY created_at DESC LIMIT 3"
      );
      const [priceRows] = await pool.query(
        "SELECT crop_name, market, modal_price, price_date FROM market_prices ORDER BY price_date DESC, id DESC LIMIT 4"
      );
      return res.render("home", {
        dashRole: "guest",
        recentCrops,
        marketPrices: priceRows,
      });
    }

    // 2. FARMER COMMAND CENTER
    if (user.role === "farmer") {
      const [crops] = await pool.query(
        "SELECT * FROM crops WHERE contact = ? ORDER BY created_at DESC",
        [user.phone]
      );

      const cropsWithFreshness = crops.map((c) => ({
        ...c,
        daysSinceHarvest: getDaysSinceHarvest(c.harvest_date),
        spoilageRisk: checkSpoilageRisk(c.crop_name, c.harvest_date),
      }));

      const activeCrops = cropsWithFreshness.filter((c) => c.status === "active");
      const atRiskCount = activeCrops.filter((c) => c.spoilageRisk && c.spoilageRisk.isAtRisk).length;

      const [orders] = await pool.query(
        `SELECT o.*, c.crop_name, c.price
         FROM orders o JOIN crops c ON o.crop_id = c.id
         WHERE c.contact = ?
         ORDER BY o.created_at DESC`,
        [user.phone]
      );

      const [issueRows] = await pool.query(
        `SELECT COUNT(*) AS count
         FROM order_issues oi
         JOIN orders o ON oi.order_id = o.id
         JOIN crops c ON o.crop_id = c.id
         WHERE c.contact = ? AND oi.status = 'Open'`,
        [user.phone]
      );
      const openIssuesCount = issueRows[0]?.count || 0;

      const [ratingRows] = await pool.query(
        `SELECT ROUND(AVG(stars), 1) AS avg_stars, COUNT(*) AS count
         FROM farmer_ratings WHERE farmer_phone = ?`,
        [user.phone]
      );
      const rating = {
        avg: ratingRows[0]?.avg_stars ? Number(ratingRows[0].avg_stars).toFixed(1) : "—",
        count: ratingRows[0]?.count || 0,
      };

      const [mandiPrices] = await pool.query(
        "SELECT crop_name, market, modal_price, price_date FROM market_prices ORDER BY price_date DESC LIMIT 4"
      );

      return res.render("home", {
        dashRole: "farmer",
        activeCrops,
        allCrops: cropsWithFreshness,
        recentOrders: orders.slice(0, 5),
        stats: {
          activeCount: activeCrops.length,
          pendingOrders: orders.filter((o) => o.status === "Pending").length,
          processingOrders: orders.filter((o) => o.status === "Processing" || o.status === "Confirmed").length,
          deliveredOrders: orders.filter((o) => o.status === "Delivered").length,
          atRiskCount,
          openIssuesCount,
        },
        rating,
        mandiPrices,
      });
    }

    // 3. BUYER SOURCING DASHBOARD
    if (user.role === "buyer") {
      const [buyerOrders] = await pool.query(
        `SELECT o.*, c.crop_name, c.farmer_name, c.contact AS farmer_phone, c.price, c.location
         FROM orders o JOIN crops c ON o.crop_id = c.id
         WHERE o.buyer_phone = ?
         ORDER BY o.created_at DESC`,
        [user.phone]
      );

      const [ratingRecords] = await pool.query(
        "SELECT order_id FROM farmer_ratings WHERE buyer_phone = ?",
        [user.phone]
      );
      const ratedOrderIds = new Set(ratingRecords.map((r) => r.order_id));

      const ordersToRate = buyerOrders.filter(
        (o) => o.status === "Delivered" && !ratedOrderIds.has(o.id)
      );

      // Fresh Grade A Produce
      const [gradeACrops] = await pool.query(
        "SELECT * FROM crops WHERE status = 'active' AND grade = 'A' ORDER BY created_at DESC LIMIT 4"
      );

      const [latestPrices] = await pool.query(
        "SELECT crop_name, market, modal_price, price_date FROM market_prices ORDER BY price_date DESC LIMIT 4"
      );

      return res.render("home", {
        dashRole: "buyer",
        buyerOrders: buyerOrders.slice(0, 5),
        ordersToRate,
        gradeACrops,
        latestPrices,
        stats: {
          totalOrders: buyerOrders.length,
          activeDeliveries: buyerOrders.filter((o) => o.status === "Confirmed" || o.status === "Processing").length,
          delivered: buyerOrders.filter((o) => o.status === "Delivered").length,
          toRateCount: ordersToRate.length,
        },
      });
    }

    // 4. PROCESSOR BULK AGGREGATION DASHBOARD
    if (user.role === "processor") {
      const [activeCrops] = await pool.query(
        "SELECT * FROM crops WHERE status = 'active' ORDER BY created_at DESC"
      );

      // Group active crops by crop_name + location
      const groups = {};
      for (const c of activeCrops) {
        const k = `${c.crop_name.trim().toLowerCase()}|${c.location.trim().toLowerCase()}`;
        if (!groups[k]) {
          groups[k] = {
            crop_name: c.crop_name,
            location: c.location,
            totalKg: 0,
            farmers: [],
          };
        }
        groups[k].totalKg += parseQuantityToKg(c.quantity);
        groups[k].farmers.push(c);
      }

      const availablePools = Object.values(groups)
        .filter((g) => g.farmers.length >= 2)
        .sort((a, b) => b.totalKg - a.totalKg);

      const [offers] = await pool.query(
        "SELECT * FROM pool_offers WHERE processor_phone = ? ORDER BY created_at DESC",
        [user.phone]
      );

      const [bulkOrders] = await pool.query(
        `SELECT o.*, c.crop_name, c.farmer_name, c.location, c.price
         FROM orders o JOIN crops c ON o.crop_id = c.id
         WHERE o.buyer_phone = ? AND o.pool_offer_id IS NOT NULL
         ORDER BY o.created_at DESC`,
        [user.phone]
      );

      let totalTonnageSourcedKg = 0;
      bulkOrders.forEach((o) => {
        totalTonnageSourcedKg += parseFloat(o.quantity_kg) || 0;
      });

      return res.render("home", {
        dashRole: "processor",
        availablePools,
        offers: offers.slice(0, 5),
        bulkOrders: bulkOrders.slice(0, 5),
        stats: {
          availablePoolsCount: availablePools.length,
          offersPlaced: offers.length,
          inProcessing: bulkOrders.filter((o) => o.status === "Processing" || o.status === "Confirmed").length,
          delivered: bulkOrders.filter((o) => o.status === "Delivered").length,
          totalKgSourced: Math.round(totalTonnageSourcedKg),
        },
      });
    }

    // Default fallback
    res.render("home", { dashRole: "guest" });
  } catch (err) {
    console.error("Home route error:", err);
    res.render("home", { dashRole: "guest" });
  }
});

// Instruction manual & user guide (accessible before and after login)
router.get(["/manual", "/guide"], (req, res) => {
  res.render("manual", { user: req.user });
});

module.exports = router;
