const mysql = require("mysql2/promise");
require("dotenv").config();

// Determine configuration: supports cloud connection strings (DATABASE_URL / MYSQL_URL)
// or individual environment variables (DB_HOST, DB_USER, etc.).
let poolConfig = {};

const cloudUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;

if (cloudUrl) {
  // Cloud providers like Railway / Aiven supply a full URI
  poolConfig = {
    uri: cloudUrl,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: process.env.DB_SSL === "false" ? undefined : { rejectUnauthorized: false },
  };
} else {
  // Local environment or individual env vars
  const isCloudHost = process.env.DB_HOST && !["localhost", "127.0.0.1"].includes(process.env.DB_HOST);
  poolConfig = {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "farmconnect",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: (process.env.DB_SSL === "true" || isCloudHost) ? { rejectUnauthorized: false } : undefined,
  };
}

const pool = mysql.createPool(poolConfig);

module.exports = pool;

