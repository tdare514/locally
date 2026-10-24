CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`record` text NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`server_updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `collections_user_version_idx` ON `collections` (`user_id`,`version`);--> statement-breakpoint
CREATE INDEX `collections_deleted_idx` ON `collections` (`deleted`,`server_updated_at`);