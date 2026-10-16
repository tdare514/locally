CREATE TABLE `play_days` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`release_id` text NOT NULL,
	`track_id` text NOT NULL,
	`day` text NOT NULL,
	`count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`device_id`, `track_id`, `day`)
);
--> statement-breakpoint
CREATE INDEX `play_days_user_day_idx` ON `play_days` (`user_id`,`day`);