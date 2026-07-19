ALTER TABLE `classifications` ADD `raw_result_json` text;--> statement-breakpoint
ALTER TABLE `classifications` ADD `processed_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `classifications` SET `processed_at` = `updated_at` WHERE `processed_at` = 0;--> statement-breakpoint
ALTER TABLE `emails` ADD `classification_started_at` integer;
