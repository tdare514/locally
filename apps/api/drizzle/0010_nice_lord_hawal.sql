CREATE TABLE `share_downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`share_id` text NOT NULL,
	`name` text NOT NULL,
	`at` integer NOT NULL,
	`via` text NOT NULL,
	`bytes` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `share_downloads_share_idx` ON `share_downloads` (`share_id`);--> statement-breakpoint
CREATE INDEX `share_downloads_at_idx` ON `share_downloads` (`at`);--> statement-breakpoint
CREATE TABLE `share_links` (
	`share_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_hash_idx` ON `share_links` (`token_hash`);--> statement-breakpoint
CREATE TABLE `share_recipients` (
	`share_id` text NOT NULL,
	`user_id` text NOT NULL,
	`claimed_at` integer,
	`hidden_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`share_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `share_recipients_user_idx` ON `share_recipients` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`release_id` text NOT NULL,
	`file_owner_user_id` text NOT NULL,
	`parent_share_id` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`track_ids_json` text,
	`visibility` text NOT NULL,
	`allow_reshare` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`snapshot_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shares_owner_idx` ON `shares` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `shares_release_idx` ON `shares` (`file_owner_user_id`,`release_id`);--> statement-breakpoint
CREATE INDEX `shares_parent_idx` ON `shares` (`parent_share_id`);