const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "192.168.20.111",          
  database: "SILBOB",
  password: "Postgres",
  port: 5432,                  
});

pool.connect()
  .then(() => console.log("✅ Connected to PostgreSQL"))
  .catch(err => console.error("❌ Connection error", err.stack));

module.exports = pool;
