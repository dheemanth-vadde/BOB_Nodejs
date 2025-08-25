const { Pool } = require("pg");

const globalForPg = global;

let pool = globalForPg.pgPool;
if (!pool) {
  const pool = new Pool({
    user: "sentrifugo",
    host: "101.53.133.152",
    database: "silbob",
    password: "pI01zRjCzyaxGqt",
    port: 5432,
    // important: cap connections from this app
    max: 10, // adjust to your DB capacity
    idleTimeoutMillis: 30000, // free idle clients after 30s
    connectionTimeoutMillis: 5000,
  });

  pool
    .query("SELECT 1")
    .then(() => {
      console.log("✅ PostgreSQL reachable");
    })
    .catch((err) => {
      console.error("❌ PostgreSQL health check failed:", err.message);
    });

  pool.on("error", (err) => {
    console.error("Unexpected PG pool error:", err);
  });
  if (process.env.NODE_ENV !== "production") {
    globalForPg.pgPool = pool;
  }
}

module.exports = pool;
