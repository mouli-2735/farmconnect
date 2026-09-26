const pool = require("../config/db");

/**
 * Finds the most recent cached mandi price row for a crop name.
 * Match is case-insensitive substring (LIKE %name%) — a hackathon-grade
 * fuzzy match, not a proper crop-name normalization table. "Tomato" and
 * "Tomatoes" will both hit; genuinely different names won't.
 */
async function getReferencePrice(cropName) {
  if (!cropName || !cropName.trim()) return null;
  const [rows] = await pool.query(
    `SELECT crop_name, market, modal_price, price_date, source
     FROM market_prices
     WHERE crop_name LIKE ?
     ORDER BY price_date DESC
     LIMIT 1`,
    [`%${cropName.trim()}%`]
  );
  return rows[0] || null;
}

/**
 * Compares a farmer's per-unit listing price against the cached mandi
 * modal price.
 *
 * IMPORTANT UNIT CAVEAT: Agmarknet modal prices are per quintal (100 kg).
 * Farmer listings on this prototype are entered as a free per-unit price
 * with no enforced unit. This function assumes the listing price is
 * per kg and divides the modal price by 100 to match. If a farmer enters
 * a price per quintal, per dozen, or per bag, the percentage will be
 * wrong. [ROADMAP: add a required unit field to listings and convert
 * properly.] Always show both raw numbers next to the percentage so a
 * misleading comparison is at least checkable by eye.
 */
function comparePrice(listingPricePerUnit, modalPricePerQuintal) {
  const listing = parseFloat(listingPricePerUnit);
  const modal = parseFloat(modalPricePerQuintal);
  if (!listing || !modal) return null;

  const modalPerKg = modal / 100;
  const diffPct = ((listing - modalPerKg) / modalPerKg) * 100;

  return {
    modalPerKg: Number(modalPerKg.toFixed(2)),
    diffPct: Number(diffPct.toFixed(1)),
    direction: diffPct >= 0 ? "above" : "below",
  };
}

/**
 * Simple, explainable trend rule: compare the most recent cached price to
 * the average of the rest of the cached history for that crop+market.
 * Deliberately not a forecast model — see scripts/backtest.js for how this
 * rule performs against a naive baseline on whatever history you've cached.
 */
function getSellTip(history) {
  if (!history || history.length < 2) {
    return { label: "Not enough data", advice: "neutral" };
  }
  const prices = history.map((h) => parseFloat(h.modal_price)).filter((p) => !isNaN(p));
  if (prices.length < 2) {
    return { label: "Not enough data", advice: "neutral" };
  }

  const today = prices[0];
  const previous = prices.slice(1);
  const avgPrevious = previous.reduce((a, b) => a + b, 0) / previous.length;
  const percentChange = ((today - avgPrevious) / avgPrevious) * 100;

  if (percentChange > 3) {
    return {
      label: "Prices rising — consider waiting",
      advice: "wait",
      percentChange: Number(percentChange.toFixed(1)),
    };
  }
  return {
    label: "Good time to sell",
    advice: "sell",
    percentChange: Number(percentChange.toFixed(1)),
  };
}

module.exports = { getReferencePrice, comparePrice, getSellTip };
