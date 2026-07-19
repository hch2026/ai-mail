CREATE TABLE `mail_accounts` (
	`account_key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `discovery_reports` ADD `account_key` text;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `account_key` text;--> statement-breakpoint
ALTER TABLE `taxonomy_versions` ADD `account_key` text;--> statement-breakpoint
UPDATE `discovery_reports`
SET `account_key` = (SELECT `account_key` FROM `mailboxes` ORDER BY `id` LIMIT 1)
WHERE `account_key` IS NULL;--> statement-breakpoint
UPDATE `taxonomy_versions`
SET `account_key` = (
	SELECT `account_key` FROM `discovery_reports`
	WHERE `discovery_reports`.`id` = `taxonomy_versions`.`report_id`
)
WHERE `account_key` IS NULL;--> statement-breakpoint
UPDATE `sync_runs`
SET `account_key` = (SELECT `account_key` FROM `mailboxes` ORDER BY `id` LIMIT 1)
WHERE `account_key` IS NULL;
