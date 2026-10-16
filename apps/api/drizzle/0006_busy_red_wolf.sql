ALTER TABLE `files` ADD `verified_at` integer;--> statement-breakpoint
CREATE INDEX `files_unverified_idx` ON `files` (`verified_at`,`created_at`) WHERE "files"."verified_at" IS NULL;