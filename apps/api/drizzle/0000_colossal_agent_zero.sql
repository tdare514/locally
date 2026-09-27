CREATE TABLE `auth_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE INDEX `auth_codes_email_idx` ON `auth_codes` (`email`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash_idx` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `devices_user_idx` ON `devices` (`user_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`bytes` integer NOT NULL,
	`content_type` text NOT NULL,
	`storage_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_storage_key_idx` ON `files` (`storage_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `files_release_name_idx` ON `files` (`release_id`,`name`);--> statement-breakpoint
CREATE INDEX `files_user_idx` ON `files` (`user_id`);--> statement-breakpoint
CREATE TABLE `releases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`record` text NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`server_updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `releases_user_version_idx` ON `releases` (`user_id`,`version`);--> statement-breakpoint
CREATE INDEX `releases_deleted_idx` ON `releases` (`deleted`,`server_updated_at`);--> statement-breakpoint
CREATE TABLE `user_counters` (
	`user_id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	`storage_limit_bytes` integer DEFAULT 1073741824 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);