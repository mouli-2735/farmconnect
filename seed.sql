-- Sample data for demo purposes.
-- Run this AFTER schema.sql:
--   mysql -u root -p farmconnect < seed.sql

USE farmconnect;

-- Demo accounts. In real use these are created automatically on first
-- OTP login (see routes/auth.js) — these rows just let you skip that for
-- a quick demo of listings/orders/pool without logging in as each person.
INSERT INTO users (phone, role, name) VALUES
('9900011111', 'farmer', 'Anil Jadhav'),
('9900022222', 'farmer', 'Balaji More'),
('9900033333', 'farmer', 'Chandrakant Pawar'),
('9900044444', 'farmer', 'Dnyaneshwar Salunkhe'),
('9900099999', 'buyer', 'Suresh Traders'),
('9900088888', 'processor', 'Kisan Food Processors');

-- Tomato: price trending UP over the last week (tip should say "wait")
INSERT INTO market_prices (crop_name, variety, market, state, min_price, max_price, modal_price, price_date, source) VALUES
('Tomato', 'Local', 'Pune Mandi', 'Maharashtra', 1200, 1600, 1400, DATE_SUB(CURDATE(), INTERVAL 6 DAY), 'data.gov.in (Agmarknet)'),
('Tomato', 'Local', 'Pune Mandi', 'Maharashtra', 1250, 1650, 1450, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'data.gov.in (Agmarknet)'),
('Tomato', 'Local', 'Pune Mandi', 'Maharashtra', 1300, 1700, 1500, DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'data.gov.in (Agmarknet)'),
('Tomato', 'Local', 'Pune Mandi', 'Maharashtra', 1350, 1750, 1550, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'data.gov.in (Agmarknet)'),
('Tomato', 'Local', 'Pune Mandi', 'Maharashtra', 1400, 1800, 1600, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'data.gov.in (Agmarknet)'),
('Tomato', 'Local', 'Pune Mandi', 'Maharashtra', 1450, 1850, 1650, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'data.gov.in (Agmarknet)'),
('Tomato', 'Local', 'Pune Mandi', 'Maharashtra', 1500, 1900, 1700, CURDATE(), 'data.gov.in (Agmarknet)');

-- Onion: price trending DOWN over the last week (tip should say "sell now")
INSERT INTO market_prices (crop_name, variety, market, state, min_price, max_price, modal_price, price_date, source) VALUES
('Onion', 'Local', 'Nashik Mandi', 'Maharashtra', 2000, 2400, 2200, DATE_SUB(CURDATE(), INTERVAL 6 DAY), 'data.gov.in (Agmarknet)'),
('Onion', 'Local', 'Nashik Mandi', 'Maharashtra', 1950, 2350, 2150, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'data.gov.in (Agmarknet)'),
('Onion', 'Local', 'Nashik Mandi', 'Maharashtra', 1900, 2300, 2100, DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'data.gov.in (Agmarknet)'),
('Onion', 'Local', 'Nashik Mandi', 'Maharashtra', 1850, 2250, 2050, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'data.gov.in (Agmarknet)'),
('Onion', 'Local', 'Nashik Mandi', 'Maharashtra', 1800, 2200, 2000, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'data.gov.in (Agmarknet)'),
('Onion', 'Local', 'Nashik Mandi', 'Maharashtra', 1750, 2150, 1950, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'data.gov.in (Agmarknet)'),
('Onion', 'Local', 'Nashik Mandi', 'Maharashtra', 1700, 2100, 1900, CURDATE(), 'data.gov.in (Agmarknet)');

