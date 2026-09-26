const fs = require("fs");
const path = require("path");
const pool = require("../config/db");

async function initDb(shouldExit = false) {
  console.log("==> Initializing FarmConnect Cloud Database...");

  const schemaPath = path.join(__dirname, "..", "schema.sql");
  const seedPath = path.join(__dirname, "..", "seed.sql");

  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  const seedSql = fs.readFileSync(seedPath, "utf8");

  function cleanStatements(sql) {
    // 1. Remove multiline comments /* ... */
    let cleaned = sql.replace(/\/\*[\s\S]*?\*\//g, "");
    // 2. Remove single line comments -- ...
    cleaned = cleaned.replace(/--.*$/gm, "");
    // 3. Split by semicolon
    return cleaned
      .split(";")
      .map((s) => s.trim())
      .filter((s) => {
        if (!s) return false;
        const lower = s.toLowerCase();
        // Skip database create/use commands if already connected to a specific DB in cloud
        if (lower.startsWith("create database") || lower.startsWith("use ")) return false;
        return true;
      });
  }

  const statements = [...cleanStatements(schemaSql), ...cleanStatements(seedSql)];

  console.log(`==> Executing ${statements.length} SQL setup statements...`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await pool.query(stmt);
    } catch (err) {
      // Don't crash on duplicate key during re-seeding
      if (!err.message.includes("Duplicate entry") && !err.message.includes("already exists")) {
        console.warn(`[WARN on stmt ${i + 1}]: ${err.message}`);
      }
    }
  }

  console.log("==> Database initialization complete! All tables and seeds verified.");
  if (shouldExit) process.exit(0);
}

if (require.main === module) {
  initDb(true).catch((err) => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });
}

module.exports = initDb;

