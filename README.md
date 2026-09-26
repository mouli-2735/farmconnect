# FarmConnect — SIH 2026 (PS 26132)

Farmer-buyer market linkage platform: mandi prices, crop listings, orders,
group selling, and a USSD path for basic phones.

## Setup

```
npm install
cp .env.example .env      # fill in DB_* and a random SESSION_SECRET
mysql -u root -p < schema.sql
mysql -u root -p farmconnect < seed.sql
npm start
```

Visit `http://localhost:3000`. Seeded demo accounts (login with these phone
numbers, OTP shown on-screen since no SMS gateway is wired up):
- `9900011111`–`9900044444` — farmers (Anil, Balaji, Chandrakant, Dnyaneshwar)
- `9900099999` — buyer (Suresh Traders)
- `9900088888` — processor (Kisan Food Processors)

To cache real prices instead of just seed data: get a free key at
data.gov.in, put it in `.env` as `AGMARKNET_API_KEY`, then run
`npm run fetch-prices`. Run it daily (e.g. via cron) to build up real
history — `npm run backtest` then tells you how the sell/wait rule
actually performs against that history.

## What's built vs. roadmap

| Feature | Status |
|---|---|
| Price dashboard with date + source per row | Built |
| Sell-now / wait tip (rule-based, not ML) | Built, with `scripts/backtest.js` to check it |
| Fair-price check on listing (your price vs. mandi reference) | Built — see the unit caveat in `lib/pricing.js` |
| Crop listing, browsing, filtering | Built |
| AI Produce Quality Scanner & Grader | Built (`lib/aiGrader.js`, camera/photo inspection, Agmark grading A/B/C, shelf life estimation) |
| Role-Tailored Command Centers (Farmer, Buyer, Processor) | Built (distinct home dashboards with KPIs, urgent action alerts, and order workflows) |
| Quality grade declaration (Grade A/B/C) + grade filter | Built (with card badges and listings filter) |
| Harvest date + spoilage/staleness warnings for perishables | Built (`lib/spoilage.js` threshold check + badge) |
| Phone + OTP login for farmers, buyers, and processors | Built (OTP shown on-screen in dev — no SMS gateway) |
| Processor role + group pool offer flow | Built (`pool_offers`, bulk order distribution, `Processing` stage) |
| Order tracking with forward-only status (Pending → Confirmed → Processing → Delivered) | Built |
| Grievance / dispute tracking on orders | Built (`order_issues`, note raising and farmer resolution) |
| Buyer-rates-farmer score (1–5 stars) | Built (`farmer_ratings` on delivered orders, average star badges on listings & pools) |
| Group selling / pooling by crop + location | Built (exact string match, not geolocation) |
| Ownership checks (only your own listings/orders/grievances/ratings) | Built |
| USSD simulator + real gateway-shaped callback endpoint | Built — `/ussd` (browser simulator) and `POST /ussd/callback` (point a real aggregator here) |
| Marathi UI | Built for navigation and main page copy; farmer/buyer-entered data (names, locations) is never translated |
| Deduplicated price pipeline (upsert, pagination) | Built in `scripts/fetchPrices.js` |
| Basic rate limiting on OTP/login endpoints | Built (in-memory, single-process only) |
| CSRF protection on state-changing forms | Built (session-bound token) |
| Masked/gated contact info (login required to see a phone number) | Built |
| Real SMS delivery of OTPs | Roadmap — needs a paid SMS/USSD aggregator account |
| USSD on a real telecom network | Roadmap — needs a licensed aggregator subscription; the callback logic itself is ready |
| Net/farm-gate price (after commission, transport) | Roadmap — dashboard shows the mandi reference price only |
| Licensing review for direct online sale | Roadmap — verify with the PS owner / state marketing regime |
| Production-grade session store, load-balanced rate limiting | Roadmap — current versions are in-memory, single-process |
| Hosting / deployed URL | Roadmap — depends on where you deploy |

## Known limitations worth stating out loud in the pitch

- The fair-price comparison assumes listing prices are per kg; a farmer
  entering a per-quintal or per-bag price will get a wrong percentage.
  There's no enforced unit field yet.
- Crop-name matching (for both the fair-price check and the USSD price
  lookup) is a case-insensitive substring match, not a real crop taxonomy.
- The sell/wait rule is a simple, explainable 3% threshold — not a
  forecast. `scripts/backtest.js` is there specifically so you don't have
  to take that on faith; run it against real fetched history before
  citing any accuracy number to judges.
- Sessions and rate limits live in server memory and reset on restart —
  fine for a single-process demo, not for a real deployment.
