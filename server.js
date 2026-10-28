require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const shop = require('./routes/shop');
const admin = require('./routes/admin');
const webhook = require('./routes/webhook');
const { expireStaleOrders } = require('./lib/orders');

for (const k of ['DB_USER', 'DB_PASSWORD', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'ADMIN_TOKEN']) {
  if (!process.env[k]) {
    console.error(`Missing ${k} in .env`);
    process.exit(1);
  }
}

const app = express();
app.set('trust proxy', 1); // behind nginx / load balancer

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", 'https://checkout.razorpay.com'],
        'frame-src': ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
        'connect-src': ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
        'img-src': ["'self'", 'data:', 'https:'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'form-action': ["'self'", 'https://api.razorpay.com'],
        'upgrade-insecure-requests': null, // allow plain http until you add HTTPS
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Webhook needs the RAW body for signature verification, so it is mounted before express.json().
app.post('/api/payments/webhook', express.raw({ type: 'application/json', limit: '256kb' }), webhook);

app.use(express.json({ limit: '50kb' }));

app.use('/api/', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use('/api/orders/track', rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }));
app.use('/api/admin', rateLimit({ windowMs: 15 * 60_000, limit: 100, standardHeaders: true, legacyHeaders: false }));

app.use('/api/admin', admin);
app.use('/api', shop);

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Shop running on http://localhost:${port}`));

// Release stock held by unpaid orders every 5 minutes.
setInterval(() => expireStaleOrders().catch((e) => console.error('expire job failed', e)), 5 * 60_000);
