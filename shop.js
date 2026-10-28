const crypto = require('crypto');
const express = require('express');
const pool = require('../lib/db');
const { HttpError, asyncHandler } = require('../lib/errors');
const { rzp, verifyCheckoutSignature } = require('../lib/razorpay');
const { restock, markOrderPaid } = require('../lib/orders');

const router = express.Router();

const SHIPPING_PAISE = Math.round(Number(process.env.SHIPPING_FEE ?? 60) * 100);
const FREE_ABOVE_PAISE = Math.round(Number(process.env.FREE_SHIPPING_ABOVE ?? 999) * 100);

router.get('/config', (req, res) => {
  res.json({
    shopName: process.env.SHOP_NAME || 'Oil Shop',
    shippingPaise: SHIPPING_PAISE,
    freeShippingAbovePaise: FREE_ABOVE_PAISE,
  });
});

router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, name, description, size_label AS size, price_paise AS pricePaise, stock, image_url AS imageUrl
         FROM products WHERE is_active = 1 ORDER BY name, price_paise`
    );
    res.json(rows);
  })
);

function validateOrder(body) {
  const c = (body && body.customer) || {};
  const clean = (v, max) => String(v ?? '').trim().slice(0, max);
  const customer = {
    name: clean(c.name, 100),
    phone: clean(c.phone, 10),
    email: clean(c.email, 150),
    address: clean(c.address, 300),
    city: clean(c.city, 80),
    state: clean(c.state, 80),
    pincode: clean(c.pincode, 6),
  };
  if (customer.name.length < 2) return { error: 'Enter your full name' };
  if (!/^[6-9]\d{9}$/.test(customer.phone)) return { error: 'Enter a valid 10-digit mobile number' };
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) return { error: 'Enter a valid email address' };
  if (customer.address.length < 8) return { error: 'Enter your full delivery address' };
  if (!customer.city || !customer.state) return { error: 'Enter city and state' };
  if (!/^\d{6}$/.test(customer.pincode)) return { error: 'Enter a valid 6-digit pincode' };

  const merged = new Map();
  for (const it of Array.isArray(body.items) ? body.items : []) {
    const productId = Number(it.productId);
    const quantity = Number(it.quantity);
    if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return { error: 'Invalid cart item' };
    }
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }
  if (!merged.size) return { error: 'Your cart is empty' };
  if (merged.size > 30) return { error: 'Too many different items in one order' };
  const items = [...merged].map(([productId, quantity]) => ({ productId, quantity: Math.min(quantity, 20) }));
  return { customer, items };
}

const newOrderNo = () =>
  'LM' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();

// Create order: the server re-prices everything from the database. Prices sent by the browser are ignored.
router.post(
  '/orders',
  asyncHandler(async (req, res) => {
    const v = validateOrder(req.body);
    if (v.error) throw new HttpError(400, v.error);
    const { customer, items } = v;

    const conn = await pool.getConnection();
    let orderId, orderNo, totalPaise;
    try {
      await conn.beginTransaction();

      const [prods] = await conn.query(
        'SELECT id, name, size_label, price_paise, stock FROM products WHERE id IN (?) AND is_active = 1 FOR UPDATE',
        [items.map((i) => i.productId)]
      );
      const byId = new Map(prods.map((p) => [p.id, p]));

      let subtotal = 0;
      const lines = items.map((it) => {
        const p = byId.get(it.productId);
        if (!p) throw new HttpError(400, 'A product in your cart is no longer available');
        if (p.stock < it.quantity) {
          throw new HttpError(409, p.stock > 0 ? `Only ${p.stock} left of ${p.name} (${p.size_label})` : `${p.name} (${p.size_label}) is out of stock`);
        }
        const lineTotal = p.price_paise * it.quantity;
        subtotal += lineTotal;
        return { p, quantity: it.quantity, lineTotal };
      });

      const shipping = subtotal >= FREE_ABOVE_PAISE ? 0 : SHIPPING_PAISE;
      totalPaise = subtotal + shipping;
      orderNo = newOrderNo();

      const [ins] = await conn.query(
        `INSERT INTO orders (order_no, customer_name, phone, email, address_line, city, state, pincode,
                             subtotal_paise, shipping_paise, total_paise)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [orderNo, customer.name, customer.phone, customer.email || null, customer.address, customer.city,
         customer.state, customer.pincode, subtotal, shipping, totalPaise]
      );
      orderId = ins.insertId;

      for (const l of lines) {
        await conn.query(
          `INSERT INTO order_items (order_id, product_id, product_name, size_label, unit_price_paise, quantity, line_total_paise)
           VALUES (?,?,?,?,?,?,?)`,
          [orderId, l.p.id, l.p.name, l.p.size_label, l.p.price_paise, l.quantity, l.lineTotal]
        );
        // Reserve stock now so two customers cannot buy the last bottle.
        await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [l.quantity, l.p.id]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    // Create the Razorpay order after the DB commit; if it fails, give the stock back.
    try {
      const rzpOrder = await rzp.orders.create({
        amount: totalPaise,
        currency: 'INR',
        receipt: orderNo,
        notes: { order_no: orderNo },
      });
      await pool.query('UPDATE orders SET razorpay_order_id = ? WHERE id = ?', [rzpOrder.id, orderId]);

      res.status(201).json({
        orderNo,
        razorpayOrderId: rzpOrder.id,
        amountPaise: totalPaise,
        keyId: process.env.RAZORPAY_KEY_ID,
        onlyMethod: process.env.ONLY_METHOD || '',
        customer: { name: customer.name, email: customer.email, phone: customer.phone },
      });
    } catch (e) {
      const conn2 = await pool.getConnection();
      try {
        await conn2.beginTransaction();
        await restock(conn2, orderId);
        await conn2.query("UPDATE orders SET status='CANCELLED', admin_note='Razorpay order creation failed' WHERE id=?", [orderId]);
        await conn2.commit();
      } finally {
        conn2.release();
      }
      console.error('Razorpay order creation failed:', e);
      throw new HttpError(502, 'Payment service is unavailable. Please try again in a minute.');
    }
  })
);

