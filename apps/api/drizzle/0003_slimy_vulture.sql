CREATE TABLE `play_counts` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`release_id` text NOT NULL,
	`track_id` text NOT NULL,
	`count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`device_id`, `track_id`)
);
--> statement-breakpoint
CREATE INDEX `play_counts_user_release_idx` ON `play_counts` (`user_id`,`release_id`);