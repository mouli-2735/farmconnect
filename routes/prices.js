const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const { getSellTip } = require("../lib/pricing");

// Price Dashboard — shows latest cached price per crop/market, each with a
// source and date, plus a sell-timing tip based on recent cached history.
router.get("/prices", async (req, res) => {
  try {
    // Get the most recent price row per crop+market.
    const [latest] = await pool.query(`
      SELECT mp.*
      FROM market_prices mp
      INNER JOIN (
        SELECT crop_name, market, MAX(price_date) AS max_date
        FROM market_prices
        GROUP BY crop_name, market
      ) latest_dates
      ON mp.crop_name = latest_dates.crop_name
      AND mp.market = latest_dates.market
      AND mp.price_date = latest_dates.max_date
      ORDER BY mp.crop_name, mp.market
    `);

    // Pull ALL the history needed for every row's tip in one query instead
    // of one query per row (the previous version's N+1 pattern), then group
    // it in memory.
    const [allHistory] = await pool.query(`
      SELECT crop_name, market, modal_price, price_date
      FROM market_prices
      ORDER BY crop_name, market, price_date DESC
    `);
    const historyByKey = {};
    for (const row of allHistory) {
      const key = `${row.crop_name}|${row.market}`;
      if (!historyByKey[key]) historyByKey[key] = [];
      if (historyByKey[key].length < 7) historyByKey[key].push(row);
    }

    const withTips = latest.map((row) => {
      const key = `${row.crop_name}|${row.market}`;
      row.tip = getSellTip(historyByKey[key] || []);
      return row;
    });

    // Staleness banner: if the freshest row we have is more than 2 days
    // old, say so rather than presenting cached data as if it were live.
    const newestDate = latest.length
      ? latest.reduce((max, r) => (r.price_date > max ? r.price_date : max), latest[0].price_date)
      : null;
    const daysStale = newestDate ? Math.floor((Date.now() - new Date(newestDate)) / 86400000) : null;

    res.render("prices", { prices: withTips, daysStale });
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong while loading prices.");
  }
});

module.exports = router;