// Browser calls this after Razorpay checkout succeeds. We verify the HMAC signature before trusting anything.
router.post(
  '/payments/verify',
  asyncHandler(async (req, res) => {
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body || {};
    if (![oid, pid, sig].every((v) => typeof v === 'string' && v.length > 5 && v.length < 200)) {
      throw new HttpError(400, 'Invalid payment data');
    }
    if (!verifyCheckoutSignature(oid, pid, sig)) {
      throw new HttpError(400, 'Payment signature verification failed');
    }
    const result = await markOrderPaid(oid, pid, 'checkout.verified', null, null);
    if (!result) throw new HttpError(404, 'Order not found');
    res.json({ ok: true, orderNo: result.orderNo });
  })
);

// Customer order tracking: order number + the phone number used while ordering.
router.get(
  '/orders/track',
  asyncHandler(async (req, res) => {
    const orderNo = String(req.query.orderNo || '').trim().toUpperCase();
    const phone = String(req.query.phone || '').trim();
    if (!orderNo || !/^\d{10}$/.test(phone)) throw new HttpError(400, 'Enter your order number and 10-digit phone');

    const [rows] = await pool.query(
      `SELECT id, order_no AS orderNo, status, customer_name AS name, address_line AS address, city, state, pincode,
              subtotal_paise AS subtotalPaise, shipping_paise AS shippingPaise, total_paise AS totalPaise,
              tracking_info AS trackingInfo, created_at AS createdAt, paid_at AS paidAt
         FROM orders WHERE order_no = ? AND phone = ?`,
      [orderNo, phone]
    );
    if (!rows.length) throw new HttpError(404, 'No order found. Check the order number and phone number.');
    const order = rows[0];
    const [items] = await pool.query(
      `SELECT product_name AS name, size_label AS size, unit_price_paise AS unitPaise, quantity, line_total_paise AS linePaise
         FROM order_items WHERE order_id = ?`,
      [order.id]
    );
    delete order.id;
    res.json({ ...order, items });
  })
);

module.exports = router;
