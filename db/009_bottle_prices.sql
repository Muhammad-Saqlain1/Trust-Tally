-- Preserve existing measured items and bills. Bottle capacity is separate from its final price.
ALTER TABLE items
  ADD COLUMN pricing_mode ENUM('measured','bottle') NOT NULL DEFAULT 'measured',
  ADD COLUMN package_size DECIMAL(9,3) NULL,
  ADD CONSTRAINT items_bottle_size CHECK (
    (pricing_mode='measured' AND package_size IS NULL) OR
    (pricing_mode='bottle' AND unit='liter' AND package_size IS NOT NULL AND package_size>0)
  );
ALTER TABLE bill_items
  ADD COLUMN pricing_mode ENUM('measured','bottle') NOT NULL DEFAULT 'measured',
  ADD COLUMN package_size DECIMAL(9,3) NULL,
  ADD COLUMN package_count INT UNSIGNED NULL,
  ADD CONSTRAINT billed_bottle_size CHECK (
    (pricing_mode='measured' AND package_size IS NULL AND package_count IS NULL) OR
    (pricing_mode='bottle' AND unit='liter' AND package_size IS NOT NULL AND package_size>0
      AND package_count IS NOT NULL AND package_count>0 AND quantity=package_size*package_count)
  );
