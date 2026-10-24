CREATE INDEX `moaflow_comments_share_created` ON `moaflow_comments` (`share_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `moaflow_comments_author_created` ON `moaflow_comments` (`author_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `moaflow_shares_owner_created` ON `moaflow_shares` (`owner_key`,`created_at`);