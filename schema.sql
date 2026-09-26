-- FarmConnect database schema (MySQL)
-- Run this once against your MySQL server to set up the database:
--   mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS farmconnect;
USE farmconnect;

DROP TABLE IF EXISTS farmer_ratings;
DROP TABLE IF EXISTS order_issues;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS pool_offers;
DROP TABLE IF EXISTS crops;
DROP TABLE IF EXISTS market_prices;
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS users;

-- Farmers, buyers, and bulk processors authenticate here (phone + OTP, no password).
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(20) NOT NULL UNIQUE,
    role ENUM('farmer', 'buyer', 'processor') NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- One-time login codes. consumed=1 once used; expires_at enforced in lib/otp.js.
CREATE TABLE otp_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(20) NOT NULL,
    code VARCHAR(6) NOT NULL,
    purpose VARCHAR(30) NOT NULL DEFAULT 'login',
    consumed TINYINT(1) NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_otp_phone (phone, purpose)
);

CREATE TABLE crops (
    id INT AUTO_INCREMENT PRIMARY KEY,
    farmer_name VARCHAR(100) NOT NULL,
    crop_name VARCHAR(100) NOT NULL,
    quantity VARCHAR(50) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    contact VARCHAR(20) NOT NULL,          -- farmer's phone; ties listing to their account
    location VARCHAR(100) NOT NULL,
    status ENUM('active', 'sold') NOT NULL DEFAULT 'active',
    harvest_date DATE NULL,
    grade ENUM('A', 'B', 'C') NOT NULL DEFAULT 'B',
    image_url TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_crops_crop_name (crop_name),
    INDEX idx_crops_contact (contact),
    INDEX idx_crops_status (status),
    INDEX idx_crops_grade (grade)
);

-- Pool offers placed by bulk food processors against pooled listings.
CREATE TABLE pool_offers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    crop_name VARCHAR(100) NOT NULL,
    location VARCHAR(100) NOT NULL,
    processor_phone VARCHAR(20) NOT NULL,
    processor_name VARCHAR(100) NOT NULL,
    offer_price_per_kg DECIMAL(10, 2) NOT NULL,
    total_kg DECIMAL(10, 2) NOT NULL,
    status ENUM('Open', 'Accepted', 'Rejected') NOT NULL DEFAULT 'Open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pool_offers_crop_loc (crop_name, location),
    INDEX idx_pool_offers_processor (processor_phone)
);

CREATE TABLE orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    crop_id INT NOT NULL,
    buyer_name VARCHAR(100) NOT NULL,
    buyer_phone VARCHAR(20) NOT NULL,
    quantity_kg DECIMAL(10, 2) NOT NULL,
    status ENUM('Pending', 'Confirmed', 'Processing', 'Delivered') NOT NULL DEFAULT 'Pending',
    pool_offer_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE CASCADE,
    FOREIGN KEY (pool_offer_id) REFERENCES pool_offers(id) ON DELETE SET NULL,
    INDEX idx_orders_crop_id (crop_id),
    INDEX idx_orders_buyer_phone (buyer_phone),
    INDEX idx_orders_pool_offer (pool_offer_id)
);

-- Grievances / dispute notes on orders raised by either farmer or buyer.
CREATE TABLE order_issues (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    raised_by_phone VARCHAR(20) NOT NULL,
    note TEXT NOT NULL,
    status ENUM('Open', 'Resolved') NOT NULL DEFAULT 'Open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    INDEX idx_order_issues_order (order_id),
    INDEX idx_order_issues_raised_by (raised_by_phone)
);

-- Star ratings and comments submitted by buyers upon order delivery.
CREATE TABLE farmer_ratings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    farmer_phone VARCHAR(20) NOT NULL,
    buyer_phone VARCHAR(20) NOT NULL,
    order_id INT NOT NULL UNIQUE,
    stars TINYINT NOT NULL,
    comment TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    INDEX idx_farmer_ratings_farmer (farmer_phone)
);

-- variety + source + a unique key so the daily fetch can upsert instead of
-- inserting duplicate rows on every run (see scripts/fetchPrices.js).
CREATE TABLE market_prices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    crop_name VARCHAR(100) NOT NULL,
    variety VARCHAR(100) NOT NULL DEFAULT '',
    market VARCHAR(100) NOT NULL,
    state VARCHAR(100),
    min_price DECIMAL(10, 2),
    max_price DECIMAL(10, 2),
    modal_price DECIMAL(10, 2),
    price_date DATE NOT NULL,
    source VARCHAR(150) NOT NULL DEFAULT 'data.gov.in (Agmarknet)',
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_price_row (crop_name, variety, market, price_date),
    INDEX idx_prices_crop_market_date (crop_name, market, price_date)
);
