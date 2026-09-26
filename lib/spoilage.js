/**
 * Spoilage and staleness logic for farm produce.
 * Identifies perishable crops (e.g. Tomato, Onion) past freshness threshold
 * and computes days elapsed since harvest.
 */

// Perishable crops and their freshness thresholds in days.
const PERISHABLE_THRESHOLDS = {
  tomato: 3,
  tomatoes: 3,
  onion: 3,
  onions: 3,
};

/**
 * Computes the number of calendar days between harvestDate and baseDate (today).
 * Returns null if harvestDate is falsy or invalid.
 */
function getDaysSinceHarvest(harvestDate, baseDate = new Date()) {
  if (!harvestDate) return null;
  const hDate = new Date(harvestDate);
  if (isNaN(hDate.getTime())) return null;

  // Normalize dates to midnight to compare full calendar days
  const hMid = new Date(hDate.getFullYear(), hDate.getMonth(), hDate.getDate());
  const bMid = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());

  const diffMs = bMid.getTime() - hMid.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Checks whether a crop is perishable and has exceeded its freshness threshold.
 * Returns { isAtRisk: boolean, days: number | null, threshold: number | null, warning: string | null }
 */
function checkSpoilageRisk(cropName, harvestDate, baseDate = new Date()) {
  const days = getDaysSinceHarvest(harvestDate, baseDate);
  if (days === null) {
    return { isAtRisk: false, days: null, threshold: null, warning: null };
  }

  const normalized = (cropName || "").trim().toLowerCase();
  let threshold = null;

  for (const [key, thresh] of Object.entries(PERISHABLE_THRESHOLDS)) {
    if (normalized.includes(key)) {
      threshold = thresh;
      break;
    }
  }

  if (threshold !== null && days > threshold) {
    return {
      isAtRisk: true,
      days,
      threshold,
      warning: "Consider a price drop or pooling",
    };
  }

  return {
    isAtRisk: false,
    days,
    threshold,
    warning: null,
  };
}

module.exports = {
  PERISHABLE_THRESHOLDS,
  getDaysSinceHarvest,
  checkSpoilageRisk,
};
