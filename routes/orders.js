const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const { requireRole, requireCsrf } = require("../middleware/auth");

// Buyer / Processor places an order (COD only — no payment gateway). Requires a login
// so orders are tied to a real, contactable phone number.
router.post("/listings/:cropId/order", requireRole("buyer", "processor"), requireCsrf, async (req, res) => {
  const { cropId } = req.params;
  const quantity = parseFloat(req.body.quantity_kg);

  if (isNaN(quantity) || quantity <= 0) {
    return res.status(400).send("Enter a valid quantity to order.");
  }

  try {
    const [crops] = await pool.query("SELECT * FROM crops WHERE id = ? AND status = 'active'", [cropId]);
    if (!crops.length) {
      return res.status(404).send("This listing is no longer available.");
    }
    await pool.query(
      "INSERT INTO orders (crop_id, buyer_name, buyer_phone, quantity_kg, status) VALUES (?, ?, ?, ?, 'Pending')",
      [cropId, req.user.name, req.user.phone, quantity]
    );
    res.redirect("/orders");
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong while placing your order.");
  }
});

// Orders page — a farmer sees orders on their own listings; a buyer sees
// only their own orders placed elsewhere. No account sees anyone else's.
router.get("/orders", async (req, res) => {
  if (!req.user) return res.redirect("/login?next=/orders");

  try {
    let rows;
    if (req.user.role === "farmer") {
      [rows] = await pool.query(
        `SELECT o.id, o.crop_id, o.buyer_name, o.buyer_phone, o.status, o.created_at, o.quantity_kg, o.pool_offer_id,
                c.crop_name, c.farmer_name, c.contact AS farmer_contact, c.price, c.quantity
         FROM orders o JOIN crops c ON o.crop_id = c.id
         WHERE c.contact = ? ORDER BY o.created_at DESC`,
        [req.user.phone]
      );
    } else {
      [rows] = await pool.query(
        `SELECT o.id, o.crop_id, o.buyer_name, o.buyer_phone, o.status, o.created_at, o.quantity_kg, o.pool_offer_id,
                c.crop_name, c.farmer_name, c.contact AS farmer_contact, c.price, c.quantity
         FROM orders o JOIN crops c ON o.crop_id = c.id
         WHERE o.buyer_phone = ? ORDER BY o.created_at DESC`,
        [req.user.phone]
      );
    }

    if (rows.length > 0) {
      const orderIds = rows.map((r) => r.id);

      // Fetch all issues for these orders
      const [issues] = await pool.query(
        "SELECT * FROM order_issues WHERE order_id IN (?) ORDER BY created_at ASC",
        [orderIds]
      );
      const issuesByOrder = {};
      issues.forEach((iss) => {
        if (!issuesByOrder[iss.order_id]) issuesByOrder[iss.order_id] = [];
        issuesByOrder[iss.order_id].push(iss);
      });

      // Fetch ratings for these orders
      const [ratings] = await pool.query(
        "SELECT * FROM farmer_ratings WHERE order_id IN (?)",
        [orderIds]
      );
      const ratingsByOrder = {};
      ratings.forEach((rat) => {
        ratingsByOrder[rat.order_id] = rat;
      });

      rows = rows.map((r) => ({
        ...r,
        issues: issuesByOrder[r.id] || [],
        rating: ratingsByOrder[r.id] || null,
      }));
    }

    res.render("orders", { orders: rows, viewerRole: req.user.role });
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong while loading orders.");
  }
});

