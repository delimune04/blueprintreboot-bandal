CREATE TABLE `labvium_workspace_access` (
	`workspace_key` text PRIMARY KEY NOT NULL,
	`owner_user_key` text NOT NULL,
	`title` text NOT NULL,
	`permissions_revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `labvium_workspace_email_grants` (
	`workspace_key` text NOT NULL,
	`email_key` text NOT NULL,
	`email_label` text NOT NULL,
	`role` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_key`, `email_key`)
);
--> statement-breakpoint
CREATE TABLE `labvium_workspace_members` (
	`workspace_key` text NOT NULL,
	`member_user_key` text NOT NULL,
	`email_key` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`workspace_key`, `member_user_key`)
);
