import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const labviumWorkspaces = sqliteTable("labvium_workspaces", {
  ownerKey: text("owner_key").primaryKey().notNull(),
  revision: integer("revision").notNull().default(1),
  stateJson: text("state_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaceAccess = sqliteTable("labvium_workspace_access", {
  workspaceKey: text("workspace_key").primaryKey().notNull(),
  ownerUserKey: text("owner_user_key").notNull(),
  title: text("title").notNull(),
  permissionsRevision: integer("permissions_revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
});
export const workspaceMembers = sqliteTable("labvium_workspace_members", {
  workspaceKey: text("workspace_key").notNull(),
  memberUserKey: text("member_user_key").notNull(),
  emailKey: text("email_key").notNull(),
  role: text("role", { enum: ["viewer", "editor"] }).notNull(),
  joinedAt: text("joined_at").notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceKey, table.memberUserKey] })]);
export const workspaceEmailGrants = sqliteTable("labvium_workspace_email_grants", {
  workspaceKey: text("workspace_key").notNull(),
  emailKey: text("email_key").notNull(),
  emailLabel: text("email_label").notNull(),
  role: text("role", { enum: ["viewer", "editor"] }).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceKey, table.emailKey] })]);

export const moaflowLedgers = sqliteTable("moaflow_ledgers", {
  ownerKey: text("owner_key").primaryKey().notNull(),
  revision: integer("revision").notNull().default(1),
  stateJson: text("state_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const moaflowShares = sqliteTable("moaflow_shares", {
  id: text("id").primaryKey().notNull(),
  ownerKey: text("owner_key").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
}, table => [index("moaflow_shares_owner_created").on(table.ownerKey,table.createdAt)]);
export const moaflowComments = sqliteTable("moaflow_comments", {
  id: text("id").primaryKey().notNull(),
  shareId: text("share_id").notNull(),
  authorKey: text("author_key").notNull(),
  nickname: text("nickname").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("moaflow_comments_share_created").on(table.shareId,table.createdAt),index("moaflow_comments_author_created").on(table.authorKey,table.createdAt)]);

export const financeStrategies = sqliteTable("finance_strategies", {
  id: text("id").primaryKey().notNull(),
  ownerKey: text("owner_key").notNull(),
  name: text("name").notNull(),
  parametersJson: text("parameters_json").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("finance_strategies_owner").on(table.ownerKey, table.updatedAt)]);
export const financeRuns = sqliteTable("finance_runs", {
  id: text("id").primaryKey().notNull(),
  ownerKey: text("owner_key").notNull(),
  strategyId: text("strategy_id").notNull(),
  resultJson: text("result_json").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("finance_runs_owner").on(table.ownerKey, table.createdAt)]);
export const financeShares = sqliteTable("finance_shares", {
  id: text("id").primaryKey().notNull(),
  ownerKey: text("owner_key").notNull(),
  runId: text("run_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
}, table => [index("finance_shares_owner").on(table.ownerKey, table.createdAt)]);
export const financeConnections = sqliteTable("finance_connections", {
  id: text("id").primaryKey().notNull(),
  ownerKey: text("owner_key").notNull(),
  provider: text("provider").notNull(),
  label: text("label").notNull(),
  credentialsJson: text("credentials_json").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("finance_connections_owner").on(table.ownerKey)]);
export const financeOrders = sqliteTable("finance_orders", {
  id: text("id").primaryKey().notNull(),
  ownerKey: text("owner_key").notNull(),
  strategyId: text("strategy_id").notNull(),
  connectionId: text("connection_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull(),
  resultJson: text("result_json").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("finance_orders_owner").on(table.ownerKey, table.createdAt), uniqueIndex("finance_orders_owner_idempotency").on(table.ownerKey, table.idempotencyKey)]);
