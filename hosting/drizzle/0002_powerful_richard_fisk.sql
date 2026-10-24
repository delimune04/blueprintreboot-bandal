CREATE TABLE `moaflow_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`share_id` text NOT NULL,
	`author_key` text NOT NULL,
	`nickname` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `moaflow_ledgers` (
	`owner_key` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `moaflow_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`token_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `moaflow_shares_token_hash_unique` ON `moaflow_shares` (`token_hash`);