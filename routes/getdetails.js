// routes/getdetails.js
const express = require("express");
const router = express.Router();
const pool = require("../config/db");
 
// normalize email for case-insensitive match
const normEmail = (e) => (e || "").trim().toLowerCase();
 
 
async function getManagerDepth(client, userid) {
  let depth = 0;
  let currentId = userid;
  while (currentId) {
    const result = await client.query(
      `SELECT manager_id FROM public.users WHERE userid = $1 LIMIT 1`,
      [currentId]
    );
 
    if (result.rows.length === 0 || !result.rows[0].manager_id) break;
 
    currentId = result.rows[0].manager_id;
    depth++;
  }
 
  return depth;
}
 
// Get user details by email
router.post("/users", async (req, res) => {
  const client = await pool.connect();
  try {
    const email = normEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }
 
    const sql = `
      SELECT userid, name, email, role, manager_id
      FROM public.users
      WHERE LOWER(email) = $1
      LIMIT 1
    `;
    const { rows } = await client.query(sql, [email]);
 
    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
 
    const user = rows[0];
    console.log("User depth:", user);
    const depth = await getManagerDepth(client, user.userid);
    res.json({ ...user, manager_depth: depth });
  } catch (err) {
    console.error("getdetails/users error:", err.message);
    res.status(500).json({ error: "Failed to fetch user", details: err.message });
  } finally {
    client.release();
  }
});
 
// Get candidate details by email
router.post("/candidates", async (req, res) => {
  const client = await pool.connect();
  try {
    const email = normEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }
 
    const sql = `
      SELECT candidate_id, full_name, email, username, created_date
      FROM public.candidates
      WHERE LOWER(email) = $1
      LIMIT 1
    `;
    const { rows } = await client.query(sql, [email]);
 
    if (rows.length === 0) {
      return res.status(404).json({ error: "Candidate not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("getdetails/candidates error:", err.message);
    res.status(500).json({ error: "Failed to fetch candidate", details: err.message });
  } finally {
    client.release();
  }
});
 
// Get all users (only name, role, email)
router.get("/users/all", async (req, res) => {
  const client = await pool.connect();
  // const token = req.cookies.access_token;
  // console.log("Token in getdetails/users/all:", token); // Debug log
  try {
    const sql = `
      SELECT userid,name, role, email
      FROM public.users
      ORDER BY name ASC
    `;
    const { rows } = await client.query(sql);
 
    if (rows.length === 0) {
      return res.status(404).json({ error: "No users found" });
    }
 
    res.json(rows); // returns an array of users
  } catch (err) {
    console.error("getdetails/users/all error:", err.message);
    res.status(500).json({ error: "Failed to fetch users", details: err.message });
  } finally {
    client.release();
  }
});
 
 
module.exports = router;