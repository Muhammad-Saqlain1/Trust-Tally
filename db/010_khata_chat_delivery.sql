-- Khata chat updates are written after the financial transaction commits.
-- The source key makes a retried financial request safe to deliver again.
ALTER TABLE chat_messages
  ADD COLUMN source_type ENUM('manual','khata') NOT NULL DEFAULT 'manual',
  ADD COLUMN source_id BIGINT UNSIGNED NULL,
  ADD UNIQUE KEY unique_chat_source (shop_id,customer_id,source_type,source_id);