-- Wheat: price roughly stable (tip should say "sell now" — no strong reason to wait)
INSERT INTO market_prices (crop_name, variety, market, state, min_price, max_price, modal_price, price_date, source) VALUES
('Wheat', 'Local', 'Nagpur Mandi', 'Maharashtra', 2100, 2300, 2200, DATE_SUB(CURDATE(), INTERVAL 6 DAY), 'data.gov.in (Agmarknet)'),
('Wheat', 'Local', 'Nagpur Mandi', 'Maharashtra', 2110, 2310, 2210, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'data.gov.in (Agmarknet)'),
('Wheat', 'Local', 'Nagpur Mandi', 'Maharashtra', 2090, 2290, 2190, DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'data.gov.in (Agmarknet)'),
('Wheat', 'Local', 'Nagpur Mandi', 'Maharashtra', 2100, 2300, 2200, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'data.gov.in (Agmarknet)'),
('Wheat', 'Local', 'Nagpur Mandi', 'Maharashtra', 2105, 2305, 2205, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'data.gov.in (Agmarknet)'),
('Wheat', 'Local', 'Nagpur Mandi', 'Maharashtra', 2095, 2295, 2195, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'data.gov.in (Agmarknet)'),
('Wheat', 'Local', 'Nagpur Mandi', 'Maharashtra', 2100, 2300, 2200, CURDATE(), 'data.gov.in (Agmarknet)');

-- Sample farmers for the Group Selling / Crop Pooling demo.
-- 4 farmers, same crop (Tomato) and same location (Satara) -> pools into 500 kg combined.
-- contact matches the seeded user phone numbers above so /orders and USSD "My Orders" work for them.
-- harvest_date: Anil and Dnyaneshwar's produce is older than 3 days, demonstrating the spoilage/staleness badge.
INSERT INTO crops (id, farmer_name, crop_name, quantity, price, contact, location, status, harvest_date, grade) VALUES
(1, 'Anil Jadhav', 'Tomato', '100 kg', 18.00, '9900011111', 'Satara', 'active', DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'A'),
(2, 'Balaji More', 'Tomato', '150 kg', 17.50, '9900022222', 'Satara', 'active', DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'B'),
(3, 'Chandrakant Pawar', 'Tomato', '200 kg', 18.50, '9900033333', 'Satara', 'active', CURDATE(), 'A'),
(4, 'Dnyaneshwar Salunkhe', 'Tomato', '50 kg', 17.00, '9900044444', 'Satara', 'active', DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'C'),
(5, 'Anil Jadhav', 'Onion', '300 kg', 22.00, '9900011111', 'Nashik', 'active', DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'B'),
(6, 'Balaji More', 'Wheat', '500 kg', 23.50, '9900022222', 'Nagpur', 'active', DATE_SUB(CURDATE(), INTERVAL 8 DAY), 'A'),
(7, 'Anil Jadhav', 'Tomato', '80 kg', 18.00, '9900011111', 'Satara', 'sold', DATE_SUB(CURDATE(), INTERVAL 7 DAY), 'A');

-- Seed pool offer placed by processor Kisan Food Processors
INSERT INTO pool_offers (id, crop_name, location, processor_phone, processor_name, offer_price_per_kg, total_kg, status) VALUES
(1, 'Tomato', 'Satara', '9900088888', 'Kisan Food Processors', 18.00, 500.00, 'Accepted');

-- Seed orders:
-- Order 1: Delivered, linked to farmer Anil Jadhav, rated 5-stars by buyer Suresh Traders with resolved grievance
-- Order 2: Processing status, created via pool offer from Kisan Food Processors
-- Order 3: Confirmed status with an Open issue raised by buyer
INSERT INTO orders (id, crop_id, buyer_name, buyer_phone, quantity_kg, status, pool_offer_id) VALUES
(1, 7, 'Suresh Traders', '9900099999', 80.00, 'Delivered', NULL),
(2, 1, 'Kisan Food Processors', '9900088888', 100.00, 'Processing', 1),
(3, 2, 'Suresh Traders', '9900099999', 50.00, 'Confirmed', NULL);

-- Seed grievances / issues
INSERT INTO order_issues (order_id, raised_by_phone, note, status, resolved_at) VALUES
(1, '9900011111', 'Confirmed receipt and weighment verification on COD delivery.', 'Resolved', NOW()),
(3, '9900099999', 'Vehicle delayed due to highway checkpoint. Driver will arrive by 6 PM.', 'Open', NULL);

-- Seed buyer-to-farmer rating for delivered order #1
INSERT INTO farmer_ratings (farmer_phone, buyer_phone, order_id, stars, comment) VALUES
('9900011111', '9900099999', 1, 5, 'Excellent quality Grade A tomatoes, neatly crated and fresh!');
