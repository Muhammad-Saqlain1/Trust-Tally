-- Append grams so existing enum values and saved bill quantities keep their meaning.
ALTER TABLE items MODIFY COLUMN unit ENUM('kg','liter','piece','g') NOT NULL;
ALTER TABLE bill_items MODIFY COLUMN unit ENUM('kg','liter','piece','g') NOT NULL;
