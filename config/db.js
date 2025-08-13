const { Pool } = require("pg");

const pool = new Pool({
  user: "sentrifugo",
  host: "101.53.133.152",          
  database: "silbob",
  password: "pI01zRjCzyaxGqt",
  port: 5432,                  
});

pool.connect()
  .then(() => console.log("✅ Connected to PostgreSQL"))
  .catch(err => console.error("❌ Connection error", err.stack));

module.exports = pool;
