-- Hand-edited: the INSERT ... SELECT carries existing rows over as 'spotify' (the generated one selected a
-- source column the old tables lack), and the users trigger from 0004 names play_days, so it is dropped
-- before the rebuild (the rename fails while it dangles) and recreated after, unchanged.
DROP TRIGGER IF EXISTS `play_days_delete_with_user`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_play_counts` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`release_id` text NOT NULL,
	`track_id` text NOT NULL,
	`source` text DEFAULT 'spotify' NOT NULL,
	`count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`device_id`, `track_id`, `source`)
);
--> statement-breakpoint
INSERT INTO `__new_play_counts`("user_id", "device_id", "release_id", "track_id", "source", "count", "updated_at") SELECT "user_id", "device_id", "release_id", "track_id", 'spotify', "count", "updated_at" FROM `play_counts`;--> statement-breakpoint
DROP TABLE `play_counts`;--> statement-breakpoint
ALTER TABLE `__new_play_counts` RENAME TO `play_counts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `play_counts_user_release_idx` ON `play_counts` (`user_id`,`release_id`);--> statement-breakpoint
CREATE TABLE `__new_play_days` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`release_id` text NOT NULL,
	`track_id` text NOT NULL,
	`day` text NOT NULL,
	`source` text DEFAULT 'spotify' NOT NULL,
	`count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`device_id`, `track_id`, `source`, `day`)
);
--> statement-breakpoint
INSERT INTO `__new_play_days`("user_id", "device_id", "release_id", "track_id", "day", "source", "count", "updated_at") SELECT "user_id", "device_id", "release_id", "track_id", "day", 'spotify', "count", "updated_at" FROM `play_days`;--> statement-breakpoint
DROP TABLE `play_days`;--> statement-breakpoint
ALTER TABLE `__new_play_days` RENAME TO `play_days`;--> statement-breakpoint
CREATE INDEX `play_days_user_day_idx` ON `play_days` (`user_id`,`day`);--> statement-breakpoint
CREATE TRIGGER `play_days_delete_with_user` AFTER DELETE ON `users` BEGIN DELETE FROM `play_days` WHERE `user_id` = old.`id`; END;
