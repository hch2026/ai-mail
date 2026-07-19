CREATE TABLE `discovery_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`report_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`confirmed_at` integer
);
--> statement-breakpoint
CREATE INDEX `discovery_reports_status_idx` ON `discovery_reports` (`status`);--> statement-breakpoint
CREATE TABLE `taxonomy_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taxonomy_version_id` integer NOT NULL,
	`pattern_key` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`sample_email_ids_json` text DEFAULT '[]' NOT NULL,
	`suggested_label` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`taxonomy_version_id`) REFERENCES `taxonomy_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `taxonomy_suggestions_version_pattern_uq` ON `taxonomy_suggestions` (`taxonomy_version_id`,`pattern_key`);--> statement-breakpoint
CREATE INDEX `taxonomy_suggestions_status_idx` ON `taxonomy_suggestions` (`status`);--> statement-breakpoint
CREATE TABLE `taxonomy_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`report_id` integer NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`labels_json` text NOT NULL,
	`backfill_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`confirmed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`backfill_started_at` integer,
	`backfill_completed_at` integer,
	FOREIGN KEY (`report_id`) REFERENCES `discovery_reports`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `taxonomy_versions_status_idx` ON `taxonomy_versions` (`status`);--> statement-breakpoint
ALTER TABLE `classifications` ADD `taxonomy_version_id` integer REFERENCES taxonomy_versions(id);--> statement-breakpoint
ALTER TABLE `classifications` ADD `model_version` text DEFAULT 'legacy-v1' NOT NULL;