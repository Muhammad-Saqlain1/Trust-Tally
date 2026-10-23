-- A monthly bill is a saved summary of credit already recorded in bills.
-- It never creates a second ledger charge or changes a closed monthly statement.
CREATE TABLE monthly_bills (
  monthly_bill_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  shop_id BIGINT UNSIGNED NOT NULL, customer_id BIGINT UNSIGNED NOT NULL,
  month DATE NOT NULL, bill_no VARCHAR(64) UNIQUE,
  total DECIMAL(12,2) NOT NULL CHECK(total >= 0), content_hash CHAR(64) NOT NULL,
  snapshot JSON NOT NULL, created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE(shop_id,customer_id,month,content_hash), INDEX(shop_id,month,monthly_bill_id),
  FOREIGN KEY(shop_id,customer_id) REFERENCES customers(shop_id,customer_id),
  FOREIGN KEY(shop_id,created_by) REFERENCES users(shop_id,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
DELIMITER $$
CREATE TRIGGER monthly_bill_no_delete BEFORE DELETE ON monthly_bills FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Saved monthly bills cannot be deleted'; END$$
DELIMITER ;
