ALTER TABLE `devices` ADD `install_id` text;--> statement-breakpoint
CREATE INDEX `devices_user_install_idx` ON `devices` (`user_id`,`install_id`);