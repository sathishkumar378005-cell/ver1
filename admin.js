const crypto = require('crypto');
const express = require('express');
const pool = require('../lib/db');
const { HttpError, asyncHandler } = require('../lib/errors');
const { restock } = require('../lib/orders');

const router = express.Router();

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN || '';
  const given = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (expected.length < 16 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
router.use(requireAdmin);

const STATUSES = ['PENDING_PAYMENT', 'PAID', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

router.get('/ping', (req, res) => res.json({ ok: true }));

router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || '');
    const where = STATUSES.includes(status) ? 'WHERE o.status = ?' : '';
    const [orders] = await pool.query(
      `SELECT o.id, o.order_no AS orderNo, o.status, o.customer_name AS name, o.phone, o.email,
              o.address_line AS address, o.city, o.state, o.pincode, o.total_paise AS totalPaise,
              o.razorpay_payment_id AS paymentId, o.tracking_info AS trackingInfo, o.admin_note AS note,
              o.created_at AS createdAt
         FROM orders o ${where} ORDER BY o.created_at DESC LIMIT 200`,
      where ? [status] : []
    );
    if (orders.length) {
      const [items] = await pool.query(
        `SELECT order_id AS orderId, product_name AS name, size_label AS size, quantity
           FROM order_items WHERE order_id IN (?)`,
        [orders.map((o) => o.id)]
      );
      for (const o of orders) o.items = items.filter((i) => i.orderId === o.id);
    }
    res.json(orders);
  })
);

router.patch(
  '/orders/:orderNo',
  asyncHandler(async (req, res) => {
    const { status, trackingInfo } = req.body || {};
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
    const tracking = trackingInfo ? String(trackingInfo).slice(0, 255) : null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query('SELECT id, status FROM orders WHERE order_no = ? FOR UPDATE', [req.params.orderNo]);
      if (!rows.length) throw new HttpError(404, 'Order not found');
      const o = rows[0];

      if (status === 'CANCELLED' && o.status !== 'CANCELLED') await restock(conn, o.id);
      if (o.status === 'CANCELLED' && status !== 'CANCELLED') {
        throw new HttpError(409, 'Cancelled orders cannot be reopened');
      }
      await conn.query(
        'UPDATE orders SET status = ?, tracking_info = COALESCE(?, tracking_info) WHERE id = ?',
        [status, tracking, o.id]
      );
      await conn.commit();
      res.json({ ok: true });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  })
);

router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, name, description, size_label AS size, price_paise AS pricePaise, stock, is_active AS active
         FROM products ORDER BY name, price_paise`
    );
    res.json(rows);
  })
);

function productFields(b) {
  const name = String(b.name || '').trim().slice(0, 120);
  const size = String(b.size || '').trim().slice(0, 30);
  const description = String(b.description || '').trim().slice(0, 500);
  const pricePaise = Math.round(Number(b.priceRupees) * 100);
  const stock = Number(b.stock);
  if (!name || !size) throw new HttpError(400, 'Name and size are required');
  if (!Number.isFinite(pricePaise) || pricePaise <= 0) throw new HttpError(400, 'Enter a valid price');
  if (!Number.isInteger(stock) || stock < 0) throw new HttpError(400, 'Stock must be 0 or more');
  return { name, size, description, pricePaise, stock, active: b.active === false ? 0 : 1 };
}

router.post(
  '/products',
  asyncHandler(async (req, res) => {
    const f = productFields(req.body || {});
    const [r] = await pool.query(
      'INSERT INTO products (name, description, size_label, price_paise, stock, is_active) VALUES (?,?,?,?,?,?)',
      [f.name, f.description, f.size, f.pricePaise, f.stock, f.active]
    );
    res.status(201).json({ id: r.insertId });
  })
);

router.put(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const f = productFields(req.body || {});
    const [r] = await pool.query(
      'UPDATE products SET name=?, description=?, size_label=?, price_paise=?, stock=?, is_active=? WHERE id=?',
      [f.name, f.description, f.size, f.pricePaise, f.stock, f.active, Number(req.params.id)]
    );
    if (!r.affectedRows) throw new HttpError(404, 'Product not found');
    res.json({ ok: true });
  })
);

module.exports = router;
