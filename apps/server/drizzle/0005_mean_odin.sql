ALTER TABLE `emails` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `emails` ADD `deleted_mailbox` text;--> statement-breakpoint
CREATE INDEX `emails_deleted_at_idx` ON `emails` (`deleted_at`);