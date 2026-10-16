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
CREATE INDEX `play_days_user_day_idx` ON `play_days` (`user_id`,`day`);--> statement-breakpoint
-- Hand-added (#201): deleting a user removes their day buckets even under the previous deploy's
-- code (a rollback), which doesn't know play_days. The current code deletes them first as well.
CREATE TRIGGER `play_days_delete_with_user` AFTER DELETE ON `users` BEGIN DELETE FROM `play_days` WHERE `user_id` = old.`id`; END;