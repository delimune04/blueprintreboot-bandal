import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
