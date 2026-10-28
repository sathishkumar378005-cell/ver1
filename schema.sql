CREATE DATABASE IF NOT EXISTS oil_shop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE oil_shop;

CREATE TABLE IF NOT EXISTS products (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(120) NOT NULL,
  description  VARCHAR(500) NOT NULL DEFAULT '',
  size_label   VARCHAR(30)  NOT NULL,               -- e.g. "1 L", "5 L"
  price_paise  INT UNSIGNED NOT NULL,               -- money is ALWAYS stored in paise
  stock        INT NOT NULL DEFAULT 0,
  image_url    VARCHAR(255) NULL,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  order_no            VARCHAR(24) NOT NULL UNIQUE,
  customer_name       VARCHAR(100) NOT NULL,
  phone               CHAR(10) NOT NULL,
  email               VARCHAR(150) NULL,
  address_line        VARCHAR(300) NOT NULL,
  city                VARCHAR(80)  NOT NULL,
  state               VARCHAR(80)  NOT NULL,
  pincode             CHAR(6) NOT NULL,
  subtotal_paise      INT UNSIGNED NOT NULL,
  shipping_paise      INT UNSIGNED NOT NULL,
  total_paise         INT UNSIGNED NOT NULL,
  status              ENUM('PENDING_PAYMENT','PAID','PACKED','SHIPPED','DELIVERED','CANCELLED') NOT NULL DEFAULT 'PENDING_PAYMENT',
  razorpay_order_id   VARCHAR(40) NULL UNIQUE,
  razorpay_payment_id VARCHAR(40) NULL,
  tracking_info       VARCHAR(255) NULL,            -- courier + tracking number, filled by admin
  admin_note          VARCHAR(255) NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at             TIMESTAMP NULL,
  INDEX idx_status_created (status, created_at),
  INDEX idx_phone (phone)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_items (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  order_id         INT NOT NULL,
  product_id       INT NOT NULL,
  product_name     VARCHAR(120) NOT NULL,           -- snapshot, so old orders stay correct if product changes
  size_label       VARCHAR(30) NOT NULL,
  unit_price_paise INT UNSIGNED NOT NULL,
  quantity         INT UNSIGNED NOT NULL,
  line_total_paise INT UNSIGNED NOT NULL,
  FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

-- Audit log of every payment event received (verify call + webhooks)
CREATE TABLE IF NOT EXISTS payment_events (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  razorpay_order_id   VARCHAR(40) NOT NULL,
  razorpay_payment_id VARCHAR(40) NULL,
  event               VARCHAR(40) NOT NULL,
  amount_paise        INT UNSIGNED NULL,
  payload             JSON NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rzp_order (razorpay_order_id)
) ENGINE=InnoDB;

-- Sample catalogue: edit names / prices (in paise) / stock to match your real products
INSERT INTO products (name, description, size_label, price_paise, stock) VALUES
 ('Cold-Pressed Groundnut Oil', 'Wood-pressed (chekku) groundnut oil. Nutty aroma, ideal for everyday frying.', '1 L', 24000, 100),
 ('Cold-Pressed Groundnut Oil', 'Wood-pressed (chekku) groundnut oil, family pack.', '5 L', 115000, 40),
 ('Cold-Pressed Sesame Oil', 'Traditional gingelly oil. Rich, golden and aromatic.', '1 L', 52000, 80),
 ('Cold-Pressed Coconut Oil', 'Pure coconut oil from sun-dried copra.', '1 L', 38000, 80),
 ('Castor Oil', 'Pure cold-pressed castor oil.', '500 ml', 22000, 50);
