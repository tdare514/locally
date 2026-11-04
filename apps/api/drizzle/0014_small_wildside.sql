CREATE TABLE `invites` (
	`email` text PRIMARY KEY NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer
);
