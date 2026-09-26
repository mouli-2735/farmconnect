/**
 * Backtests the sell/wait rule (lib/pricing.js getSellTip) against whatever
 * price history is actually cached in market_prices — seed data by
 * default, or real fetched history once scripts/fetchPrices.js has been
 * run daily for a while.
 *
 * What it measures: for every day in the history (once there's at least
 * one prior day), it reproduces exactly the tip the app would have shown
 * that day, then checks whether the next day's actual price moved the way
 * the tip implied ("wait" implies price keeps rising; "sell" implies it
 * doesn't). It compares the rule's hit rate against a naive "always sell"
 * baseline (a flat prediction that price won't rise enough to be worth
 * waiting for) so a judge — or you — can see whether the rule beats doing
 * nothing smarter than a coin flip.
 *
 * Run with:
 *   node scripts/backtest.js
 *
 * IMPORTANT: with only 7 days of seed data per crop, this has very little
 * to backtest against and the result is not meaningful evidence — it is
 * only useful once real daily-fetched history has accumulated for a few
 * weeks. The script says so in its own output.
 */

require("dotenv").config();
const pool = require("../config/db");
const { getSellTip } = require("../lib/pricing");

async function run() {
  const [pairs] = await pool.query(
    `SELECT DISTINCT crop_name, market FROM market_prices ORDER BY crop_name, market`
  );

  if (!pairs.length) {
    console.log("No price data cached. Run seed.sql or scripts/fetchPrices.js first.");
    return;
  }

  let overallRuleHits = 0;
  let overallBaselineHits = 0;
  let overallTotal = 0;
  const rowsForPrint = [];

  for (const { crop_name, market } of pairs) {
    const [history] = await pool.query(
      `SELECT modal_price, price_date FROM market_prices
       WHERE crop_name = ? AND market = ? ORDER BY price_date ASC`,
      [crop_name, market]
    );

    let ruleHits = 0;
    let baselineHits = 0;
    let total = 0;

    // Walk forward day by day, reproducing what getSellTip would have said
    // using only the data available up to that day (no lookahead).
    for (let i = 1; i < history.length - 1; i++) {
      const upToToday = history.slice(0, i + 1).slice(-7).reverse(); // most-recent-first, matches prices.js
      const tip = getSellTip(upToToday.map((h) => ({ modal_price: h.modal_price })));
      if (tip.advice === "neutral") continue;

      const today = parseFloat(history[i].modal_price);
      const tomorrow = parseFloat(history[i + 1].modal_price);
      const roseNextDay = tomorrow > today;

      const ruleCorrect = (tip.advice === "wait" && roseNextDay) || (tip.advice === "sell" && !roseNextDay);
      const baselineCorrect = !roseNextDay; // baseline always predicts "sell" (no further rise)

      if (ruleCorrect) ruleHits++;
      if (baselineCorrect) baselineHits++;
      total++;
    }

    if (total > 0) {
      rowsForPrint.push({
        crop: crop_name,
        market,
        days: history.length,
        evaluated: total,
        ruleAccuracy: ((ruleHits / total) * 100).toFixed(1),
        baselineAccuracy: ((baselineHits / total) * 100).toFixed(1),
      });
      overallRuleHits += ruleHits;
      overallBaselineHits += baselineHits;
      overallTotal += total;
    }
  }

  console.log("\nBacktest: sell/wait rule vs naive 'always sell' baseline");
  console.log("=".repeat(70));
  for (const r of rowsForPrint) {
    console.log(
      `${r.crop.padEnd(10)} ${r.market.padEnd(14)} days=${String(r.days).padEnd(4)} ` +
        `evaluated=${String(r.evaluated).padEnd(4)} rule=${r.ruleAccuracy}% baseline=${r.baselineAccuracy}%`
    );
  }
  console.log("=".repeat(70));
  if (overallTotal > 0) {
    console.log(
      `Overall: rule ${((overallRuleHits / overallTotal) * 100).toFixed(1)}% vs baseline ` +
        `${((overallBaselineHits / overallTotal) * 100).toFixed(1)}% (${overallTotal} day-transitions evaluated)`
    );
  } else {
    console.log("Not enough history to evaluate anything yet.");
  }
  console.log(
    "\nCaveat: with only ~7 seeded days per crop, 'evaluated' will be very small " +
      "(often 0-5 transitions) and this result is not statistically meaningful. " +
      "Re-run this after scripts/fetchPrices.js has cached a few weeks of real " +
      "daily data before citing this number anywhere."
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backtest failed:", err.message);
    process.exit(1);
  });
