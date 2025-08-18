// routes/gcal.js  (NO DB — in-memory tokens)
const express = require("express");
const { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require("jwks-rsa");
const { getAuthUrl, getOAuth2Client, saveTokens, getBusy, computeEmptySlots } = require("../utils/gcal");

const router = express.Router();
const { AUTH0_DOMAIN } = process.env;

const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksUri: `${AUTH0_DOMAIN}/.well-known/jwks.json`,
  }),
  audience: `${AUTH0_DOMAIN}/api/v2/`,
  issuer: `${AUTH0_DOMAIN}/`,
  algorithms: ["RS256"],
});

// 1) Return Google consent URL (link once per user)
router.get("/auth/url", checkJwt, (req, res) => {
  const url = getAuthUrl(req.auth.sub); // pass Auth0 sub in state
  res.json({ url });
});

// 2) OAuth callback: exchange code, save tokens in memory
router.get("/oauth2/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!state) throw new Error("Missing state (Auth0 sub)");
    const oauth2 = getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    await saveTokens(state, tokens);
    res.send("Google linked. You can close this tab.");
  } catch (e) {
    console.error("gcal callback:", e.message);
    res.status(400).send("Failed to link Google");
  }
});

// 3) Empty slots (read-only)
// GET /api/gcal/empty-slots?email=&start=ISO&end=ISO&interval=30&tz=Asia/Kolkata
router.get("/empty-slots", checkJwt, async (req, res) => {
  try {
    const { email, start, end, interval = "30", tz = "Asia/Kolkata" } = req.query;
    if (!email || !start || !end) {
      return res.status(400).json({ error: "email, start, end are required" });
    }

    const busy = await getBusy(req.auth.sub, email, start, end, tz);
    const emptySlots = computeEmptySlots(start, end, interval, busy, tz);

    res.json({
      interviewer: { email },
      range: { start, end, timeZone: tz, intervalMinutes: parseInt(interval, 10) || 30 },
      busy,
      emptySlots
    });
  } catch (err) {
    console.error("gcal empty-slots error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch empty slots", details: err.response?.data || err.message });
  }
});

module.exports = router;
