CREATE TABLE `spotify_link_requests` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`verifier` text NOT NULL,
	`time_zone` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spotify_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`refresh_token_enc` text NOT NULL,
	`access_token_enc` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`scope` text NOT NULL,
	`time_zone` text NOT NULL,
	`cloud_device_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_sample_at` integer,
	`problem` text,
	`backoff_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
