require("dotenv").config();
const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const pool = require("../config/db");


const router = express.Router();

const {
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET,
  NODE_ENV
} = process.env;

const rzp = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

// ---------- CONFIG ----------
router.get("/config", (_req, res) => {
  res.json({ keyId: RAZORPAY_KEY_ID, mode: NODE_ENV === "production" ? "live" : "test" });
});

// ---------- CREATE ORDER: saves to DB ----------
router.post("/orders", async (req, res) => {
  try {
    const { amount, currency = "INR", receipt, notes = {}, candidate_id, position_id } = req.body || {};
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: "Valid 'amount' (in paise) is required" });
    }

    console.log("Create order body:", req.body);

    const order = await rzp.orders.create({
      amount: Number(amount), // in paise
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
      notes,
    });

    console.log("Razorpay order:", order);

    await pool.query(
      `INSERT INTO razorpay_orders
         (order_id, amount, currency, status, receipt, notes, candidate_id, position_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7, $8)
       ON CONFLICT (order_id) DO NOTHING`,
      [
        order.id,
        order.amount,
        order.currency,
        order.status,
        order.receipt,
        JSON.stringify(order.notes || {}),
        candidate_id,
        position_id
      ]
    );

    res.json({ order });
  } catch (err) {
    console.error("Create order error:", {
      message: err?.message,
      error: err?.error,
      statusCode: err?.statusCode,
      stack: err?.stack
    });
    const reason = err?.error?.description || err?.message || "Failed to create order";
    res.status(500).json({ error: reason });
  }
});


// ---------- VERIFY: marks as 'paid' in DB ----------
router.post("/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing verification fields" });
    }

    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto
      .createHmac("sha256", RAZORPAY_KEY_SECRET)
      .update(payload)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Invalid signature" });
    }

    // (Optional but recommended) confirm with Razorpay
    // const payment = await rzp.payments.fetch(razorpay_payment_id);
    // if (payment.order_id !== razorpay_order_id) return res.status(400).json({ success:false, error:"Payment mismatch" });

    await pool.query(
      `UPDATE razorpay_orders
         SET status=$1, payment_id=$2, signature=$3, updated_at=NOW()
       WHERE order_id=$4`,
      ["paid", razorpay_payment_id, razorpay_signature, razorpay_order_id]
    ); // :contentReference[oaicite:4]{index=4}

    res.json({ success: true, message: "Payment verified" });
  } catch (err) {
    console.error("Verify error:", err.message);
    res.status(500).json({ success: false, error: "Verification failed" });
  }
});

// ---------- DEV: read one ----------
router.get("/orders/:orderId", async (req, res) => {
  const { orderId } = req.params;
  const { rows } = await pool.query(
    "SELECT * FROM razorpay_orders WHERE order_id=$1",
    [orderId]
  ); // :contentReference[oaicite:5]{index=5}

  if (rows.length === 0) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

// ---------- WEBHOOK (RAW BODY) ----------
async function webhookHandler(req, res) {
  try {
    const signature = req.get("x-razorpay-signature");
    if (!signature) return res.status(400).send("Missing signature");

    const expected = crypto
      .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
      .update(req.body) // Buffer (raw)
      .digest("hex");

    if (signature !== expected) return res.status(400).send("Invalid signature");

    const event = JSON.parse(req.body.toString("utf8"));
    const type = event?.event;

    // On payment.captured → update DB
    if (type === "payment.captured") {
      const orderId   = event?.payload?.payment?.entity?.order_id;
      const paymentId = event?.payload?.payment?.entity?.id;
      const amount    = event?.payload?.payment?.entity?.amount;

      if (orderId && paymentId) {
        await pool.query(
          `UPDATE razorpay_orders
             SET status=$1, payment_id=$2, captured_amount=$3, updated_at=NOW()
           WHERE order_id=$4`,
          ["captured", paymentId, amount, orderId]
        ); // :contentReference[oaicite:6]{index=6}
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(500);
  }
}

module.exports = { router, webhookHandler };
