CREATE TABLE `classification_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_id` integer NOT NULL,
	`actor` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `classification_history_email_idx` ON `classification_history` (`email_id`);--> statement-breakpoint
CREATE TABLE `classifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_id` integer NOT NULL,
	`primary_label` text NOT NULL,
	`source_labels_json` text DEFAULT '[]' NOT NULL,
	`action_required` integer DEFAULT false NOT NULL,
	`suspected_promotion` integer DEFAULT false NOT NULL,
	`confidence` real NOT NULL,
	`reason` text NOT NULL,
	`suggested_action` text NOT NULL,
	`source` text NOT NULL,
	`needs_review` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classifications_email_uq` ON `classifications` (`email_id`);--> statement-breakpoint
CREATE INDEX `classifications_label_idx` ON `classifications` (`primary_label`);--> statement-breakpoint
CREATE INDEX `classifications_review_idx` ON `classifications` (`needs_review`);--> statement-breakpoint
CREATE TABLE `emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mailbox_id` integer NOT NULL,
	`uid_validity` text NOT NULL,
	`uid` integer NOT NULL,
	`message_id` text,
	`from_name` text,
	`from_address` text,
	`subject` text,
	`sent_at` integer,
	`internal_date` integer,
	`size` integer,
	`flags_json` text DEFAULT '[]' NOT NULL,
	`imap_labels_json` text DEFAULT '[]' NOT NULL,
	`is_unread` integer DEFAULT true NOT NULL,
	`preview` text,
	`body_text` text,
	`body_loaded` integer DEFAULT false NOT NULL,
	`text_part` text,
	`html_part` text,
	`attachments_json` text DEFAULT '[]' NOT NULL,
	`classification_status` text DEFAULT 'pending' NOT NULL,
	`classified_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emails_mailbox_epoch_uid_uq` ON `emails` (`mailbox_id`,`uid_validity`,`uid`);--> statement-breakpoint
CREATE INDEX `emails_unread_idx` ON `emails` (`is_unread`);--> statement-breakpoint
CREATE INDEX `emails_status_idx` ON `emails` (`classification_status`);--> statement-breakpoint
CREATE INDEX `emails_sent_at_idx` ON `emails` (`sent_at`);--> statement-breakpoint
CREATE INDEX `emails_from_address_idx` ON `emails` (`from_address`);--> statement-breakpoint
CREATE TABLE `mailboxes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_key` text NOT NULL,
	`path` text NOT NULL,
	`uid_validity` text NOT NULL,
	`highest_uid` integer DEFAULT 0 NOT NULL,
	`highest_modseq` text,
	`last_synced_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_account_path_epoch_uq` ON `mailboxes` (`account_key`,`path`,`uid_validity`);--> statement-breakpoint
CREATE TABLE `sync_failures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sync_run_id` integer,
	`email_id` integer,
	`stage` text NOT NULL,
	`error_code` text,
	`message` text NOT NULL,
	`retryable` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sync_failures_run_idx` ON `sync_failures` (`sync_run_id`);--> statement-breakpoint
CREATE TABLE `sync_locks` (
	`account_key` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`scanned` integer DEFAULT 0 NOT NULL,
	`inserted` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`classified` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `sync_runs_started_idx` ON `sync_runs` (`started_at`);