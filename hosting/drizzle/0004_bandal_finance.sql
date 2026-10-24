CREATE TABLE `finance_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`credentials_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_connections_owner` ON `finance_connections` (`owner_key`);--> statement-breakpoint
CREATE TABLE `finance_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`strategy_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_orders_owner` ON `finance_orders` (`owner_key`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_orders_owner_idempotency` ON `finance_orders` (`owner_key`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `finance_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`strategy_id` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_runs_owner` ON `finance_runs` (`owner_key`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`run_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_shares_token_hash_unique` ON `finance_shares` (`token_hash`);--> statement-breakpoint
CREATE INDEX `finance_shares_owner` ON `finance_shares` (`owner_key`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_strategies` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`name` text NOT NULL,
	`parameters_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_strategies_owner` ON `finance_strategies` (`owner_key`,`updated_at`);