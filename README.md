# Oil shop: Express + MySQL + Razorpay (online payment only)

## What you get
- `public/`  storefront (catalogue, cart, checkout), `track.html` (customer order tracking), `admin.html` (orders + products)
- `server/`  Express API, Razorpay order creation, HMAC signature verification, webhook, stock reservation
- `database/schema.sql`  MySQL tables + sample products

There is no COD anywhere: an order only becomes PAID after Razorpay confirms payment.

## Setup (local or EC2)
1. Install Node 18+ and MySQL 8 (or use RDS / Aurora MySQL).
2. Create DB and tables:
   `mysql -u root -p < database/schema.sql`
   Then create a user:
   `CREATE USER 'oil_user'@'%' IDENTIFIED BY 'strong_password'; GRANT SELECT,INSERT,UPDATE,DELETE ON oil_shop.* TO 'oil_user'@'%';`
3. `cp .env.example .env` and fill in DB, Razorpay keys, `ADMIN_TOKEN`.
4. `npm install` then `npm start`
5. Open http://localhost:3000 (shop), /track (customer tracking), /admin (you).

## Razorpay setup
1. Use **Test Mode** keys first (`rzp_test_...`). Test net banking: choose any bank and click Success.
2. Dashboard -> Settings -> Configuration -> Payment Methods: enable/disable UPI, cards, net banking.
   For net banking only, switch the others off there (and/or set `ONLY_METHOD=netbanking`).
3. Dashboard -> Settings -> Payment Capture: set to **Automatic** so payments are captured without manual work.
4. Dashboard -> Settings -> Webhooks -> Add:
   URL `https://YOUR-DOMAIN/api/payments/webhook`, secret = `RAZORPAY_WEBHOOK_SECRET`,
   events: `payment.captured`, `order.paid`, `payment.failed`.
   (Webhooks need a public HTTPS URL; use a tunnel such as ngrok while testing locally.)
5. Go live: complete KYC, swap in `rzp_live_...` keys.

## How payment is kept safe
- Browser sends only product IDs + quantities. The server reads prices from MySQL and computes the total.
- Razorpay order is created for that server-computed amount.
- After payment, `/api/payments/verify` checks `HMAC_SHA256(order_id|payment_id, KEY_SECRET)` before marking PAID.
- Webhook (signed with its own secret) marks PAID even if the customer closes the tab.
- Stock is reserved when the order is created and released after 30 minutes if unpaid.
- Rate limiting, Helmet security headers, parameterised SQL everywhere.

## Deploy on EC2 (single instance)
- Put nginx in front (port 80/443 -> 3000) and add a free Let's Encrypt certificate (certbot). HTTPS is required for live Razorpay and webhooks.
- Run with pm2: `npm i -g pm2 && pm2 start server/server.js --name oil-shop && pm2 save && pm2 startup`
- Security group: open 80/443 to the world; keep MySQL (3306) closed to the internet.
- Back up MySQL daily (`mysqldump`).

## Refunds and cancellations
Cancel in /admin returns stock. For an already-paid order, also refund from the Razorpay dashboard.
