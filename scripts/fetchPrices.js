/**
 * Fetches daily mandi prices from data.gov.in's Agmarknet resource and
 * caches them into the local market_prices table.
 *
 * Run this manually (or on a schedule, e.g. a daily cron job) — NOT on
 * every page load — so the app never depends on the live API being up.
 *
 *   node scripts/fetchPrices.js
 *
 * Get your own free API key at https://data.gov.in/ (sign up, then
 * "My Account" -> "API Keys") and put it in .env as AGMARKNET_API_KEY.
 * There is no fallback key baked into this file — the public sample key
 * is heavily rate-limited and shouldn't be committed to a repo, so this
 * script now refuses to run without AGMARKNET_API_KEY set.
 *
 * Upsert, not insert: re-running this script no longer creates duplicate
 * rows. schema.sql has a UNIQUE KEY on (crop_name, variety, market,
 * price_date), and this script does INSERT ... ON DUPLICATE KEY UPDATE.
 *
 * Pagination: data.gov.in returns paged results. This script requests
 * pages of "limit" size until a page comes back short or a page-count
 * safety cap is hit, instead of only ever reading the first 200 rows.
 */

require("dotenv").config();
const pool = require("../config/db");

const API_KEY = process.env.AGMARKNET_API_KEY;
const RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070"; // Variety-wise Daily Market Prices - data.gov.in
const BASE_URL = `https://api.data.gov.in/resource/${RESOURCE_ID}`;
const PAGE_SIZE = 200;
const MAX_PAGES = 25; // safety cap: 25 * 200 = 5,000 rows per run

const FILTERS = {
  "filters[state]": process.env.DEMO_STATE || "Maharashtra",
};

function toIsoDate(ddmmyyyy) {
  if (!ddmmyyyy) return new Date().toISOString().split("T")[0];
  const parts = ddmmyyyy.split("/");
  if (parts.length !== 3) return new Date().toISOString().split("T")[0];
  const [dd, mm, yyyy] = parts;
  return `${yyyy}-${mm}-${dd}`;
}

async function fetchPage(offset) {
  const params = new URLSearchParams({
    "api-key": API_KEY,
    format: "json",
    limit: String(PAGE_SIZE),
    offset: String(offset),
    ...FILTERS,
  });
  const url = `${BASE_URL}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function fetchPrices() {
  if (!API_KEY) {
    console.error(
      "AGMARKNET_API_KEY is not set in .env. Get a free key at https://data.gov.in/ " +
        "(My Account -> API Keys) and set it before running this script."
    );
    process.exit(1);
  }

  let offset = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    console.log(`Fetching page ${page + 1} (offset ${offset})...`);
    const data = await fetchPage(offset);
    const records = data.records || [];

    if (records.length === 0) {
      console.log("No more records.");
      break;
    }

    for (const rec of records) {
      const crop = rec.commodity;
      const variety = rec.variety || "";
      const market = rec.market;
      const state = rec.state;
      const minPrice = parseFloat(rec.min_price) || null;
      const maxPrice = parseFloat(rec.max_price) || null;
      const modalPrice = parseFloat(rec.modal_price) || null;
      const priceDate = toIsoDate(rec.arrival_date);

      if (!crop || !market) {
        totalSkipped++;
        continue;
      }

      const [result] = await pool.query(
        `INSERT INTO market_prices
           (crop_name, variety, market, state, min_price, max_price, modal_price, price_date, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'data.gov.in (Agmarknet)')
         ON DUPLICATE KEY UPDATE
           min_price = VALUES(min_price),
           max_price = VALUES(max_price),
           modal_price = VALUES(modal_price),
           state = VALUES(state),
           fetched_at = CURRENT_TIMESTAMP`,
        [crop, variety, market, state, minPrice, maxPrice, modalPrice, priceDate]
      );
      // affectedRows is 1 for a fresh insert, 2 for an update-on-duplicate in MySQL.
      if (result.affectedRows === 1) totalInserted++;
      else totalUpdated++;
    }

    if (records.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;
  }

  console.log(
    `Done. Inserted ${totalInserted} new rows, updated ${totalUpdated} existing rows, skipped ${totalSkipped} incomplete records.`
  );
  if (totalInserted === 0 && totalUpdated === 0) {
    console.log("No usable records came back — check DEMO_STATE and the resource's current field names.");
  }
}

fetchPrices()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to fetch prices:", err.message);
    process.exit(1);
  });
