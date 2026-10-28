const { verifyWebhookSignature } = require('../lib/razorpay');
const { markOrderPaid } = require('../lib/orders');
const pool = require('../lib/db');

// Razorpay -> our server. Safety net for customers who pay but close the tab before /payments/verify runs.
// Mounted with express.raw() because the signature is computed over the exact raw bytes.
module.exports = async function webhook(req, res) {
  try {
    const signature = req.get('X-Razorpay-Signature');
    if (!verifyWebhookSignature(req.body, signature)) return res.status(400).send('Invalid signature');

    const body = JSON.parse(req.body.toString('utf8'));
    const payment = body.payload?.payment?.entity;
    const orderEntity = body.payload?.order?.entity;

    if (body.event === 'payment.captured' || body.event === 'order.paid') {
      const rzpOrderId = payment?.order_id || orderEntity?.id;
      const amount = payment?.amount ?? orderEntity?.amount_paid;
      if (rzpOrderId && payment?.id) {
        await markOrderPaid(rzpOrderId, payment.id, `webhook:${body.event}`, amount, { id: payment.id, method: payment.method });
      }
    } else if (body.event === 'payment.failed' && payment?.order_id) {
      // Do not cancel: the customer can retry on the same Razorpay order. Just keep an audit record.
      await pool.query(
        `INSERT INTO payment_events (razorpay_order_id, razorpay_payment_id, event, amount_paise, payload)
         VALUES (?,?,?,?,?)`,
        [payment.order_id, payment.id, 'webhook:payment.failed', payment.amount, JSON.stringify({ reason: payment.error_description || null })]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).send('error'); // Razorpay will retry
  }
};
