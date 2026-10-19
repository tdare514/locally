CREATE TABLE `sampler_lease` (
	`id` text PRIMARY KEY NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `spotify_links` ADD `session_uri` text;--> statement-breakpoint
ALTER TABLE `spotify_links` ADD `session_release_id` text;--> statement-breakpoint
ALTER TABLE `spotify_links` ADD `session_track_id` text;--> statement-breakpoint
ALTER TABLE `spotify_links` ADD `session_progress_ms` integer;--> statement-breakpoint
ALTER TABLE `spotify_links` ADD `session_duration_ms` integer;--> statement-breakpoint
ALTER TABLE `spotify_links` ADD `session_at` integer;--> statement-breakpoint
ALTER TABLE `spotify_links` ADD `session_counted` integer;