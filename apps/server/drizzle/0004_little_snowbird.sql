ALTER TABLE `emails` ADD `body_html` text;--> statement-breakpoint
ALTER TABLE `emails` ADD `content_loaded` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `emails` ADD `remote_image_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `emails` ADD `inline_image_count` integer DEFAULT 0 NOT NULL;