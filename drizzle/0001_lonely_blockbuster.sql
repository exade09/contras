CREATE TABLE `steam_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`steam_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `steam_links_steam_id_unique` ON `steam_links` (`steam_id`);