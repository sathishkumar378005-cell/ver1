const pool = require('./db');

// Put stock back for every line of an order (used on cancel / expiry).
async function restock(conn, orderId) {
  await conn.query(
    `UPDATE products p JOIN order_items i ON i.product_id = p.id
        SET p.stock = p.stock + i.quantity
      WHERE i.order_id = ?`,
    [orderId]
  );
}

async function logEvent(conn, rzpOrderId, rzpPaymentId, event, amountPaise, payload) {
  await conn.query(
    `INSERT INTO payment_events (razorpay_order_id, razorpay_payment_id, event, amount_paise, payload)
     VALUES (?, ?, ?, ?, ?)`,
    [rzpOrderId, rzpPaymentId || null, event, amountPaise ?? null, payload ? JSON.stringify(payload) : null]
  );
}

/**
 * Mark an order PAID. Safe to call many times (verify call + webhook both land here).
 * Returns { orderNo, alreadyPaid } or null if the order is unknown.
 */
async function markOrderPaid(rzpOrderId, rzpPaymentId, event, amountPaise, payload) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT id, order_no, status, total_paise, razorpay_payment_id FROM orders WHERE razorpay_order_id = ? FOR UPDATE',
      [rzpOrderId]
    );
    if (!rows.length) {
      await conn.rollback();
      return null;
    }
    const order = rows[0];

    // Never trust an amount that does not match what we charged.
    if (amountPaise != null && Number(amountPaise) !== order.total_paise) {
      await logEvent(conn, rzpOrderId, rzpPaymentId, `${event}:AMOUNT_MISMATCH`, amountPaise, payload);
      await conn.commit();
      return null;
    }

    await logEvent(conn, rzpOrderId, rzpPaymentId, event, amountPaise, payload);

    let alreadyPaid = true;
    if (order.status === 'PENDING_PAYMENT') {
      await conn.query(
        "UPDATE orders SET status='PAID', razorpay_payment_id=?, paid_at=NOW() WHERE id=?",
        [rzpPaymentId, order.id]
      );
      alreadyPaid = false;
    } else if (order.status === 'CANCELLED' && !order.razorpay_payment_id) {
      // Customer paid after we expired the order and released stock. Money is taken, so honour it.
      await conn.query(
        `UPDATE products p JOIN order_items i ON i.product_id = p.id
            SET p.stock = p.stock - i.quantity WHERE i.order_id = ?`,
        [order.id]
      );
      await conn.query(
        `UPDATE orders SET status='PAID', razorpay_payment_id=?, paid_at=NOW(),
                admin_note='Paid after expiry - check stock' WHERE id=?`,
        [rzpPaymentId, order.id]
      );
      alreadyPaid = false;
    }
    await conn.commit();
    return { orderNo: order.order_no, alreadyPaid };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// Orders that were never paid within 30 minutes give their stock back.
async function expireStaleOrders() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [stale] = await conn.query(
      `SELECT id FROM orders
        WHERE status='PENDING_PAYMENT' AND created_at < (NOW() - INTERVAL 30 MINUTE)
        FOR UPDATE`
    );
    for (const o of stale) {
      await restock(conn, o.id);
      await conn.query("UPDATE orders SET status='CANCELLED', admin_note='Payment not completed' WHERE id=?", [o.id]);
    }
    await conn.commit();
    return stale.length;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { restock, markOrderPaid, expireStaleOrders };
