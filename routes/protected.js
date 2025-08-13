const express = require("express");
const { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require("jwks-rsa");

const router = express.Router();

// 🔐 Middleware to validate JWT
const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksUri: `${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
  }),
  audience: `${process.env.AUTH0_DOMAIN}/api/v2/`, 
  issuer: `${process.env.AUTH0_DOMAIN}/`,
  algorithms: ["RS256"],
});

router.get("/protected", checkJwt, (req, res) => {
  res.json({
    message: "This is a protected route",
    user: req.auth,
  });
});

module.exports = router;
