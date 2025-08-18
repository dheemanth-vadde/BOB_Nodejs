const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");

const router = express.Router();

const {
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET,
} = process.env;

// Razorpay client
const rzp = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

// (Demo) in-memory store. In prod, use your DB.
const ordersStore = new Map();

/**
 * GET /api/payments/razorpay/config
 * Returns keyId so frontend can init checkout
 */
router.get("/config", (_req, res) => {
  res.json({ keyId: RAZORPAY_KEY_ID });
});

/**
 * POST /api/payments/razorpay/orders
 * Body: { amount, currency?, receipt?, notes? }
 * amount is in smallest unit (paise). e.g., ₹499 => 49900
 */
router.post("/orders", async (req, res) => {
  try {
    const { amount, currency = "INR", receipt, notes = {} } = req.body;

    if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: "Valid 'amount' (in smallest unit) is required" });
    }

    const order = await rzp.orders.create({
      amount: Number(amount),
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
      notes,
    });

    ordersStore.set(order.id, {
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      status: order.status, // created
      receipt: order.receipt,
      notes: order.notes || {},
      created_at: order.created_at,  
    });

    res.json({ order });
  } catch (err) {
    console.error("Create order error:", err.error || err.message);
    res.status(500).json({ error: "Failed to create order" });
  }
});

/**
 * POST /api/payments/razorpay/verify
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Verifies checkout success on server using key secret
 */
router.post("/verify", (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

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

    // mark paid (demo)
    const existing = ordersStore.get(razorpay_order_id);
    if (existing) {
      existing.status = "paid";
      existing.payment_id = razorpay_payment_id;
      existing.verified_at = Date.now();
      ordersStore.set(razorpay_order_id, existing);
    }

    res.json({ success: true, message: "Payment verified" });
  } catch (err) {
    console.error("Verify error:", err.message);
    res.status(500).json({ success: false, error: "Verification failed" });
  }
});

/**
 * POST /api/payments/razorpay/webhook
 * This route must receive RAW body for signature verification.
 * Configure this URL in Razorpay Dashboard → Webhooks.
 */
router.post("/webhook", (req, res) => {
  try {
    const signature = req.header("x-razorpay-signature");
    if (!signature) return res.status(400).send("Missing signature");

    const expected = crypto
      .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
      .update(req.body) // raw Buffer
      .digest("hex");

    if (signature !== expected) {
      console.warn("❌ Invalid Razorpay webhook signature");
      return res.status(400).send("Invalid signature");
    }

    const event = JSON.parse(req.body.toString("utf8"));
    const type = event?.event;

    // Example: on payment.captured, mark order captured
    if (type === "payment.captured") {
      const orderId = event?.payload?.payment?.entity?.order_id;
      const paymentId = event?.payload?.payment?.entity?.id;
      const amount = event?.payload?.payment?.entity?.amount;

      const rec = ordersStore.get(orderId);
      if (rec) {
        rec.status = "captured";
        rec.payment_id = paymentId;
        rec.captured_amount = amount;
        rec.webhook_updated_at = Date.now();
        ordersStore.set(orderId, rec);
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.sendStatus(500);
  }
});

/**
 * GET /api/payments/razorpay/orders/:orderId  (dev helper)
 */
router.get("/orders/:orderId", (req, res) => {
  const rec = ordersStore.get(req.params.orderId);
  if (!rec) return res.status(404).json({ error: "Not found" });
  res.json(rec);
});

module.exports = router;
