const express = require("express");

// Use RAW body ONLY for webhook route (required to verify signature)
const rawBody = express.raw({ type: "*/*" });

// Use JSON for normal routes
const jsonBody = express.json();

module.exports = { rawBody, jsonBody };