// Update order status — only the farmer who owns the underlying crop
// listing can move it, and only forward: Pending -> Confirmed -> Processing -> Delivered.
router.post("/orders/:id/status", requireRole("farmer"), requireCsrf, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const stages = ["Pending", "Confirmed", "Processing", "Delivered"];
  if (!stages.includes(status)) {
    return res.status(400).send("Invalid status.");
  }

  try {
    const [rows] = await pool.query(
      `SELECT o.status AS current_status, c.contact AS farmer_contact, c.id AS crop_id
       FROM orders o JOIN crops c ON o.crop_id = c.id WHERE o.id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).send("Order not found.");
    const own = rows[0];

    if (own.farmer_contact !== req.user.phone) {
      return res.status(403).send("You can only update orders on your own listings.");
    }
    const currentIdx = stages.indexOf(own.current_status);
    const nextIdx = stages.indexOf(status);
    if (nextIdx < currentIdx) {
      return res.status(400).send("Orders can only move forward: Pending → Confirmed → Processing → Delivered.");
    }

    await pool.query("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
    if (status === "Delivered") {
      await pool.query("UPDATE crops SET status = 'sold' WHERE id = ?", [own.crop_id]);
    }
    res.redirect("/orders");
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong while updating the order.");
  }
});

// Either party on an order (farmer who owns crop or buyer who placed order)
// can raise a grievance note.
router.post("/orders/:id/issues", requireCsrf, async (req, res) => {
  if (!req.user) return res.redirect("/login?next=/orders");
  const { id } = req.params;
  const note = (req.body.note || "").trim();

  if (!note) {
    return res.status(400).send("Please provide a note describing the grievance or issue.");
  }

  try {
    const [rows] = await pool.query(
      `SELECT o.id, o.buyer_phone, c.contact AS farmer_contact
       FROM orders o JOIN crops c ON o.crop_id = c.id
       WHERE o.id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).send("Order not found.");
    const order = rows[0];

    // Ownership check: must be either the farmer or the buyer on this order
    if (req.user.phone !== order.buyer_phone && req.user.phone !== order.farmer_contact) {
      return res.status(403).send("You can only raise grievances on your own orders.");
    }

    await pool.query(
      "INSERT INTO order_issues (order_id, raised_by_phone, note, status) VALUES (?, ?, ?, 'Open')",
      [id, req.user.phone, note]
    );
    res.redirect("/orders");
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong while submitting your issue.");
  }
});

// The farmer (who owns the underlying listing) can mark the issue resolved.
router.post("/orders/:id/issues/:issueId/resolve", requireRole("farmer"), requireCsrf, async (req, res) => {
  const { id, issueId } = req.params;

  try {
    const [rows] = await pool.query(
      `SELECT o.id, c.contact AS farmer_contact, oi.id AS issue_id
       FROM orders o
       JOIN crops c ON o.crop_id = c.id
       JOIN order_issues oi ON oi.order_id = o.id
       WHERE o.id = ? AND oi.id = ?`,
      [id, issueId]
    );
    if (!rows.length) return res.status(404).send("Issue or order not found.");
    const own = rows[0];

    if (own.farmer_contact !== req.user.phone) {
      return res.status(403).send("Only the farmer for this order can mark issues resolved.");
    }

    await pool.query(
      "UPDATE order_issues SET status = 'Resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND order_id = ?",
      [issueId, id]
    );
    res.redirect("/orders");
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong while resolving the issue.");
  }
});

// Buyer rates the farmer once an order's status is 'Delivered'.
router.post("/orders/:id/rate", requireCsrf, async (req, res) => {
  if (!req.user) return res.redirect("/login?next=/orders");
  const { id } = req.params;
  const stars = parseInt(req.body.stars, 10);
  const comment = (req.body.comment || "").trim() || null;

  if (isNaN(stars) || stars < 1 || stars > 5) {
    return res.status(400).send("Please select a valid rating between 1 and 5 stars.");
  }

  try {
    const [rows] = await pool.query(
      `SELECT o.id, o.status, o.buyer_phone, c.contact AS farmer_phone
       FROM orders o JOIN crops c ON o.crop_id = c.id
       WHERE o.id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).send("Order not found.");
    const order = rows[0];

    // Ownership check: must be the buyer on that order
    if (order.buyer_phone !== req.user.phone) {
      return res.status(403).send("Only the buyer who placed this order can rate the farmer.");
    }
    if (order.status !== "Delivered") {
      return res.status(400).send("You can only rate after an order has been Delivered.");
    }

    // Insert farmer rating (unique constraint on order_id ensures 1 rating per order)
    await pool.query(
      `INSERT INTO farmer_ratings (farmer_phone, buyer_phone, order_id, stars, comment)
       VALUES (?, ?, ?, ?, ?)`,
      [order.farmer_phone, req.user.phone, id, stars, comment]
    );
    res.redirect("/orders");
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).send("You have already rated this order.");
    }
    console.error(err);
    res.status(500).send("Something went wrong while saving your rating.");
  }
});

module.exports = router;
