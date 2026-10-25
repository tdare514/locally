CREATE TABLE `play_events` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`device_id` text NOT NULL,
	`release_id` text NOT NULL,
	`track_id` text NOT NULL,
	`source` text NOT NULL,
	`started_at` integer NOT NULL,
	`day` text NOT NULL,
	`listened_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `play_events_user_started_idx` ON `play_events` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `play_events_user_release_idx` ON `play_events` (`user_id`,`release_id`);--> statement-breakpoint
CREATE INDEX `play_events_user_day_idx` ON `play_events` (`user_id`,`day`);
--> statement-breakpoint
-- Hand-added (#368): deleting a user removes their play events even under a rolled-back deploy that
-- does not know play_events. AccountService.delete removes them first as well.
CREATE TRIGGER `play_events_delete_with_user` AFTER DELETE ON `users` BEGIN DELETE FROM `play_events` WHERE `user_id` = old.`id`; END;
