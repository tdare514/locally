CREATE TABLE `pending_deletes` (
	`storage_key` text PRIMARY KEY NOT NULL,
	`enqueued_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
