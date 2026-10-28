const crypto = require('crypto');
const Razorpay = require('razorpay');

const rzp = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Signature the browser sends after a successful checkout:
// HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, KEY_SECRET)
function verifyCheckoutSignature(orderId, paymentId, signature) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqualHex(expected, signature);
}

// Webhook signature: HMAC_SHA256(raw request body, WEBHOOK_SECRET)
function verifyWebhookSignature(rawBody, signature) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return safeEqualHex(expected, signature);
}

module.exports = { rzp, verifyCheckoutSignature, verifyWebhookSignature };
