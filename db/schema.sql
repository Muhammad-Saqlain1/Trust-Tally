-- MySQL 8.0+. Complete database schema. Run with npm run db:migrate; the runner records this schema.
CREATE TABLE shops (
  shop_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  owner_name VARCHAR(120) NOT NULL, shop_name VARCHAR(160) NOT NULL,
  phone VARCHAR(20) NOT NULL, address VARCHAR(500) NOT NULL DEFAULT '',
  logo VARCHAR(500), customer_sequence INT UNSIGNED NOT NULL DEFAULT 0,
  customer_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 CHECK(customer_count <= 500),
  bank_name VARCHAR(120) NOT NULL DEFAULT '', bank_account VARCHAR(120) NOT NULL DEFAULT '',
  easypaisa_account VARCHAR(30) NOT NULL DEFAULT '', jazzcash_account VARCHAR(30) NOT NULL DEFAULT '',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE users (
  user_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  shop_id BIGINT UNSIGNED NOT NULL, role ENUM('shopkeeper','staff','customer') NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL,
  pin_hash VARCHAR(200) NOT NULL, language ENUM('en','ur') NOT NULL DEFAULT 'en',
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE(shop_id,user_id), FOREIGN KEY (shop_id) REFERENCES shops(shop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE staff_permissions (
  shop_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, permission VARCHAR(80) NOT NULL,
  PRIMARY KEY(user_id, permission), FOREIGN KEY(shop_id,user_id) REFERENCES users(shop_id,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE customers (
  customer_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  shop_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED UNIQUE,
  customer_code VARCHAR(20) NOT NULL, name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL, address VARCHAR(500) NOT NULL DEFAULT '',
  opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0, credit_limit DECIMAL(12,2) NOT NULL DEFAULT 0,
  consent_status ENUM('invited','accepted') NOT NULL DEFAULT 'invited',
  invite_hash CHAR(64) UNIQUE, invite_expires_at DATETIME(3),
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE(shop_id, customer_code), UNIQUE(shop_id, phone), UNIQUE(shop_id, customer_id),
  FOREIGN KEY(shop_id) REFERENCES shops(shop_id), FOREIGN KEY(shop_id,user_id) REFERENCES users(shop_id,user_id),
  CHECK(opening_balance >= 0), CHECK(credit_limit >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE items (
  item_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  shop_id BIGINT UNSIGNED NOT NULL, name VARCHAR(160) NOT NULL,
  unit ENUM('kg','liter','piece') NOT NULL, default_price DECIMAL(12,2) NOT NULL,
  picture_url VARCHAR(500), active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(shop_id, item_id), FOREIGN KEY(shop_id) REFERENCES shops(shop_id), CHECK(default_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE bills (
  bill_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, shop_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL, bill_no VARCHAR(40) UNIQUE,
  bill_date DATE NOT NULL, total DECIMAL(12,2) NOT NULL,
  status ENUM('active','cancelled') NOT NULL DEFAULT 'active', created_by BIGINT UNSIGNED NOT NULL,
  client_key VARCHAR(64) NOT NULL, request_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE(shop_id, client_key), UNIQUE(shop_id, bill_id), UNIQUE(shop_id,customer_id,bill_id),
  INDEX(shop_id, customer_id, bill_date, bill_id),
  FOREIGN KEY(shop_id, customer_id) REFERENCES customers(shop_id, customer_id),
  FOREIGN KEY(shop_id,created_by) REFERENCES users(shop_id,user_id), CHECK(total > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE bill_items (
  bill_item_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, shop_id BIGINT UNSIGNED NOT NULL,
  bill_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL, name VARCHAR(160) NOT NULL,
  quantity DECIMAL(9,3) NOT NULL, unit ENUM('kg','liter','piece') NOT NULL,
  price DECIMAL(12,2) NOT NULL, line_total DECIMAL(12,2) NOT NULL,
  customer_status ENUM('pending','ok','disputed') NOT NULL DEFAULT 'pending',
  UNIQUE(shop_id,bill_item_id), UNIQUE(bill_id,bill_item_id),
  FOREIGN KEY(shop_id,bill_id) REFERENCES bills(shop_id,bill_id), FOREIGN KEY(shop_id,item_id) REFERENCES items(shop_id,item_id),
  CHECK(quantity > 0), CHECK(price >= 0), CHECK(line_total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE payments (
  payment_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, shop_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL, bill_id BIGINT UNSIGNED,
  amount DECIMAL(12,2) NOT NULL, payment_date DATE NOT NULL,
  method ENUM('cash','bank','easypaisa','jazzcash','raast','qr') NOT NULL,
  transaction_ref VARCHAR(160), proof_file VARCHAR(500),
  status ENUM('pending','verified','approved','rejected') NOT NULL DEFAULT 'pending',
  confirmed_by BIGINT UNSIGNED, confirmed_at DATETIME(3),
  client_key VARCHAR(64) NOT NULL, request_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE(shop_id, client_key), UNIQUE(shop_id,customer_id,payment_id), INDEX(shop_id, customer_id, payment_date),
  FOREIGN KEY(shop_id, customer_id) REFERENCES customers(shop_id, customer_id),
  FOREIGN KEY(shop_id,customer_id,bill_id) REFERENCES bills(shop_id,customer_id,bill_id),
  FOREIGN KEY(shop_id,confirmed_by) REFERENCES users(shop_id,user_id), INDEX(bill_id,status), CHECK(amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE payment_allocations (
  allocation_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  shop_id BIGINT UNSIGNED NOT NULL, customer_id BIGINT UNSIGNED NOT NULL,
  payment_id BIGINT UNSIGNED NOT NULL, bill_id BIGINT UNSIGNED,
  amount DECIMAL(12,2) NOT NULL,
  FOREIGN KEY(shop_id,customer_id,payment_id) REFERENCES payments(shop_id,customer_id,payment_id),
  FOREIGN KEY(shop_id,customer_id,bill_id) REFERENCES bills(shop_id,customer_id,bill_id),
  INDEX(bill_id,payment_id), INDEX(payment_id,bill_id),
  CHECK(amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE returns (
  return_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, shop_id BIGINT UNSIGNED NOT NULL,
  bill_id BIGINT UNSIGNED NOT NULL, bill_item_id BIGINT UNSIGNED,
  quantity DECIMAL(9,3), amount DECIMAL(12,2) NOT NULL,
  reason VARCHAR(500) NOT NULL, created_by BIGINT UNSIGNED NOT NULL,
  client_key VARCHAR(64) NULL, request_hash CHAR(64) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY returns_shop_client_key (shop_id, client_key),
  FOREIGN KEY(shop_id, bill_id) REFERENCES bills(shop_id, bill_id),
  FOREIGN KEY(bill_id,bill_item_id) REFERENCES bill_items(bill_id,bill_item_id), FOREIGN KEY(shop_id,created_by) REFERENCES users(shop_id,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE disputes (
  dispute_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, shop_id BIGINT UNSIGNED NOT NULL,
  bill_item_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(500) NOT NULL, status ENUM('open','resolved','rejected') NOT NULL DEFAULT 'open',
  resolution_note VARCHAR(500), FOREIGN KEY(shop_id,bill_item_id) REFERENCES bill_items(shop_id,bill_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE monthly_statements (
  statement_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, shop_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL, month DATE NOT NULL,
  previous_balance DECIMAL(12,2) NOT NULL, bills_total DECIMAL(12,2) NOT NULL,
  payments_total DECIMAL(12,2) NOT NULL, returns_total DECIMAL(12,2) NOT NULL,
  closing_balance DECIMAL(12,2) NOT NULL, pdf_path VARCHAR(500), UNIQUE(customer_id, month),
  FOREIGN KEY(shop_id, customer_id) REFERENCES customers(shop_id, customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE expenses (
  expense_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, shop_id BIGINT UNSIGNED NOT NULL,
  expense_date DATE NOT NULL, category VARCHAR(80) NOT NULL, amount DECIMAL(12,2) NOT NULL,
  note VARCHAR(500), INDEX(shop_id, expense_date), FOREIGN KEY(shop_id) REFERENCES shops(shop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE suppliers (
  supplier_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, shop_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL, phone VARCHAR(20), UNIQUE(shop_id,supplier_id), FOREIGN KEY(shop_id) REFERENCES shops(shop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE supplier_transactions (
  transaction_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, shop_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  type ENUM('purchase','payment') NOT NULL, amount DECIMAL(12,2) NOT NULL, date DATE NOT NULL,
  note VARCHAR(500), FOREIGN KEY(shop_id,supplier_id) REFERENCES suppliers(shop_id,supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE chat_messages (
  message_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, shop_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL, sender_id BIGINT UNSIGNED NOT NULL,
  text TEXT NOT NULL, sent_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), read_at DATETIME(3),
  FOREIGN KEY(shop_id, customer_id) REFERENCES customers(shop_id, customer_id), FOREIGN KEY(shop_id,sender_id) REFERENCES users(shop_id,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE notifications (
  notification_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED, shop_id BIGINT UNSIGNED NOT NULL, customer_id BIGINT UNSIGNED,
  channel ENUM('in-app','whatsapp','sms') NOT NULL, type VARCHAR(80) NOT NULL,
  message VARCHAR(1000) NOT NULL, status ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued', sent_at DATETIME(3),
  FOREIGN KEY(shop_id,user_id) REFERENCES users(shop_id,user_id), FOREIGN KEY(shop_id) REFERENCES shops(shop_id),
  FOREIGN KEY(shop_id,customer_id) REFERENCES customers(shop_id,customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE audit_logs (
  log_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, shop_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL, action VARCHAR(80) NOT NULL, entity VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL, old_value JSON, new_value JSON, reason VARCHAR(500),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX(shop_id, created_at, log_id),
  FOREIGN KEY(shop_id) REFERENCES shops(shop_id), FOREIGN KEY(shop_id,user_id) REFERENCES users(shop_id,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE sessions (
  token_hash CHAR(64) PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL, INDEX(expires_at), FOREIGN KEY(user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- An atomic per-shop counter enforces capacity even for concurrent direct SQL inserts.
DELIMITER $$
CREATE TRIGGER customer_capacity BEFORE INSERT ON customers FOR EACH ROW
BEGIN
  UPDATE shops SET customer_count=customer_count+1 WHERE shop_id=NEW.shop_id AND customer_count<500;
  IF ROW_COUNT() <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Customer limit of 500 reached'; END IF;
END$$
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit history is append-only'; END$$
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit history is append-only'; END$$
CREATE TRIGGER bill_no_delete BEFORE DELETE ON bills FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Use reversal entries for saved bills'; END$$
CREATE TRIGGER payment_no_delete BEFORE DELETE ON payments FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Use reversal entries for saved payments'; END$$
CREATE TRIGGER return_no_delete BEFORE DELETE ON returns FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Return entries cannot be deleted'; END$$
CREATE TRIGGER monthly_statement_no_update BEFORE UPDATE ON monthly_statements FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Monthly statements are immutable after closing'; END$$
CREATE TRIGGER monthly_statement_no_delete BEFORE DELETE ON monthly_statements FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Monthly statements are immutable after closing'; END$$
DELIMITER ;
